import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A4.1 (report 38.11 D1): meetings, series, Finish with carried action items, reminders, Open action items.


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
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true, time_zone = 'Asia/Kolkata' WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'ideas', ${owner!}), (${ws}, 'project_planner', ${owner!}), (${ws}, 'roadmap', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const doc = async (slug: string) => {
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', ${slug + ".md"}, ${"/" + slug + ".md"}, ${owner!}) RETURNING id`;
    const [row] = await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${ws}, ${node!.id}, ${slug}, ${slug + ".md"}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })}) RETURNING id`;
    return row!.id as string;
  };
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws, doc };
}
const settingsOf = async (id: string) => (await sql`SELECT settings FROM workspace_documents WHERE id = ${id}`)[0]!.settings;
const ist = (s: string) => new Date(`${s}+05:30`).toISOString();

const ideasDoc = async (t: Awaited<ReturnType<typeof workspace>>, slug = "ideas") => {
  await t.doc(slug);
  return docs.createIdeasDocAction(t.ws, { docSlug: slug });
};
const fields = async (id: string) => (await sql`SELECT stage, status, type_fields FROM tasks WHERE id = ${id}`)[0]!;

test("W1–W4: an Ideas document; add, score and rank; Validating adds the checklist once; viewers read only; outsiders see nothing", async () => {
  const t = await workspace();
  viewerId = t.owner;
  assert.ok((await ideasDoc(t)).success);
  const a = await docs.addIdeaAction(t.ws, { docSlug: "ideas", title: "Template shop", pitch: "Sell starter kits", impact: 4, ease: 3, confidence: 2 });
  const b = await docs.addIdeaAction(t.ws, { docSlug: "ideas", title: "Dark mode" });
  assert.ok(a.success && b.success);
  viewerId = t.member;
  assert.ok((await docs.scoreIdeaAction(t.ws, { taskId: b.id, impact: 5, ease: 5, confidence: 2 })).success);
  let read = await docs.readIdeasAction(t.ws, "ideas");
  assert.ok(read.success);
  assert.deepEqual(read.ranked.map((i) => [i.title, i.score, i.rank]), [["Dark mode", 50, 1], ["Template shop", 24, 2]]);
  assert.ok((await docs.validateIdeaAction(t.ws, { taskId: a.id })).success);
  assert.equal((await docs.validateIdeaAction(t.ws, { taskId: a.id }) as { error?: string }).error, "Only a new idea moves to Validating.");
  read = await docs.readIdeasAction(t.ws, "ideas");
  assert.ok(read.success);
  const shop = read.ranked.find((i) => i.title === "Template shop")!;
  assert.deepEqual([shop.stage, shop.validation], ["validating", { done: 0, total: 3 }]);
  assert.deepEqual((await sql`SELECT title FROM task_subtasks WHERE task_id = ${a.id} ORDER BY position`).map((r) => r.title), ["Talk to 5 people", "Landing page", "First sign-up"]);
  viewerId = t.viewer;
  assert.ok((await docs.readIdeasAction(t.ws, "ideas")).success, "viewers read");
  assert.equal((await docs.scoreIdeaAction(t.ws, { taskId: a.id, impact: 1 }) as { error?: string }).error, "Only workspace members change ideas.");
  assert.equal((await docs.addIdeaAction(t.ws, { docSlug: "ideas", title: "x" }) as { error?: string }).error, "Only workspace members add ideas.");
  await sql`UPDATE workspaces SET visibility = 'public', public_tab_visibility = '{"tasks": true}'::jsonb WHERE id = ${t.ws}`;
  viewerId = t.outsider;
  assert.equal((await docs.readIdeasAction(t.ws, "ideas") as { error?: string }).error, "Ideas are for workspace members.");
  const detail = await tasksServer.getWorkspaceTaskDetailAction(t.ws, a.id) as { success?: boolean; task?: unknown };
  assert.ok(!(detail.success && detail.task), "never public, even with a public Tasks tab");
});

test("W5–W7: Start building makes one linked item and moves the idea to Building (author told); finishing it makes the idea Launched; Drop needs a reason", async () => {
  const t = await workspace();
  viewerId = t.member;
  assert.equal(((await ideasDoc(t, "ideas-m")) as { error?: string }).error, "Only people who can edit documents make an Ideas document.");
  viewerId = t.owner;
  assert.ok((await ideasDoc(t)).success);
  viewerId = t.member;
  const a = await docs.addIdeaAction(t.ws, { docSlug: "ideas", title: "Template shop", pitch: "Sell starter kits" });
  const c = await docs.addIdeaAction(t.ws, { docSlug: "ideas", title: "Podcast" });
  assert.ok(a.success && c.success);
  viewerId = t.owner;
  const built = await docs.startBuildingAction(t.ws, { taskId: a.id, as: "task" });
  assert.ok(built.success, JSON.stringify(built));
  assert.equal((await docs.startBuildingAction(t.ws, { taskId: a.id, as: "project" }) as { error?: string }).error, "This idea is already being built or closed.");
  const idea = await fields(a.id);
  assert.deepEqual([idea.stage, idea.type_fields.builtAs], ["building", built.builtId]);
  const [made] = await sql`SELECT title, description, item_type FROM tasks WHERE id = ${built.builtId}`;
  assert.deepEqual([made!.title, made!.item_type ?? "task"], ["Template shop", "task"]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'Building: Template shop'`)[0]!.n, 1);
  // Finishing the built task makes the idea Launched.
  const moved = await taskActions.updateTaskStatusAction(built.builtId!, "done", t.ws) as { success?: boolean; error?: string };
  assert.ok(moved.success, JSON.stringify(moved));
  assert.equal((await fields(a.id)).stage, "launched");
  // A roadmap item: Launched when the item launches.
  const r = await docs.startBuildingAction(t.ws, { taskId: c.id, as: "roadmap_item" });
  assert.ok(r.success, JSON.stringify(r));
  assert.equal((await fields(c.id)).stage, "building");
  // Drop needs a reason.
  const d = await docs.addIdeaAction(t.ws, { docSlug: "ideas", title: "Merch" });
  assert.ok(d.success);
  assert.equal((await docs.dropIdeaAction(t.ws, { taskId: d.id, reason: " " }) as { error?: string }).error, "Say why it's dropped.");
  assert.ok((await docs.dropIdeaAction(t.ws, { taskId: d.id, reason: "No demand" })).success);
  const read = await docs.readIdeasAction(t.ws, "ideas");
  assert.ok(read.success);
  assert.deepEqual([read.dropped.map((x) => [x.title, x.droppedReason]), read.ranked.some((x) => x.title === "Merch")], [[["Merch", "No demand"]], false]);
  // Save as idea lands in the workspace's Ideas document.
  const saved = await docs.saveAsIdeaAction(t.ws, { title: "Offline mode", pitch: "From an interview" });
  assert.ok(saved.success && "docSlug" in saved && saved.docSlug === "ideas");
});
