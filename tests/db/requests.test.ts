import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A2.4 (report 38.7 T4): request types, asking with answers, Accept and Decline, who may do what.
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
let requests: typeof import("../../src/app/actions/requests");
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
  requests = await loadAppModule(() => import("../../src/app/actions/requests"));
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
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'requests', ${owner!}), (${ws}, 'bugs', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws };
}
const ask = async (ws: string, title: string, typeFields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  tasksServer.createTaskAction({ projectId: ws, title, status: "todo", priority: "medium", itemType: "request", stage: "new", typeFields, ...extra } as never);
const idOf = (r: unknown) => { assert.ok((r as { success: boolean }).success, JSON.stringify(r)); return (r as { task: { id: string } }).task.id; };
const row = async (id: string) => (await sql`SELECT stage, status, on_board, assignee_id, type_fields, item_type, due_date::text AS due_date FROM tasks WHERE id = ${id}`)[0]!;
const notes = async (user: string) => (await sql`SELECT title FROM user_notifications WHERE user_id = ${user} AND kind = 'project_task_activity' ORDER BY created_at`).map((r) => r.title);

test("W1–W3: starter types on first read; answers checked; viewers ask with Need by; triage people hear", async () => {
  const t = await workspace();
  viewerId = t.member;
  const read = await requests.readRequestTypesAction(t.ws);
  assert.ok(read.success);
  const [general, design] = read.types;
  assert.deepEqual([general!.name, design!.name], ["General request", "Design request"]);
  assert.equal((await ask(t.ws, "Logo", { requestTypeId: general!.id }) as { error?: string }).error, "Answer “What do you need?”");
  assert.equal((await ask(t.ws, "Banner", { requestTypeId: design!.id, answers: { what: "Poster", brief: "x" } }) as { error?: string }).error, "Pick one of the options for “What’s needed”");
  assert.equal((await ask(t.ws, "Banner", { requestTypeId: design!.id, answers: { what: "Banner", brief: "x", assets: [crypto.randomUUID()] } }) as { error?: string }).error, "Attach files from this workspace");
  const a = idOf(await ask(t.ws, "A logo for the launch", { answers: { need: "A logo" } }));
  assert.equal(((await row(a)).type_fields as { requestTypeId: string }).requestTypeId, general!.id, "the first type when left out");
  assert.deepEqual(await notes(t.owner), ["New request: A logo for the launch"]);
  viewerId = t.viewer;
  const v = idOf(await ask(t.ws, "Viewer ask", { requestTypeId: general!.id, answers: { need: "Help" } }, { dueDate: "2026-12-01", assigneeId: t.member }));
  assert.deepEqual([(await row(v)).stage, (await row(v)).assignee_id, String((await row(v)).due_date).slice(0, 10)], ["new", null, "2026-12-01"]);
  assert.equal((await tasksServer.createTaskAction({ projectId: t.ws, title: "Skip", status: "todo", priority: "medium", itemType: "request", stage: "accepted", typeFields: { answers: { need: "x" } } } as never)).success, false, "viewers only ask at New");
  assert.equal((await workflows.readWorkspaceWorkflows(t.ws, t.owner)).waiting?.requests, 2);
});

test("W4: Accept needs a member and a handler, joins the board, tells the asker; Decline needs a reason; bare Declined refused", async () => {
  const t = await workspace();
  viewerId = t.member;
  const a = idOf(await ask(t.ws, "Banner", { answers: { need: "Banner" } }));
  const b = idOf(await ask(t.ws, "Deck", { answers: { need: "Deck" } }));
  viewerId = t.viewer;
  assert.equal((await requests.acceptRequestAction({ projectId: t.ws, taskId: a, assigneeId: t.member }) as { error?: string }).error, "Viewers can’t accept requests");
  viewerId = t.owner;
  const ok = await requests.acceptRequestAction({ projectId: t.ws, taskId: a, assigneeId: t.member });
  assert.ok(ok.success, JSON.stringify(ok));
  const r = await row(a);
  assert.deepEqual([r.stage, r.status, r.on_board, r.assignee_id], ["accepted", "todo", true, t.member]);
  assert.ok((r.type_fields as { acceptedAt?: string; firstRepliedAt?: string }).acceptedAt && (r.type_fields as { firstRepliedAt?: string }).firstRepliedAt);
  assert.ok((await notes(t.member)).includes("Accepted: Banner"));
  assert.equal((await requests.acceptRequestAction({ projectId: t.ws, taskId: a, assigneeId: t.member }) as { error?: string }).error, "This request was already answered");
  const bare = await taskActions.setTaskStageAction({ taskId: b, projectId: t.ws, stage: "declined" });
  assert.equal((bare as { error?: string }).error, "Decline a request with Decline…, so the asker knows why");
  assert.equal((await requests.declineRequestAction({ projectId: t.ws, taskId: b, reason: " " })).success, false);
  assert.ok((await requests.declineRequestAction({ projectId: t.ws, taskId: b, reason: "Out of scope this month" })).success);
  assert.deepEqual([(await row(b)).stage, (await row(b)).on_board, ((await row(b)).type_fields as { declineReason: string }).declineReason], ["declined", false, "Out of scope this month"]);
  assert.ok((await notes(t.member)).includes("Declined: Deck"));
});

test("W4.4 and W9: a New request becomes a bug; types are owners' and admins', up to 12, archived ones leave the form", async () => {
  const t = await workspace();
  viewerId = t.member;
  const a = idOf(await ask(t.ws, "Crash when exporting", { answers: { need: "Fix" } }));
  const changed = await taskActions.changeTaskTypeAction({ projectId: t.ws, taskIds: [a], toType: "bug" });
  assert.ok(changed.success, JSON.stringify(changed));
  assert.deepEqual([(await row(a)).item_type, (await row(a)).stage], ["bug", "confirmed"]);
  const type = { name: "Copy review", icon: "PenLine", questions: [{ id: "doc", label: "Which page?", kind: "text" as const, required: true }], triagerIds: [], firstReplyMinutes: 120, deliverMinutes: null };
  assert.equal((await requests.saveRequestTypeAction({ projectId: t.ws, type }) as { error?: string }).error, "Only owners and admins edit request types");
  viewerId = t.owner;
  const saved = await requests.saveRequestTypeAction({ projectId: t.ws, type });
  assert.ok(saved.success, JSON.stringify(saved));
  assert.equal((await requests.saveRequestTypeAction({ projectId: t.ws, type: { ...type, name: "copy REVIEW" } }) as { error?: string }).error, "There’s already a type called copy REVIEW");
  assert.equal((await requests.saveRequestTypeAction({ projectId: t.ws, type: { ...type, name: "Other", triagerIds: [t.outsider] } }) as { error?: string }).error, "Triage people must be in the workspace");
  for (let i = 0; i < 9; i++) assert.ok((await requests.saveRequestTypeAction({ projectId: t.ws, type: { ...type, name: `T${i}` } })).success);
  assert.equal((await requests.saveRequestTypeAction({ projectId: t.ws, type: { ...type, name: "Thirteenth" } }) as { error?: string }).error, "Up to 12 request types");
  const copyId = (saved as { id: string }).id;
  assert.ok((await requests.archiveRequestTypeAction({ projectId: t.ws, typeId: copyId, archived: true })).success);
  const read = await requests.readRequestTypesAction(t.ws);
  assert.ok(read.success && !read.active.some((x) => x.id === copyId) && read.types.some((x) => x.id === copyId));
  viewerId = t.member;
  assert.equal((await ask(t.ws, "Old type", { requestTypeId: copyId, answers: { doc: "Home" } }) as { error?: string }).error, "That request type isn’t available");
});
