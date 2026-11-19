import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A0.5 (report 38.3 F2 W3–W8, W12, calls 1, 3, 5): a live block's rows are tasks tied to the document and
// key; editors add, reorder and detach; the text never changes; the public sees a count only when Tasks is private.

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
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function meeting(editPolicy = "leaders") {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { publicTabVisibility: { readme: true, tasks: false } }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', 'Weekly.md', '/Weekly.md', ${owner!}) RETURNING id`;
  await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${ws}, ${node!.id}, 'weekly', 'Weekly.md', ${sql.json({ version: 1, editPolicy, visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })})`;
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");
const rows = async (ws: string, key = "k7f3") => {
  const r = await docs.readDocRowsAction(ws, "weekly", key);
  assert.ok(r.success, JSON.stringify(r));
  return r;
};

test("W3: an editor adds rows: real tasks in To do and the Backlog, tied to the document and key, in order; the text is untouched", async () => {
  const t = await meeting();
  viewerId = t.owner;
  const first = await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Book the venue", assigneeId: t.member, dueDate: "2026-11-26T00:00:00.000Z" });
  assert.equal(first.success, true, JSON.stringify(first));
  await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Send the agenda" });
  await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "other", title: "Elsewhere" });
  const list = await rows(t.ws);
  assert.deepEqual(list.rows.map((r) => r.title), ["Book the venue", "Send the agenda"]);
  const [task] = await sql`SELECT status, sprint_id, assignee_id, task_number FROM tasks WHERE id = ${first.success ? first.id : ""}`;
  assert.deepEqual([task!.status, task!.sprint_id, task!.assignee_id], ["todo", null, t.member]);
  assert.ok(task!.task_number > 0, "an NB number like any task");
  const [versions] = await sql`SELECT count(*)::int AS n FROM workspace_document_versions WHERE doc_id IN (SELECT id FROM workspace_documents WHERE workspace_id = ${t.ws})`;
  assert.equal(versions!.n, 0, "adding never writes the document (B8)");
  assert.match(errorOf(await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "  " })), /Add a title/);
});

test("W5 + B9: in a leaders-only document a member can't add but ticks their own row; viewers do neither", async () => {
  const t = await meeting("leaders");
  viewerId = t.owner;
  await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Mine", assigneeId: t.member });
  await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Owner's", assigneeId: t.owner });
  viewerId = t.member;
  assert.match(errorOf(await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "No" })), /Only people who can edit/);
  const asMember = await rows(t.ws);
  assert.deepEqual([asMember.canAdd, asMember.rows.map((r) => r.canTick)], [false, [true, false]]);
  viewerId = t.viewer;
  const asViewer = await rows(t.ws);
  assert.deepEqual([asViewer.canAdd, asViewer.rows.map((r) => r.canTick)], [false, [false, false]]);
});

test("W8: Move up/down reorders, Remove from this list keeps the task without its From line; only editors", async () => {
  const t = await meeting("members");
  viewerId = t.owner;
  for (const title of ["A", "B", "C"]) await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title });
  const ids = (await rows(t.ws)).rows.map((r) => r.id);
  assert.equal((await docs.moveDocRowAction(t.ws, { docSlug: "weekly", taskId: ids[2], direction: "up" })).success, true);
  assert.deepEqual((await rows(t.ws)).rows.map((r) => r.title), ["A", "C", "B"]);
  viewerId = t.viewer;
  assert.match(errorOf(await docs.detachDocRowAction(t.ws, { docSlug: "weekly", taskId: ids[0] })), /Only people who can edit/);
  viewerId = t.member;
  assert.equal((await docs.detachDocRowAction(t.ws, { docSlug: "weekly", taskId: ids[0] })).success, true);
  assert.deepEqual((await rows(t.ws)).rows.map((r) => r.title), ["C", "B"]);
  const [kept] = await sql`SELECT source_doc_id, deleted_at FROM tasks WHERE id = ${ids[0]!}`;
  assert.deepEqual([kept!.source_doc_id, kept!.deleted_at], [null, null]);
});

test("W12: a public reader with Tasks private sees the count only; with Tasks public, rows without who", async () => {
  const t = await meeting();
  viewerId = t.owner;
  await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Book the venue", assigneeId: t.member });
  viewerId = t.outsider;
  const hiddenView = await rows(t.ws);
  assert.deepEqual([hiddenView.rows.length, hiddenView.hidden, hiddenView.canSeeTasks], [0, 1, false]);
  await sql`UPDATE workspaces SET public_tab_visibility = public_tab_visibility || '{"tasks": true}'::jsonb WHERE id = ${t.ws}`;
  const open = await rows(t.ws);
  assert.deepEqual([open.rows.length, open.rows[0]!.assignee, open.rows[0]!.canTick], [1, null, false]);
});

test("Organizations: a member sees only their own rows (others' copies are counted, never shown); detaching others' is refused", async () => {
  const t = await meeting("members");
  await sql`UPDATE workspaces SET kind = 'organization' WHERE id = ${t.ws}`;
  viewerId = t.owner;
  await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Mine", assigneeId: t.member });
  await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Owner's", assigneeId: t.owner });
  assert.deepEqual((await rows(t.ws)).rows.map((r) => r.title), ["Mine", "Owner's"], "admins see every row");
  viewerId = t.member;
  const asMember = await rows(t.ws);
  assert.deepEqual([asMember.rows.map((r) => r.title), asMember.hidden], [["Mine"], 1]);
  const [others] = await sql`SELECT id FROM tasks WHERE title = 'Owner''s' AND workspace_id = ${t.ws}`;
  assert.match(errorOf(await docs.detachDocRowAction(t.ws, { docSlug: "weekly", taskId: others!.id })), /isn’t in this list/);
});

test("A0.9 W5: More details adds a full task to the list (description, priority, sprint for a leader) with its From", async () => {
  const t = await meeting("members");
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status) VALUES (${t.ws}, ${t.owner}, 'Sprint 1', now() - interval '1 day', now() + interval '7 days', 'active') RETURNING id`;
  viewerId = t.owner;
  assert.equal((await rows(t.ws)).canPlanSprints, true);
  const r = await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Book the venue", description: "Two rooms", priority: "high", status: "in_progress", sprintId: sprint!.id, subtasks: [{ title: "Call them" }] });
  assert.equal(r.success, true, JSON.stringify(r));
  const [task] = await sql`SELECT status, description, priority, sprint_id, source_block, (SELECT count(*)::int FROM task_subtasks s WHERE s.task_id = tasks.id) AS subs FROM tasks WHERE id = ${r.success ? r.id : ""}`;
  assert.deepEqual([task!.status, task!.description, task!.priority, task!.sprint_id, task!.source_block, task!.subs], ["in_progress", "Two rooms", "high", sprint!.id, "k7f3", 1]);
  viewerId = t.member;
  assert.equal((await rows(t.ws)).canPlanSprints, false);
  const m = await docs.addDocRowAction(t.ws, { docSlug: "weekly", blockKey: "k7f3", title: "Print badges", sprintId: sprint!.id });
  const [mine] = await sql`SELECT sprint_id FROM tasks WHERE id = ${m.success ? m.id : ""}`;
  assert.equal(mine!.sprint_id, null, "a member's sprint goes to the Backlog (38.4 call 3)");
});
