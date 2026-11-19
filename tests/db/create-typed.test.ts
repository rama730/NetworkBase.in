import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A0.8 (report 38.4 F3 part 6, calls 3-4, W1, W2, W8): one create action for every type. The type must be
// added, the stage a starting one, the fields the type's; the stage sets status and the board; a member's sprint -> Backlog.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.174" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace(workflows: string[] = ["bugs"]) {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  for (const w of workflows) await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, ${w}, ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member')`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status) VALUES (${ws}, ${owner!}, 'Sprint 1', now() - interval '1 day', now() + interval '7 days', 'active') RETURNING id`;
  return { owner: owner!, member: member!, ws, sprint: sprint!.id as string };
}
const create = (ws: string, extra: Record<string, unknown>) => tasksServer.createTaskAction({ projectId: ws, title: "Login button does nothing", status: "todo", priority: "medium", ...extra } as never);
const row = async (id: string) => (await sql`SELECT item_type, stage, on_board, status, sprint_id FROM tasks WHERE id = ${id}`)[0]!;
const idOf = (r: Awaited<ReturnType<typeof create>>) => { assert.ok(r.success && r.task, JSON.stringify(r)); return (r as { task: { id: string } }).task.id; };

test("W1: a bug at Fixing joins the board in the chosen sprint; at New it stays off the board and in no sprint", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const fixing = await row(idOf(await create(t.ws, { itemType: "bug", stage: "fixing", sprintId: t.sprint })));
  assert.deepEqual([fixing.item_type, fixing.stage, fixing.on_board, fixing.status, fixing.sprint_id], ["bug", "fixing", true, "in_progress", t.sprint]);
  const fresh = await row(idOf(await create(t.ws, { itemType: "bug", stage: "new", sprintId: t.sprint })));
  assert.deepEqual([fresh.stage, fresh.on_board, fresh.status, fresh.sprint_id], ["new", false, "todo", null]);
  const plain = await row(idOf(await create(t.ws, {})));
  assert.deepEqual([plain.item_type, plain.stage, plain.on_board], ["task", null, true]);
});

test("refusals: a type not added, a hidden one (Create as task), a stage people can't start at, fields the type doesn't have", async () => {
  const t = await workspace(["bugs"]);
  viewerId = t.owner;
  const notAdded = await create(t.ws, { itemType: "request", stage: "new" });
  assert.deepEqual([notAdded.success, (notAdded as { error?: string }).error], [false, "Requests isn’t in this workspace"]);
  await sql`UPDATE workspace_workflows SET hidden_at = now() WHERE workspace_id = ${t.ws} AND workflow = 'bugs'`;
  const hidden = await create(t.ws, { itemType: "bug", stage: "new" }) as { success: boolean; error?: string; code?: string };
  assert.deepEqual([hidden.success, hidden.error, hidden.code], [false, "Bugs was removed from this workspace", "type_removed"]);
  await sql`UPDATE workspace_workflows SET hidden_at = NULL WHERE workspace_id = ${t.ws}`;
  const late = await create(t.ws, { itemType: "bug", stage: "verified" }) as { error?: string };
  assert.match(late.error ?? "", /New, Confirmed or Fixing/);
  const fields = await create(t.ws, { itemType: "bug", stage: "new", typeFields: { severity: "high" } }) as { error?: string };
  assert.match(fields.error ?? "", /severity/);
});

test("call 3: a member's sprint choice puts the item in the Backlog instead of failing", async () => {
  const t = await workspace();
  viewerId = t.member;
  const r = await create(t.ws, { sprintId: t.sprint });
  const task = await row(idOf(r));
  assert.deepEqual([task.sprint_id, (r as { backlogged?: boolean }).backlogged], [null, true]);
});
