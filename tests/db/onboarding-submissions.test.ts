import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

let submissions: typeof import("../../src/lib/onboarding/submissions");
before(async () => {
  submissions = await loadAppModule(() => import("../../src/lib/onboarding/submissions"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const status = async (id: string) => (await sql`SELECT status, response FROM onboarding_submissions WHERE id = ${id}`)[0]!;

// API-002 / API-003: explicit states and compare-and-swap takeovers.
test("retryable failures are reacquired, terminal ones replay, stale attempts cannot overwrite", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  try {
    const first = await submissions.beginOnboardingSubmission({ userId, idempotencyKey: "k1" });
    assert.equal(first.mode, "process");
    if (first.mode !== "process") return;

    // A concurrent request with the same key sees the live attempt.
    assert.equal((await submissions.beginOnboardingSubmission({ userId, idempotencyKey: "k1" })).mode, "in-progress");

    // Retryable failure -> the next request takes the row over immediately.
    await submissions.finalizeOnboardingSubmission({ ...first, status: "failed", response: { success: false, error: { code: "DB_ERROR", message: "x", retryable: true } } });
    const second = await submissions.beginOnboardingSubmission({ userId, idempotencyKey: "k1" });
    assert.equal(second.mode, "process");
    if (second.mode !== "process") return;
    assert.notEqual(second.attemptToken, first.attemptToken);

    // The first attempt finishing late must not overwrite the second attempt's row.
    await submissions.finalizeOnboardingSubmission({ ...first, status: "completed", response: { success: true } });
    assert.equal((await status(first.submissionId)).status, "processing");

    // Terminal failure replays as an error, never "in progress".
    await submissions.finalizeOnboardingSubmission({ ...second, status: "failed", response: { success: false, error: { code: "USERNAME_TAKEN", message: "taken", retryable: false } } });
    const replay = await submissions.beginOnboardingSubmission({ userId, idempotencyKey: "k1" });
    assert.equal(replay.mode, "replay");
    if (replay.mode === "replay") assert.equal(replay.response.error?.code, "USERNAME_TAKEN");

    // Success replays as success.
    const other = await submissions.beginOnboardingSubmission({ userId, idempotencyKey: "k2" });
    assert.equal(other.mode, "process");
    if (other.mode !== "process") return;
    await submissions.finalizeOnboardingSubmission({ ...other, status: "completed", response: { success: true, needsMetadataSync: true } });
    const ok = await submissions.beginOnboardingSubmission({ userId, idempotencyKey: "k2" });
    assert.deepEqual(ok.mode === "replay" ? ok.response : null, { success: true, needsMetadataSync: true, error: undefined });
  } finally {
    await sql`DELETE FROM onboarding_submissions WHERE user_id = ${userId}`;
  }
});

test("a stale processing row is taken over exactly once under concurrency", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  try {
    const first = await submissions.beginOnboardingSubmission({ userId, idempotencyKey: "stale" });
    assert.equal(first.mode, "process");
    // A trigger stamps updated_at on every update; bypass it to age the row.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE onboarding_submissions SET updated_at = now() - interval '5 minutes' WHERE user_id = ${userId}`;
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => submissions.beginOnboardingSubmission({ userId, idempotencyKey: "stale" })));
    assert.equal(results.filter((r) => r.mode === "process").length, 1);
    assert.equal(results.filter((r) => r.mode === "in-progress").length, 5);
  } finally {
    await sql`DELETE FROM onboarding_submissions WHERE user_id = ${userId}`;
  }
});
