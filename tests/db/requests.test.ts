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

test("A2.5 W7 and W10: the clock writes its warnings, Accept and working hours move them, the hourly job sends them once", async () => {
  const t = await workspace();
  viewerId = t.owner;
  // Every day, all day, so the clock runs now.
  const saved = await requests.saveWorkingHoursAction({ projectId: t.ws, hours: { days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:59", holidays: [] }, timeZone: "UTC" });
  assert.ok(saved.success, JSON.stringify(saved));
  viewerId = t.member;
  const a = idOf(await ask(t.ws, "Logo please", { answers: { need: "Logo" } }));
  const rows = async () => (await sql`SELECT user_id, note, remind_at FROM task_reminders WHERE task_id = ${a} AND sent_at IS NULL ORDER BY note, user_id`).map((r) => `${r.note}:${r.user_id === t.owner ? "owner" : r.user_id === t.member ? "member" : "?"}`);
  assert.deepEqual(await rows(), ["request_clock:first:80:owner", "request_clock:first:breach:owner"], "General request: first reply within 4 h, to owners and admins");
  const read = await requests.readRequestsAction(t.ws);
  assert.ok(read.success);
  assert.deepEqual([read.requests[0]!.clock?.kind, read.requests[0]!.clock?.state], ["first", "running"]);
  // Working hours change: recalculated, still two rows.
  viewerId = t.owner;
  assert.ok((await requests.saveWorkingHoursAction({ projectId: t.ws, hours: { days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:00", holidays: [] }, timeZone: "UTC" })).success);
  // The recalculation runs after the response (security review): wait for it.
  for (let i = 0; i < 100 && (await rows()).length !== 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await rows()).length, 2);
  // Two recalculations at once leave each warning once (the request row is locked while it's rewritten).
  const clockSrv = await loadAppModule(() => import("../../src/lib/workflows/request-clock-server"));
  await Promise.all([clockSrv.scheduleRequestClock(a), clockSrv.scheduleRequestClock(a), clockSrv.scheduleRequestClock(a)]);
  assert.deepEqual(await rows(), ["request_clock:first:80:owner", "request_clock:first:breach:owner"]);
  // The person's own reminder list never shows the clock's rows.
  const reminders = await loadAppModule(() => import("../../src/lib/domain/task-reminders"));
  assert.deepEqual(await reminders.listTaskReminders(t.owner, a), []);
  // Due now: the hourly job sends the breach notice once.
  await sql`UPDATE task_reminders SET remind_at = now() - interval '1 minute' WHERE task_id = ${a} AND note = 'request_clock:first:breach'`;
  await reminders.fireDueTaskReminders();
  await reminders.fireDueTaskReminders();
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.owner} AND title = 'Breached: Logo please'`)[0]!.n, 1);
  // Accept: the first-reply clock stops; General has no deliver time, so nothing is left to warn about.
  assert.ok((await requests.acceptRequestAction({ projectId: t.ws, taskId: a, assigneeId: t.member })).success);
  assert.deepEqual(await rows(), []);
  // A Design request's deliver clock warns the handler at 80 %, and the handler and owners on breach.
  viewerId = t.member;
  const d = idOf(await ask(t.ws, "Deck", { requestTypeId: (await requests.readRequestTypesAction(t.ws) as { types: Array<{ id: string; name: string }> }).types.find((x) => x.name === "Design request")!.id, answers: { what: "Deck", brief: "Ten slides" } }));
  viewerId = t.owner;
  assert.ok((await requests.acceptRequestAction({ projectId: t.ws, taskId: d, assigneeId: t.member })).success);
  assert.deepEqual((await sql`SELECT note, user_id FROM task_reminders WHERE task_id = ${d} AND sent_at IS NULL ORDER BY note, user_id`).map((r) => `${r.note}:${r.user_id === t.owner ? "owner" : "member"}`).sort(),
    ["request_clock:deliver:80:member", "request_clock:deliver:breach:member", "request_clock:deliver:breach:owner"]);
  // A stale row (the request moved on) is closed without a notice.
  await sql`INSERT INTO task_reminders (task_id, user_id, remind_at, note) VALUES (${a}, ${t.owner}, now() - interval '1 minute', 'request_clock:first:80')`;
  await reminders.fireDueTaskReminders();
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.owner} AND title = 'Breaching soon: Logo please'`)[0]!.n, 0);
});

test("A2.6 W5–W6: waiting pauses and the reply resumes; In review and Delivered tell the asker; No reopens, Yes closes", async () => {
  const t = await workspace();
  viewerId = t.owner;
  assert.ok((await requests.saveWorkingHoursAction({ projectId: t.ws, hours: { days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:59", holidays: [] }, timeZone: "UTC" })).success);
  viewerId = t.member;
  const types = (await requests.readRequestTypesAction(t.ws) as { types: Array<{ id: string; name: string }> }).types;
  const a = idOf(await ask(t.ws, "Banner", { requestTypeId: types.find((x) => x.name === "Design request")!.id, answers: { what: "Banner", brief: "Launch" } }));
  viewerId = t.owner;
  // The first comment by someone other than the asker is the first reply.
  const { createTaskCommentAs } = await loadAppModule(() => import("../../src/lib/domain/task-comments"));
  await createTaskCommentAs({ userId: t.owner, profile: null }, a, t.ws, "Looking at it");
  assert.ok(((await row(a)).type_fields as { firstRepliedAt?: string }).firstRepliedAt, "first reply by comment");
  assert.ok((await requests.acceptRequestAction({ projectId: t.ws, taskId: a, assigneeId: t.owner })).success);
  assert.ok((await requests.setWaitingAction({ projectId: t.ws, taskId: a, onUserId: t.member, question: "Which logo?" })).success);
  const waiting = (await row(a)).type_fields as { waiting?: { onUserId: string } };
  assert.equal(waiting.waiting?.onUserId, t.member);
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${a} AND sent_at IS NULL`)[0]!.n, 0, "paused: no warnings");
  assert.equal((await requests.setWaitingAction({ projectId: t.ws, taskId: a, onUserId: t.member, question: "Again?" }) as { error?: string }).error, "It’s already waiting on someone");
  // My work shows it to the person it waits on, though it isn't theirs.
  const myWork = await loadAppModule(() => import("../../src/app/actions/my-work"));
  viewerId = t.member;
  const mine = await myWork.fetchMyWorkTasksAction(24, "my");
  assert.ok(mine.success);
  assert.equal((mine.tasks.find((x) => x.id === a) as { needsYou?: string } | undefined)?.needsYou, "waiting");
  viewerId = t.owner;
  // The awaited person's reply resumes; the warnings come back.
  await createTaskCommentAs({ userId: t.member, profile: null }, a, t.ws, "The blue one");
  const resumed = (await row(a)).type_fields as { waiting?: unknown; pausedMinutes?: number };
  assert.deepEqual([resumed.waiting, typeof resumed.pausedMinutes], [null, "number"]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${a} AND sent_at IS NULL`)[0]!.n, 2);
  assert.ok((await taskActions.setTaskStageAction({ taskId: a, projectId: t.ws, stage: "in_review" })).success);
  assert.ok((await notes(t.member)).includes("Does this work: Banner"));
  assert.equal((await requests.deliverRequestAction({ projectId: t.ws, taskId: a, link: "http://x.test" }) as { error?: string }).error, "Links start with https://");
  assert.ok((await requests.deliverRequestAction({ projectId: t.ws, taskId: a, link: "https://files.example/banner.png" })).success);
  const delivered = await row(a);
  assert.equal(delivered.stage, "delivered");
  assert.ok((delivered.type_fields as { deliveredAt?: string }).deliveredAt);
  assert.ok((await notes(t.member)).includes("Delivered — did this solve it: Banner"));
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${a} AND sent_at IS NULL`)[0]!.n, 0, "delivered: the clock stopped");
  assert.equal((await requests.answerSolvedAction({ projectId: t.ws, taskId: a, solved: "yes" }) as { error?: string }).error, "Only the person who asked answers this");
  viewerId = t.member;
  const asked = await myWork.fetchMyWorkTasksAction(24, "my");
  assert.ok(asked.success);
  assert.equal((asked.tasks.find((x) => x.id === a) as { needsYou?: string } | undefined)?.needsYou, "solve", "Did this solve it? waits in the asker's My work");
  assert.equal((await requests.answerSolvedAction({ projectId: t.ws, taskId: a, solved: "no" }) as { error?: string }).error, "Say what’s still missing");
  const no = await requests.answerSolvedAction({ projectId: t.ws, taskId: a, solved: "no", note: "Needs the dark version too" });
  assert.ok(no.success && no.reopened, JSON.stringify(no));
  const reopened = await row(a);
  assert.deepEqual([reopened.stage, (reopened.type_fields as { reopenCount: number }).reopenCount, (reopened.type_fields as { deliveredAt: unknown }).deliveredAt], ["in_progress", 1, null]);
  assert.ok((await notes(t.owner)).includes("Answered No: Banner"));
  viewerId = t.owner;
  assert.ok((await requests.deliverRequestAction({ projectId: t.ws, taskId: a })).success);
  viewerId = t.member;
  assert.ok((await requests.answerSolvedAction({ projectId: t.ws, taskId: a, solved: "yes" })).success);
  assert.deepEqual([(await row(a)).stage, ((await row(a)).type_fields as { solved: string }).solved], ["delivered", "yes"]);
});

