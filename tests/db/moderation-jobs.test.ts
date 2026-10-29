import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Trust jobs (docs/trust-and-safety-concept.md §15): org hand-off, claim release, pause for an overdue appeal,
// the restriction notices, and retention that never touches Legal hold.

moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let jobs: typeof import("../../src/lib/trust/jobs");
before(async () => { jobs = await loadAppModule(() => import("../../src/lib/trust/jobs")); });
after(async () => { await sql.end(); await closeAppDb(); });

async function openCase(extra: Record<string, unknown> = {}) {
  const [subject, staff] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx)]);
  const workspace = await sql.begin((tx) => createProject(tx, subject!));
  const [c] = await sql`INSERT INTO moderation_cases ${sql({ target_kind: "project", target_id: workspace, subject_id: subject, severity: "normal", reason: "spam", source: "report", routed_to: "staff", deadline_at: new Date(Date.now() + 3_600_000), ...extra })} RETURNING id`;
  return { caseId: c!.id as string, subject: subject!, staff: staff!, workspace };
}

test("deadlines: org cases pass to staff, stale claims are released, an appeal 7 days overdue pauses the limit", async () => {
  const org = await openCase({ routed_to: "org", org_deadline_at: new Date(Date.now() - 60_000) });
  const claimed = await openCase();
  await sql`UPDATE moderation_cases SET state = 'in_review', assignee_id = ${claimed.staff}, claimed_at = now() - interval '3 hours' WHERE id = ${claimed.caseId}`;
  const appealed = await openCase({ state: "decided", outcome: "actioned" });
  await sql`INSERT INTO moderation_actions (case_id, subject_id, target_kind, action, ends_at) VALUES (${appealed.caseId}, ${appealed.subject}, 'account', 'limit', now() + interval '20 days')`;
  await sql`INSERT INTO moderation_appeals (case_id, subject_id, body, deadline_at) VALUES (${appealed.caseId}, ${appealed.subject}, 'please', now() - interval '8 days')`;

  await jobs.runTrustDeadlines();
  assert.equal((await sql`SELECT routed_to FROM moderation_cases WHERE id = ${org.caseId}`)[0]!.routed_to, "staff");
  assert.equal((await sql`SELECT assignee_id FROM moderation_cases WHERE id = ${claimed.caseId}`)[0]!.assignee_id, null);
  assert.equal((await sql`SELECT app_private.moderation_restriction(${appealed.subject}::uuid) AS r`)[0]!.r, null, "paused while we're late");
});

test("restrictions: M4 the day before, M5 once it ended, each once", async () => {
  const soon = await openCase({ state: "decided", outcome: "actioned" });
  const ended = await openCase({ state: "decided", outcome: "actioned" });
  await sql`INSERT INTO moderation_actions (case_id, subject_id, target_kind, action, ends_at, notified_at) VALUES
    (${soon.caseId}, ${soon.subject}, 'account', 'limit', now() + interval '24 hours', now()),
    (${ended.caseId}, ${ended.subject}, 'account', 'suspension', now() - interval '1 hour', now())`;
  await jobs.runTrustRestrictions();
  await jobs.runTrustRestrictions();
  const titles = async (id: string) => (await sql`SELECT title FROM user_notifications WHERE user_id = ${id} AND kind = 'trust_safety'`).map((r) => r.title);
  assert.deepEqual(await titles(soon.subject), ["Your account limit ends tomorrow"]);
  assert.deepEqual(await titles(ended.subject), ["Your account is back to normal"]);
});

test("retention clears old dismissed evidence but keeps Legal hold", async () => {
  const old = await openCase({ state: "decided", outcome: "no_violation", decided_at: new Date(Date.now() - 100 * 86_400_000), snapshot: { label: "Post", content: "x" } });
  const held = await openCase({ state: "decided", outcome: "no_violation", decided_at: new Date(Date.now() - 100 * 86_400_000), snapshot: { label: "Post", content: "y" }, legal_hold: true });
  await jobs.runTrustRetention();
  assert.deepEqual((await sql`SELECT snapshot FROM moderation_cases WHERE id = ${old.caseId}`)[0]!.snapshot, { label: "Post" });
  assert.deepEqual((await sql`SELECT snapshot FROM moderation_cases WHERE id = ${held.caseId}`)[0]!.snapshot, { label: "Post", content: "y" });
});

test("the daily summary only goes at 8 am IST", async () => {
  assert.equal(await jobs.runTrustDailySummary(new Date("2026-10-30T05:00:00Z")), 0, "10:30 IST");
});

test("the weekly health email reads every number without failing", async () => {
  assert.equal(await jobs.runTrustWeeklyHealth(new Date("2026-10-30T02:40:00Z")), 0, "a Friday");
  const sent = await jobs.runTrustWeeklyHealth(new Date("2026-11-02T02:40:00Z"));
  assert.equal(typeof sent, "number");
});
