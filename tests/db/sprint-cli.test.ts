import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report F2 (M7): sprints from the terminal: create, add tasks by number, close with the unfinished tasks moved to the
// next planned sprint or the backlog, and a burndown of tasks left each day.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }), getSession: async () => ({ data: { session: null }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.90" }) });

let cli: typeof import("../../src/lib/workspaces/server/sprint-cli");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId, user_metadata: {} } : null, userId: viewerId || null, emailVerified: true }),
  });
  cli = await loadAppModule(() => import("../../src/lib/workspaces/server/sprint-cli"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("create, add by number, burndown, close: unfinished tasks go to the next planned sprint, else the backlog", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const member = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, ws, member, "member"));
  viewerId = owner;
  const { sprint } = await cli.createSprintFromCli(ws, { name: "Week 1", from: day(-2), to: day(4), goal: "Ship" }) as { sprint: { id: string } };
  await sql`UPDATE workspace_sprints SET status = 'active' WHERE id = ${sprint.id}`;
  const t = await sql`INSERT INTO tasks (workspace_id, title, creator_id, status, task_number) VALUES (${ws}, 'One', ${owner}, 'todo', 1), (${ws}, 'Two', ${owner}, 'done', 2), (${ws}, 'Three', ${owner}, 'todo', 3) RETURNING id`;
  await sql`UPDATE tasks SET completed_at = now() - interval '1 day' WHERE id = ${t[1]!.id}`;
  await assert.rejects(cli.addTasksToSprint(member, ws, sprint.id, [1, 9]), /No task #9/);
  const added = await cli.addTasksToSprint(member, ws, sprint.id, [1, 2, 3, 3]);
  assert.deepEqual(added.added, [1, 2, 3]);
  assert.deepEqual(await cli.sprintBurndown(member, sprint.id), [], "another workspace's id reads nothing");
  const burndown = await cli.sprintBurndown(ws, sprint.id);
  assert.equal(burndown.length, 3, "from two days ago to today");
  assert.deepEqual(burndown.map((d) => d.left), [3, 2, 2]);
  // Done before completion times were kept: done throughout, never "left".
  await sql`UPDATE tasks SET completed_at = NULL WHERE id = ${t[1]!.id}`;
  assert.deepEqual((await cli.sprintBurndown(ws, sprint.id)).map((d) => d.left), [2, 2, 2]);
  // A member can't close (owners and admins, as in the app); the owner can, with no next sprint: the backlog.
  viewerId = member;
  await assert.rejects(cli.closeSprintFromCli(ws, sprint.id), /owner and admins/);
  viewerId = owner;
  const closed = await cli.closeSprintFromCli(ws, sprint.id);
  assert.deepEqual([closed.moved, closed.to], [2, "backlog"]);
  const left = await sql`SELECT task_number, sprint_id FROM tasks WHERE workspace_id = ${ws} AND status <> 'done' ORDER BY task_number`;
  assert.deepEqual(left.map((r) => r.sprint_id), [null, null]);
  await assert.rejects(cli.closeSprintFromCli(ws, sprint.id), { code: "CONFLICT" }, "only a running sprint closes");
});

test("close moves unfinished tasks to the next planned sprint when there is one", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  viewerId = owner;
  const { sprint: a } = await cli.createSprintFromCli(ws, { name: "Week 1", from: day(-6), to: day(0) }) as { sprint: { id: string } };
  const { sprint: b } = await cli.createSprintFromCli(ws, { name: "Week 2", from: day(1), to: day(7) }) as { sprint: { id: string } };
  await sql`UPDATE workspace_sprints SET status = 'active' WHERE id = ${a.id}`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, status, task_number, sprint_id) VALUES (${ws}, 'Open', ${owner}, 'todo', 1, ${a.id})`;
  const closed = await cli.closeSprintFromCli(ws, a.id);
  assert.deepEqual(closed.to, { id: b.id, name: "Week 2" });
  const [task] = await sql`SELECT sprint_id FROM tasks WHERE workspace_id = ${ws} AND task_number = 1`;
  assert.equal(task!.sprint_id, b.id);
});
