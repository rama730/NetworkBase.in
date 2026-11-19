import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A1.1 (report 38.5 T1 W8, W11): the Calendar's read: items due in the visible days (calendar days at UTC
// midnight), open items with no date for the tray, the scope menu, and members only.

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

async function workspace() {
  const [owner, member, outsider] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { publicTabVisibility: { tasks: true } }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member')`;
  const add = async (title: string, due: string | null, extra: Record<string, unknown> = {}) => {
    const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${ws} AND is_default AND status = 'todo' LIMIT 1`;
    const [n] = await sql`SELECT coalesce(max(task_number), 0) + 1 AS n FROM tasks WHERE workspace_id = ${ws}`;
    await sql`INSERT INTO tasks ${sql({ workspace_id: ws, title, status: "todo", priority: "medium", creator_id: owner!, due_date: due, task_number: n!.n, workflow_column_id: col?.id ?? null, ...extra })}`;
  };
  return { owner: owner!, member: member!, outsider: outsider!, ws, add };
}

test("W8: items due in the range by calendar day, open no-date items for the tray, Mine narrows, done items stay off the tray", async () => {
  const t = await workspace();
  await t.add("On Oct 26", "2026-10-26T00:00:00Z");
  await t.add("On Nov 20", "2026-11-20T00:00:00Z", { assignee_id: t.member });
  await t.add("Late Nov 30", "2026-11-30T23:30:00Z");
  await t.add("After range", "2026-12-07T00:00:00Z");
  await t.add("No date open", null);
  await t.add("No date done", null, { status: "done" });
  await t.add("Bug off board", "2026-11-21T00:00:00Z", { item_type: "bug", stage: "new", on_board: false });
  viewerId = t.owner;
  const all = await tasksServer.readCalendarAction(t.ws, { from: "2026-10-26", to: "2026-12-06" });
  assert.ok(all.success, JSON.stringify(all));
  assert.deepEqual(all.items.map((i) => i.title), ["On Oct 26", "On Nov 20", "Bug off board", "Late Nov 30"]);
  assert.deepEqual([all.noDate.map((i) => i.title), all.noDateCount, all.canEdit], [["No date open"], 1, true]);
  assert.equal(all.items.find((i) => i.title === "Bug off board")!.itemType, "bug");
  viewerId = t.member;
  const mine = await tasksServer.readCalendarAction(t.ws, { from: "2026-10-26", to: "2026-12-06", scope: "mine" });
  assert.deepEqual(mine.success && mine.items.map((i) => i.title), ["On Nov 20"]);
});

test("W11: a visitor never reads the Calendar, even with Tasks public; a bad range is refused", async () => {
  const t = await workspace();
  viewerId = t.outsider;
  assert.equal((await tasksServer.readCalendarAction(t.ws, { from: "2026-11-01", to: "2026-11-30" })).success, false);
  viewerId = t.owner;
  assert.equal((await tasksServer.readCalendarAction(t.ws, { from: "Nov 1", to: "2026-11-30" })).success, false);
});
