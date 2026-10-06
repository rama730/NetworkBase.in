import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

process.env.JOB_REQUEST_SECRET ??= "test-job-secret-test-job-secret-0123";
const authDeletes: string[] = [];
let authFailure: string | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({
    auth: { admin: { deleteUser: async (id: string) => { authDeletes.push(id); return { error: authFailure ? { message: authFailure } : null }; } } },
  }),
  createClient: async () => { throw new Error("not used"); },
});

let deletion: typeof import("../../src/lib/account/deletion");
let hard: typeof import("../../src/lib/account/hard-delete");
let job: typeof import("../../src/lib/security/job-request");
before(async () => {
  deletion = await loadAppModule(() => import("../../src/lib/account/deletion"));
  hard = await loadAppModule(() => import("../../src/lib/account/hard-delete"));
  job = await loadAppModule(() => import("../../src/lib/security/job-request"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const finalize = (userId: string, deletionId: string) =>
  hard.executeHardDelete(userId, deletionId, job.createSignedJobRequestToken({ kind: hard.ACCOUNT_HARD_DELETE_JOB_KIND, actorId: userId, subjectId: deletionId }));

async function scheduledUser(visibility: string) {
  const userId = await sql.begin((tx) => createUser(tx, { visibility }));
  const result = await deletion.scheduleAccountDeletionForUser({ userId, email: `${userId}@x.test`, username: null, reason: null });
  assert.ok(result.ok);
  return { userId, deletionId: result.deletionId };
}

test("SEC-002: cancelling restores the visibility the profile had before", async () => {
  for (const visibility of ["connections", "private", "public"]) {
    const { userId } = await scheduledUser(visibility);
    const [hidden] = await sql`SELECT visibility, deleted_at IS NOT NULL AS deleted FROM profiles WHERE id = ${userId}`;
    assert.deepEqual({ ...hidden }, { visibility: "private", deleted: true });
    assert.equal(await deletion.cancelAccountDeletionForUser(userId), "cancelled");
    const [restored] = await sql`SELECT visibility, deleted_at FROM profiles WHERE id = ${userId}`;
    assert.equal(restored?.visibility, visibility);
    assert.equal(restored?.deleted_at, null);
  }
});

test("COR-053: the finalizer runs only from storage_scheduled, past the grace period, never after cancel", async () => {
  const early = await scheduledUser("public");
  await sql`UPDATE account_deletions SET cleanup_status = 'storage_running', hard_delete_at = now() - interval '1 day' WHERE id = ${early.deletionId}`;
  assert.equal((await finalize(early.userId, early.deletionId)).success, false, "storage still running");

  const cancelled = await scheduledUser("public");
  await sql`UPDATE account_deletions SET cleanup_status = 'storage_scheduled', hard_delete_at = now() - interval '1 day' WHERE id = ${cancelled.deletionId}`;
  assert.equal(await deletion.cancelAccountDeletionForUser(cancelled.userId), "cancelled");
  assert.equal((await finalize(cancelled.userId, cancelled.deletionId)).success, false);
  const [kept] = await sql`SELECT count(*)::int AS n FROM profiles WHERE id = ${cancelled.userId}`;
  assert.equal(kept?.n, 1);
  assert.equal(authDeletes.includes(cancelled.userId), false);

  const notDue = await scheduledUser("public");
  await sql`UPDATE account_deletions SET cleanup_status = 'storage_scheduled' WHERE id = ${notDue.deletionId}`;
  assert.equal((await finalize(notDue.userId, notDue.deletionId)).success, false, "grace period not over");
});

test("COR-053: an Auth failure keeps db_deleted and the retry completes; cancel is then too late", async () => {
  const target = await scheduledUser("public");
  const projectId = await sql.begin((tx) => createProject(tx, target.userId));
  await sql`UPDATE account_deletions SET cleanup_status = 'storage_scheduled', hard_delete_at = now() - interval '1 day' WHERE id = ${target.deletionId}`;
  authFailure = "auth unavailable";
  assert.equal((await finalize(target.userId, target.deletionId)).success, false);
  const [mid] = await sql`SELECT cleanup_status, completed_at FROM account_deletions WHERE id = ${target.deletionId}`;
  assert.deepEqual({ ...mid }, { cleanup_status: "db_deleted", completed_at: null });
  const [gone] = await sql`SELECT (SELECT count(*)::int FROM profiles WHERE id = ${target.userId}) AS profiles, (SELECT count(*)::int FROM projects WHERE id = ${projectId}) AS projects`;
  assert.deepEqual({ ...gone }, { profiles: 0, projects: 0 });
  assert.equal(await deletion.cancelAccountDeletionForUser(target.userId), "too_late");
  authFailure = null;
  assert.equal((await finalize(target.userId, target.deletionId)).success, true);
  const [done] = await sql`SELECT cleanup_status, completed_at IS NOT NULL AS completed FROM account_deletions WHERE id = ${target.deletionId}`;
  assert.deepEqual({ ...done }, { cleanup_status: "completed", completed: true });
});
