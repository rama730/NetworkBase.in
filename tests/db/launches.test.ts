import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A3.1 (report 38.10 D2): launches are documents whose steps are tasks; Launch, Close, Move date, Cancel.


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

let docs: typeof import("../../src/app/actions/workspace/doc");
let taskActions: typeof import("../../src/app/actions/task");
let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  // A test preset with steps (the real presets arrive in A3.2–A3.8).
  const launches = await loadAppModule(() => import("../../src/lib/workflows/launches"));
  launches.LAUNCH_PRESETS.push({ id: "test_two", name: "Test", stages: [{ name: "Build", steps: ["Freeze", "QA"] }, { name: "After", steps: ["Watch"] }] });
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'launches', ${owner!}), (${ws}, 'roadmap', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const doc = async (slug: string) => {
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', ${slug + ".md"}, ${"/" + slug + ".md"}, ${owner!}) RETURNING id`;
    const [row] = await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${ws}, ${node!.id}, ${slug}, ${slug + ".md"}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })}) RETURNING id`;
    return row!.id as string;
  };
  return { owner: owner!, member: member!, viewer: viewer!, ws, doc };
}
const settingsOf = async (id: string) => (await sql`SELECT settings FROM workspace_documents WHERE id = ${id}`)[0]!.settings;

test("W1–W5: a launch is filed with its preset's steps; the first step starting makes it Getting ready; Launch marks items and never posts", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("v2-4");
  assert.equal((await docs.createLaunchAction(t.ws, { docSlug: "v2-4", date: "2026-12-12", preset: "nope" }) as { error?: string }).error, "Pick a preset");
  assert.ok((await docs.createLaunchAction(t.ws, { docSlug: "v2-4", date: "2026-12-12", preset: "test_two", versionLabel: "v2.4" })).success);
  const s = await settingsOf(id);
  assert.deepEqual([s.section, s.kind, s.date, s.launchStage, s.versionLabel], ["launches", "test_two", "2026-12-12", "planning", "v2.4"]);
  const steps = await sql`SELECT id, title, source_block, assignee_id, due_date, status FROM tasks WHERE source_doc_id = ${id} ORDER BY source_block, source_position`;
  assert.deepEqual(steps.map((r) => [r.title, r.source_block, r.assignee_id, r.due_date]), [["Freeze", "launch1", null, null], ["QA", "launch1", null, null], ["Watch", "launch2", null, null]]);
  // What ships and What's new.
  const make = async (input: Record<string, unknown>) => ((await tasksServer.createTaskAction({ projectId: t.ws, status: "todo", priority: "medium", ...input } as never)) as { task: { id: string } }).task.id;
  const sso = await make({ title: "SSO", itemType: "roadmap_item", stage: "testing", typeFields: { column: "now", itemType: "feature" } });
  const search = await make({ title: "Faster search", itemType: "roadmap_item", stage: "planned", typeFields: { column: "next", itemType: "improvement" } });
  for (const itemId of [sso, search]) assert.ok((await docs.setLaunchShipsAction(t.ws, { docSlug: "v2-4", itemId, on: true })).success);
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, item_type, stage, type_fields) VALUES (${t.ws}, 'Login typo', 'done', 'medium', ${t.owner}, 'bug', 'fixed', ${sql.json({ fixedIn: "V2.4" })})`;
  const read = await docs.readLaunchAction(t.ws, "v2-4");
  assert.ok(read.success);
  assert.deepEqual([read.progress.text, read.ships.length, read.whatsNew], ["0 of 3 steps", 2, { added: ["SSO"], improved: ["Faster search"], fixed: ["Login typo"] }]);
  // W2: the first step starting.
  assert.ok((await taskActions.updateTaskStatusAction(steps[0]!.id, "in_progress", t.ws)).success);
  assert.equal((await settingsOf(id)).launchStage, "getting_ready");
  await sql`UPDATE tasks SET assignee_id = ${t.member} WHERE id = ${steps[1]!.id}`;
  // W5: viewers can't launch; the editor's Launch marks items Launched and returns the Update's text only.
  viewerId = t.viewer;
  assert.match((await docs.launchAction(t.ws, { docSlug: "v2-4", markItems: true }) as { error?: string }).error ?? "", /Only people who can edit/);
  viewerId = t.owner;
  const updatesBefore = (await sql`SELECT count(*)::int AS n FROM workspace_updates WHERE workspace_id = ${t.ws}`)[0]!.n;
  const launched = await docs.launchAction(t.ws, { docSlug: "v2-4", markItems: true });
  assert.ok(launched.success && launched.marked === 2, JSON.stringify(launched));
  assert.match(launched.update, /\*\*Added\*\*\n- SSO/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_updates WHERE workspace_id = ${t.ws}`)[0]!.n, updatesBefore, "never posts an Update");
  assert.deepEqual((await sql`SELECT stage FROM tasks WHERE id IN (${sso}, ${search})`).map((r) => r.stage), ["launched", "launched"]);
  assert.deepEqual((await sql`SELECT title, importance FROM user_notifications WHERE user_id = ${t.member} AND title LIKE 'Launched:%'`).map((r) => `${r.title}|${r.importance}`), ["Launched: v2-4|more"]);
  const after1 = await settingsOf(id);
  assert.equal(after1.launchStage, "launched");
  assert.ok(after1.launchedAt);
  // W6: Close with the Backlog option takes open steps out of sprints.
  assert.ok((await docs.closeLaunchAction(t.ws, { docSlug: "v2-4", remaining: "backlog" })).success);
  assert.equal((await settingsOf(id)).launchStage, "closed");
});

test("W7–W8: moving the date shifts dated steps when asked; Cancel sends items back to Planned", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("v3");
  assert.ok((await docs.createLaunchAction(t.ws, { docSlug: "v3", date: "2026-12-12", preset: "test_two" })).success);
  const [step] = await sql`SELECT id FROM tasks WHERE source_doc_id = ${id} AND title = 'Freeze'`;
  assert.ok((await taskActions.updateTaskFieldAction(step!.id, "dueDate", "2026-12-08T00:00:00.000Z", t.ws)).success);
  const moved = await docs.moveLaunchDateAction(t.ws, { docSlug: "v3", date: "2026-12-17", shiftSteps: true });
  assert.ok(moved.success && moved.moved === 1, JSON.stringify(moved));
  assert.equal((await sql`SELECT due_date::date::text AS d FROM tasks WHERE id = ${step!.id}`)[0]!.d, "2026-12-13");
  assert.equal((await settingsOf(id)).date, "2026-12-17");
  const item = ((await tasksServer.createTaskAction({ projectId: t.ws, title: "Dark mode", status: "todo", priority: "medium", itemType: "roadmap_item", stage: "testing", typeFields: { column: "now" } } as never)) as { task: { id: string } }).task.id;
  assert.ok((await docs.setLaunchShipsAction(t.ws, { docSlug: "v3", itemId: item, on: true })).success);
  assert.ok((await docs.cancelLaunchAction(t.ws, { docSlug: "v3", backlogSteps: false })).success);
  const r = (await sql`SELECT stage, type_fields FROM tasks WHERE id = ${item}`)[0]!;
  assert.deepEqual([r.stage, (r.type_fields as { launchDocId?: string }).launchDocId ?? null, (await settingsOf(id)).launchStage], ["planned", null, "cancelled"]);
  assert.equal((await docs.launchAction(t.ws, { docSlug: "v3", markItems: true }) as { error?: string }).error, "This launch was canceled.");
});

test("A3.2: a Product launch lands its 18 steps in seven blocks, unassigned and undated", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("big-launch");
  assert.ok((await docs.createLaunchAction(t.ws, { docSlug: "big-launch", date: "2027-01-15", preset: "product" })).success);
  const rows = await sql`SELECT source_block AS b, count(*)::int AS n, count(assignee_id)::int AS a, count(due_date)::int AS d FROM tasks WHERE source_doc_id = ${id} GROUP BY source_block ORDER BY source_block`;
  assert.deepEqual(rows.map((r) => [r.b, r.n]), [["launch1", 3], ["launch2", 2], ["launch3", 3], ["launch4", 2], ["launch5", 2], ["launch6", 3], ["launch7", 3]]);
  assert.equal(rows.reduce((n, r) => n + r.a + r.d, 0), 0);
});
