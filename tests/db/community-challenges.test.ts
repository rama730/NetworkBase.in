import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { copyState } from "../../src/lib/organizations/assignment-rules";
import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.4a (report 34.5 call 1): a community challenge is an Optional assignment — copies only for people who Join, never
// Missing or Overdue; Leave removes a copy with nothing handed in; no reminders to take part.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.242" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let assignments: typeof import("../../src/app/actions/assignments");
let ch: typeof import("../../src/app/actions/community-challenges");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  ch = await loadAppModule(() => import("../../src/app/actions/community-challenges"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(type: string) {
  const [owner, a, b, viewer] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member'), (${id}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = ${type}, status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  return { id, owner: owner!, a: a!, b: b!, viewer: viewer! };
}
const challenge = (orgId: string, due: string) => assignments.createAssignmentAction({ projectId: orgId, title: "Build a CLI", description: "Make a tool you'd use every day.", dueDate: due, publish: true,
  submissionType: "link", reviewRequired: false, lateRule: "none", target: { mode: "optional" }, steps: [] });

test("34.5 call 1: nobody gets a copy until they Join; a joined copy has no due date and is never Missing; Leave; no reminders", async () => {
  const o = await org("community");
  viewerId = o.owner;
  const made = await challenge(o.id, new Date(Date.now() + 2 * 864e5).toISOString());
  assert.ok(made.success, JSON.stringify(made));
  const masterId = made.success ? made.masterId : "";
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${masterId}`)[0]!.n, 0, "no copies at publish");

  viewerId = o.a;
  const joined = await ch.joinChallengeAction(o.id, masterId);
  assert.ok(joined.success);
  const again = await ch.joinChallengeAction(o.id, masterId);
  assert.ok(again.success && joined.success && again.copyId === joined.copyId, "one copy each");
  const [copy] = await sql`SELECT due_date, status, review_status, excused_at, completed_at FROM tasks WHERE id = ${joined.success ? joined.copyId : ""}`;
  assert.equal(copy!.due_date, null);
  const st = copyState({ dueDate: null, status: copy!.status, reviewStatus: copy!.review_status, excusedAt: null, completedAt: null, submittedAt: null } as Parameters<typeof copyState>[0], new Date(Date.now() + 365 * 864e5));
  assert.notEqual(st.state, "missing", "never Missing, even long after");

  for (const who of [o.viewer]) { viewerId = who; assert.equal((await ch.joinChallengeAction(o.id, masterId)).success, false, "viewers don't join"); }
  viewerId = o.owner;
  assert.equal((await assignments.remindCopiesAction(masterId)).success, false, "no reminders to take part");

  viewerId = o.a;
  let list = await ch.readChallengesAction(o.id);
  assert.ok(list.success && list.challenges[0]!.joined === 1 && list.challenges[0]!.mine);
  assert.ok((await ch.leaveChallengeAction(o.id, masterId)).success);
  list = await ch.readChallengesAction(o.id);
  assert.ok(list.success && list.challenges[0]!.joined === 0 && !list.challenges[0]!.mine);

  // A paused member can't join; a closed challenge takes nobody.
  await sql`UPDATE workspaces SET org_settings = jsonb_build_object('community', jsonb_build_object('pauses', jsonb_build_object(${o.b}::text, jsonb_build_object('until', ${new Date(Date.now() + 36e5).toISOString()}::text)))) WHERE id = ${o.id}`;
  viewerId = o.b;
  assert.equal((await ch.joinChallengeAction(o.id, masterId)).success, false);
  await sql`UPDATE tasks SET due_date = now() - interval '1 hour' WHERE id = ${masterId}`;
  viewerId = o.a;
  assert.equal((await ch.joinChallengeAction(o.id, masterId)).success, false, "closed");
});

test("34.5: optional challenges are for communities only; a handed-in entry stays when you Leave", async () => {
  const e = await org("education");
  viewerId = e.owner;
  const refused = await challenge(e.id, new Date(Date.now() + 864e5).toISOString());
  assert.equal(refused.success, false);

  const o = await org("community");
  viewerId = o.owner;
  const made = await challenge(o.id, new Date(Date.now() + 864e5).toISOString());
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  viewerId = o.a;
  const joined = await ch.joinChallengeAction(o.id, masterId);
  assert.ok(joined.success);
  assert.ok((await assignments.submitAssignmentAction(joined.copyId, { link: "https://example.com/tz-now" })).success);
  assert.equal((await ch.leaveChallengeAction(o.id, masterId)).success, false, "handed in: it stays");
  const list = await ch.readChallengesAction(o.id);
  assert.ok(list.success && list.challenges[0]!.entries === 1 && list.challenges[0]!.mine?.handedIn);
});
