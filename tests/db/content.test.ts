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

test("A2.8 W5–W7: draft, Ready for edit, Changes needed, the editor's approval (no second review), Publish now, Mark published", async () => {
  const t = await workspace();
  await sql`UPDATE workspaces SET time_zone = 'UTC', task_review_required = true WHERE id = ${t.ws}`;
  viewerId = t.owner;
  const starter = await content.starterContentSettingsAction(["blog", "social"]);
  assert.ok(starter.success && (await content.saveContentSettingsAction({ projectId: t.ws, settings: starter.settings })).success);
  viewerId = t.member;
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const made = await tasksServer.createTaskAction({ projectId: t.ws, title: "Pricing guide", status: "todo", priority: "medium", itemType: "content", stage: "drafting",
    dueDate: soon, assigneeId: t.member, typeFields: { channels: ["blog", "linkedin"], contentType: "article" } } as never);
  assert.ok(made.success, JSON.stringify(made));
  const id = (made as { task: { id: string } }).task.id;
  const reminders = async () => (await sql`SELECT user_id, note FROM task_reminders WHERE task_id = ${id} AND sent_at IS NULL`).map((r) => `${r.note}:${r.user_id === t.member ? "writer" : "?"}`);
  assert.deepEqual(await reminders(), ["content_publish:now:writer"], "Publish now waits for the writer at the publish time");
  // Write draft links a document of this workspace.
  const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, filename, slug) VALUES (${t.ws}, 'pricing-guide.md', 'pricing-guide') RETURNING id`;
  assert.ok((await content.linkContentDraftAction({ projectId: t.ws, taskId: id, docId: doc!.id, slug: "pricing-guide" })).success);
  assert.equal(((await row(id)).type_fields as { draftSlug: string }).draftSlug, "pricing-guide");
  assert.equal((await content.readyForEditAction({ projectId: t.ws, taskId: id, editorId: t.member }) as { error?: string }).error, "Pick an editor other than the writer");
  assert.ok((await content.readyForEditAction({ projectId: t.ws, taskId: id, editorId: t.owner, note: "Check the numbers" })).success);
  assert.equal((await row(id)).stage, "editing");
  assert.ok((await sql`SELECT title FROM user_notifications WHERE user_id = ${t.owner} AND title = 'Ready for edit: Pricing guide'`).length === 1);
  assert.equal((await content.approveContentAction({ projectId: t.ws, taskId: id }) as { error?: string }).error, "Only its editor approves this piece");
  viewerId = t.owner;
  assert.equal((await content.changesNeededAction({ projectId: t.ws, taskId: id, note: " " }) as { error?: string }).error, "Say what needs changing");
  assert.ok((await content.changesNeededAction({ projectId: t.ws, taskId: id, note: "Add the 2026 prices" })).success);
  assert.equal((await row(id)).stage, "drafting");
  assert.ok((await sql`SELECT 1 FROM task_comments WHERE task_id = ${id} AND content = 'Changes needed: Add the 2026 prices'`).length === 1);
  viewerId = t.member;
  assert.ok((await content.readyForEditAction({ projectId: t.ws, taskId: id, editorId: t.owner })).success);
  // Security review: a member editor's approval still waits for the workspace's review; a viewer can't approve.
  const [other] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${t.ws}, ${other!}, 'member')`;
  await sql`UPDATE tasks SET type_fields = type_fields || ${sql.json({ editorId: other! })} WHERE id = ${id}`;
  viewerId = other!;
  // Security review: the editor's move is locked as the editor, so their own role rules apply.
  await sql`UPDATE workspaces SET role_abilities = ${sql.json({ member: { "tasks.edit": false } })} WHERE id = ${t.ws}`;
  assert.match((await content.approveContentAction({ projectId: t.ws, taskId: id }) as { error?: string }).error ?? "", /role can’t edit tasks/);
  assert.match((await content.changesNeededAction({ projectId: t.ws, taskId: id, note: "Shorter" }) as { error?: string }).error ?? "", /role can’t edit tasks/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_comments WHERE task_id = ${id} AND content = 'Changes needed: Shorter'`)[0]!.n, 0, "no stray note");
  await sql`UPDATE workspaces SET role_abilities = NULL, workflows_enabled = false WHERE id = ${t.ws}`;
  assert.equal((await content.changesNeededAction({ projectId: t.ws, taskId: id, note: "Shorter" }) as { error?: string }).error, "Workflows aren’t on in this workspace.");
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${t.ws}`;
  const memberYes = await content.approveContentAction({ projectId: t.ws, taskId: id });
  assert.ok(memberYes.success, JSON.stringify(memberYes));
  const held = (await sql`SELECT stage, status, review_status FROM tasks WHERE id = ${id}`)[0]!;
  assert.deepEqual([held.review_status, held.stage], ["pending", "editing"], "waits for the owners' review");
  await sql`UPDATE tasks SET status = 'in_progress', review_status = 'none', stage = 'editing' WHERE id = ${id}`;
  await sql`UPDATE workspace_members SET role = 'viewer' WHERE workspace_id = ${t.ws} AND user_id = ${other!}`;
  assert.equal((await content.approveContentAction({ projectId: t.ws, taskId: id }) as { error?: string }).error, "Only its editor approves this piece", "a viewer can't");
  viewerId = t.owner;
  assert.ok((await content.approveContentAction({ projectId: t.ws, taskId: id })).success);
  const approved = (await sql`SELECT stage, status, review_status FROM tasks WHERE id = ${id}`)[0]!;
  assert.deepEqual([approved.stage, approved.status, approved.review_status], ["scheduled", "done", "none"], "the editor's yes is the review");
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${t.member} AND title = 'Approved: Pricing guide'`).length === 1);
  assert.deepEqual(await reminders(), ["content_publish:now:writer"]);
  // Publish now fires once, to the writer.
  await sql`UPDATE task_reminders SET remind_at = now() - interval '1 minute' WHERE task_id = ${id} AND note LIKE 'content_publish:%'`;
  const fire = await loadAppModule(() => import("../../src/lib/domain/task-reminders"));
  await fire.fireDueTaskReminders(); await fire.fireDueTaskReminders();
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'Publish now: Pricing guide'`)[0]!.n, 1);
  // Mark published: one channel, then the other (an Update of this workspace for the Blog channel).
  viewerId = t.member;
  assert.equal((await content.markPublishedAction({ projectId: t.ws, taskId: id, links: { linkedin: { link: "javascript:alert(1)" } } }) as { error?: string }).error, "Links start with http:// or https://");
  const one = await content.markPublishedAction({ projectId: t.ws, taskId: id, links: { linkedin: { link: "https://www.linkedin.com/posts/pricing" } } });
  assert.deepEqual([one.success && one.state, (await row(id)).stage], ["partial", "scheduled"]);
  const [update] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${t.ws}, ${t.member}, 'Our pricing guide is out') RETURNING id`;
  const all = await content.markPublishedAction({ projectId: t.ws, taskId: id, links: { blog: { updateId: update!.id } } });
  assert.deepEqual([all.success && all.state, (await row(id)).stage], ["all", "published"]);
  assert.deepEqual(await reminders(), ["content_publish:results:writer"], "Publish now is gone once published; Add results waits a week (A2.9)");
});

test("A2.9 W8: results reminder a week after publishing, Results saved per channel, live Update numbers, switch off", async () => {
  const t = await workspace();
  await sql`UPDATE workspaces SET time_zone = 'UTC' WHERE id = ${t.ws}`;
  viewerId = t.owner;
  const starter = await content.starterContentSettingsAction(["blog", "social"]);
  assert.ok(starter.success && (await content.saveContentSettingsAction({ projectId: t.ws, settings: starter.settings })).success);
  viewerId = t.member;
  const soon = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const made = await tasksServer.createTaskAction({ projectId: t.ws, title: "Launch post", status: "todo", priority: "medium", itemType: "content", stage: "drafting",
    dueDate: soon, assigneeId: t.member, typeFields: { channels: ["blog", "linkedin"], contentType: "article" } } as never);
  const id = (made as { task: { id: string } }).task.id;
  await sql`UPDATE tasks SET stage = 'scheduled', status = 'done' WHERE id = ${id}`;
  const pending = async () => (await sql`SELECT note, remind_at FROM task_reminders WHERE task_id = ${id} AND sent_at IS NULL ORDER BY note`).map((r) => r.note);
  assert.equal((await content.saveResultsAction({ projectId: t.ws, taskId: id, results: { linkedin: { views: 3 } } }) as { error?: string }).error, "Add results once that channel is published");
  const [update] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, like_count, comment_count) VALUES (${t.ws}, ${t.member}, 'Launch!', 4, 2) RETURNING id`;
  assert.ok((await content.markPublishedAction({ projectId: t.ws, taskId: id, links: { blog: { updateId: update!.id }, linkedin: { link: "https://www.linkedin.com/posts/launch" } } })).success);
  assert.equal((await row(id)).stage, "published");
  assert.deepEqual(await pending(), ["content_publish:results"], "Add results waits a week; Publish now is gone");
  const [r] = await sql`SELECT extract(epoch FROM remind_at - now())::int AS s FROM task_reminders WHERE task_id = ${id} AND sent_at IS NULL`;
  assert.ok(Math.abs(r!.s - 7 * 86_400) < 120, "seven days after publishing");
  // Not the person's own reminder: their list stays empty.
  const own = await loadAppModule(() => import("../../src/lib/domain/task-reminders"));
  assert.equal((await own.listTaskReminders(t.member, id)).length, 0);
  // Call 3: the Update's likes and comments are live; typed results can't overwrite them.
  const read = await content.readContentAction(t.ws);
  assert.ok(read.success);
  assert.deepEqual(read.items.find((i) => i.id === id)!.live, { blog: { likes: 4, comments: 2 } });
  assert.equal((await content.saveResultsAction({ projectId: t.ws, taskId: id, results: { blog: { views: 3 } } }) as { error?: string }).error, "An Update’s likes and comments fill its results");
  assert.equal((await content.saveResultsAction({ projectId: t.ws, taskId: id, results: { linkedin: { views: -1 } } }) as { error?: string }).error, "Results are whole numbers, 0 or more");
  viewerId = t.viewer;
  assert.equal((await content.saveResultsAction({ projectId: t.ws, taskId: id, results: { linkedin: { views: 3 } } }) as { error?: string }).error, "Viewers can’t add results");
  // The reminder fires once, at Summary level, to the writer.
  await sql`UPDATE task_reminders SET remind_at = now() - interval '1 minute' WHERE task_id = ${id} AND sent_at IS NULL`;
  await own.fireDueTaskReminders(); await own.fireDueTaskReminders();
  const sent = await sql`SELECT importance FROM user_notifications WHERE user_id = ${t.member} AND title = 'Add results: Launch post'`;
  assert.deepEqual(sent.map((x) => x.importance), ["more"]);
  // Typed results close it; switching the reminder off keeps it closed.
  viewerId = t.member;
  assert.ok((await content.saveResultsAction({ projectId: t.ws, taskId: id, results: { linkedin: { views: 900, likes: 31, comments: 4, clicks: 12 } } })).success);
  assert.deepEqual(((await row(id)).type_fields as { results: unknown }).results, { linkedin: { views: 900, likes: 31, comments: 4, clicks: 12 } });
  await sql`UPDATE tasks SET type_fields = type_fields - 'results' WHERE id = ${id}`;
  assert.ok((await content.saveResultsAction({ projectId: t.ws, taskId: id, reminder: true })).success);
  assert.deepEqual(await pending(), [], "Add results comes once per piece");
  assert.ok((await content.saveResultsAction({ projectId: t.ws, taskId: id, reminder: false })).success);
  assert.deepEqual(await pending(), []);
});

test("W9.1 (A2.8 live check): changing the Publish date in the panel moves the publish time and its reminder, keeping the time of day", async () => {
  const t = await workspace();
  await sql`UPDATE workspaces SET time_zone = 'Asia/Kolkata' WHERE id = ${t.ws}`;
  viewerId = t.owner;
  const starter = await content.starterContentSettingsAction(["social"]);
  assert.ok(starter.success && (await content.saveContentSettingsAction({ projectId: t.ws, settings: starter.settings })).success);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const made = await tasksServer.createTaskAction({ projectId: t.ws, title: "Teaser", status: "todo", priority: "medium", itemType: "content", stage: "drafting",
    dueDate: day(3), assigneeId: t.owner, typeFields: { channels: ["x"], publishTime: "18:15" } } as never);
  const id = (made as { task: { id: string } }).task.id;
  const moved = await taskActions.updateTaskFieldAction(id, "dueDate", `${day(10)}T00:00:00.000Z`, t.ws);
  assert.ok(moved.success, JSON.stringify(moved));
  const after = (await row(id)).type_fields as { publishAt: string };
  assert.equal(after.publishAt, new Date(`${day(10)}T12:45:00.000Z`).toISOString(), "18:15 in Kolkata on the new day");
  assert.deepEqual((await sql`SELECT remind_at FROM task_reminders WHERE task_id = ${id} AND sent_at IS NULL`).map((r) => new Date(r.remind_at).toISOString()), [after.publishAt]);
  assert.ok((await taskActions.updateTaskFieldAction(id, "dueDate", null, t.ws)).success);
  assert.equal(((await row(id)).type_fields as { publishAt: unknown }).publishAt, null, "no date, no publish time");
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${id} AND sent_at IS NULL`)[0]!.n, 0);
});

test("W9.2: Cancel keeps a piece in history, off the board, with no Publish now", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const starter = await content.starterContentSettingsAction(["social"]);
  assert.ok(starter.success && (await content.saveContentSettingsAction({ projectId: t.ws, settings: starter.settings })).success);
  const made = await tasksServer.createTaskAction({ projectId: t.ws, title: "Dropped", status: "todo", priority: "medium", itemType: "content", stage: "drafting",
    dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), assigneeId: t.owner, typeFields: { channels: ["x"] } } as never);
  const id = (made as { task: { id: string } }).task.id;
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${id} AND sent_at IS NULL`)[0]!.n, 1);
  const moved = await taskActions.setTaskStageAction({ projectId: t.ws, taskId: id, stage: "cancelled" });
  assert.ok(moved.success, JSON.stringify(moved));
  const r = await row(id);
  assert.deepEqual([r.stage, r.status, r.on_board], ["cancelled", "done", false]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${id} AND sent_at IS NULL`)[0]!.n, 0);
});
