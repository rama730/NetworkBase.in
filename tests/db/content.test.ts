import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A2.7 (report 38.8 T5): content settings, ideas, pieces with channels and types, planning onto a day.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.175" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
let content: typeof import("../../src/app/actions/content");
let workflows: typeof import("../../src/lib/workflows/server");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  content = await loadAppModule(() => import("../../src/app/actions/content"));
  workflows = await loadAppModule(() => import("../../src/lib/workflows/server"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
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
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'content', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws };
}
const row = async (id: string) => (await sql`SELECT stage, status, on_board, assignee_id, type_fields, due_date::text AS due_date FROM tasks WHERE id = ${id}`)[0]!;
const subtasks = async (id: string) => (await sql`SELECT title FROM task_subtasks WHERE task_id = ${id} ORDER BY position`).map((r) => r.title);

test("W1–W4: owners set up channels; ideas sit off the board; a piece's channels and type are checked; publish time follows the day", async () => {
  const t = await workspace();
  await sql`UPDATE workspaces SET time_zone = 'Asia/Kolkata' WHERE id = ${t.ws}`;
  viewerId = t.member;
  assert.equal((await content.addIdeaAction({ projectId: t.ws, title: "Morning routine reel" }) as { error?: string }).error, "Set up Content’s channels first");
  const starter = await content.starterContentSettingsAction(["blog", "social"]);
  assert.ok(starter.success);
  assert.equal((await content.saveContentSettingsAction({ projectId: t.ws, settings: starter.settings }) as { error?: string }).error, "Only owners and admins set channels and types");
  viewerId = t.owner;
  assert.ok((await content.saveContentSettingsAction({ projectId: t.ws, settings: starter.settings })).success);
  viewerId = t.member;
  const idea = await content.addIdeaAction({ projectId: t.ws, title: "Morning routine reel" });
  assert.ok(idea.success);
  const ideaId = (idea as { id: string }).id;
  assert.deepEqual([(await row(ideaId)).stage, (await row(ideaId)).on_board, (await row(ideaId)).due_date], ["idea", false, null]);
  const bad = await tasksServer.createTaskAction({ projectId: t.ws, title: "X", status: "todo", priority: "medium", itemType: "content", stage: "drafting", typeFields: { channels: ["myspace"] } } as never);
  assert.equal((bad as { error?: string }).error, "Pick channels from this workspace’s list");
  // From Tasks at Drafting with a due day: 10:00 in Kolkata, and the Reel checklist.
  const made = await tasksServer.createTaskAction({ projectId: t.ws, title: "Pricing reel", status: "todo", priority: "medium", itemType: "content", stage: "drafting",
    dueDate: "2026-12-03", typeFields: { channels: ["instagram", "tiktok"], contentType: "reel" } } as never);
  assert.ok(made.success, JSON.stringify(made));
  const pieceId = (made as { task: { id: string } }).task.id;
  const piece = await row(pieceId);
  assert.deepEqual([piece.stage, piece.on_board, (piece.type_fields as { publishAt: string }).publishAt, piece.due_date.slice(0, 10)], ["drafting", true, "2026-12-03T04:30:00.000Z", "2026-12-03"]);
  assert.deepEqual(await subtasks(pieceId), ["Hook", "Captions", "Cover image"]);
  // W3: planning an idea onto a day makes it Drafting, the planner its writer, with the checklist and the default time.
  await sql`UPDATE tasks SET type_fields = type_fields || '{"contentType":"reel"}'::jsonb WHERE id = ${ideaId}`;
  const planned = await content.planContentAction({ projectId: t.ws, taskId: ideaId, day: "2026-12-10" });
  assert.ok(planned.success, JSON.stringify(planned));
  const p = await row(ideaId);
  assert.deepEqual([p.stage, p.on_board, p.assignee_id, (p.type_fields as { publishAt: string }).publishAt, p.due_date.slice(0, 10)], ["drafting", true, t.member, "2026-12-10T04:30:00.000Z", "2026-12-10"]);
  assert.deepEqual(await subtasks(ideaId), ["Hook", "Captions", "Cover image"]);
  // Moving it again keeps the stage and the checklist; a time can be given.
  assert.ok((await content.planContentAction({ projectId: t.ws, taskId: ideaId, day: "2026-12-11", time: "18:30" })).success);
  assert.deepEqual([(await row(ideaId)).stage, ((await row(ideaId)).type_fields as { publishAt: string }).publishAt, (await subtasks(ideaId)).length], ["drafting", "2026-12-11T13:00:00.000Z", 3]);
  viewerId = t.viewer;
  assert.equal((await content.planContentAction({ projectId: t.ws, taskId: ideaId, day: "2026-12-12" }) as { error?: string }).error, "Viewers can’t plan content");
  const read = await content.readContentAction(t.ws);
  assert.ok(read.success && read.items.length === 2 && read.timeZone === "Asia/Kolkata" && read.settings?.channels.length === 8);
});
