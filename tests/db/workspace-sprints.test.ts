import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §42.18 #4: a normal workspace's sprints, so organization changes to shared code can't quietly change them.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.121" }) });

let sprints: typeof import("../../src/lib/workspaces/server/sprints");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function workspace() {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  created.push(id);
  return { id, owner: owner!, member: member! };
}

/** A started sprint whose end has passed, holding one open and one done task. */
async function endedSprint(w: Awaited<ReturnType<typeof workspace>>, name: string) {
  const made = await sprints.createSprintAction({ projectId: w.id, name, startDate: day(-10), endDate: day(-2) });
  assert.ok(made.success, JSON.stringify(made));
  const id = made.success ? made.sprint.id : "";
  assert.equal((await sprints.startSprintNowAction(id, w.id)).success, true);
  const [open] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, sprint_id, status) VALUES (${w.id}, 'Open', ${w.owner}, ${id}, 'todo') RETURNING id`;
  const [done] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, sprint_id, status) VALUES (${w.id}, 'Done', ${w.owner}, ${id}, 'done') RETURNING id`;
  return { id, open: open!.id as string, done: done!.id as string };
}
const sprintOf = async (taskId: string) => (await sql`SELECT sprint_id FROM tasks WHERE id = ${taskId}`)[0]!.sprint_id as string | null;

test("members can't manage sprints; the owner creates and starts one", async () => {
  const w = await workspace();
  viewerId = w.member;
  assert.equal((await sprints.createSprintAction({ projectId: w.id, name: "Sprint 1", startDate: day(0), endDate: day(7) })).success, false);
  viewerId = w.owner;
  const made = await sprints.createSprintAction({ projectId: w.id, name: "Sprint 1", startDate: day(0), endDate: day(7), autoStart: false });
  assert.ok(made.success);
  assert.equal((await sprints.startSprintNowAction(made.success ? made.sprint.id : "", w.id)).success, true);
  const [row] = await sql`SELECT status FROM workspace_sprints WHERE workspace_id = ${w.id}`;
  assert.equal(row!.status, "active");
});

test("Complete before the end date is refused; after it, Keep leaves unfinished work in the sprint", async () => {
  const w = await workspace();
  viewerId = w.owner;
  const early = await sprints.createSprintAction({ projectId: w.id, name: "Running", startDate: day(-1), endDate: day(5) });
  const earlyId = early.success ? early.sprint.id : "";
  await sprints.startSprintNowAction(earlyId, w.id);
  assert.equal((await sprints.completeSprintAction(earlyId, w.id)).success, false);
  await sprints.cancelSprintAction(earlyId, w.id);
  const s = await endedSprint(w, "Sprint 1");
  assert.equal((await sprints.completeSprintAction(s.id, w.id, { unfinished: "keep" })).success, true);
  assert.deepEqual([await sprintOf(s.open), await sprintOf(s.done)], [s.id, s.id]);
});

test("Complete can move unfinished work to the backlog or the next planned sprint; done work stays", async () => {
  const w = await workspace();
  viewerId = w.owner;
  const a = await endedSprint(w, "Sprint 1");
  assert.equal((await sprints.completeSprintAction(a.id, w.id, { unfinished: "backlog" })).success, true);
  assert.deepEqual([await sprintOf(a.open), await sprintOf(a.done)], [null, a.id]);
  const b = await endedSprint(w, "Sprint 2");
  const next = await sprints.createSprintAction({ projectId: w.id, name: "Sprint 3", startDate: day(10), endDate: day(17) });
  const nextId = next.success ? next.sprint.id : "";
  assert.equal((await sprints.completeSprintAction(b.id, w.id, { unfinished: "next_sprint", nextSprintId: nextId })).success, true);
  assert.deepEqual([await sprintOf(b.open), await sprintOf(b.done)], [nextId, b.id]);
});

test("Cancel returns the sprint's work to the backlog and keeps the sprint as Cancelled", async () => {
  const w = await workspace();
  viewerId = w.owner;
  const s = await endedSprint(w, "Sprint 1");
  assert.equal((await sprints.cancelSprintAction(s.id, w.id)).success, true);
  assert.deepEqual([await sprintOf(s.open), await sprintOf(s.done)], [null, null]);
  const [row] = await sql`SELECT status FROM workspace_sprints WHERE id = ${s.id}`;
  assert.equal(row!.status, "cancelled");
});
