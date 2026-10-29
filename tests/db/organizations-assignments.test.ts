import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.13" }) });

let assignments: typeof import("../../src/app/actions/assignments");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let taskActions: typeof import("../../src/app/actions/task");
let orgs: typeof import("../../src/app/actions/organizations");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

type Org = { org: string; owner: string; a: string; b: string; c: string; guest: string; code: string };

async function org(): Promise<Org> {
  const [owner, a, b, c, guest] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  const code = generateJoinCode();
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member'), (${id}, ${c!}, 'member'), (${id}, ${guest!}, 'viewer')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${code}, task_review_required = true WHERE id = ${id}`;
  created.push(id);
  return { org: id, owner: owner!, a: a!, b: b!, c: c!, guest: guest!, code };
}

const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const copies = (masterId: string) => sql`SELECT id, project_id, assignee_id, status, review_status, team_name, excused_at, due_date FROM tasks WHERE assignment_id = ${masterId} AND deleted_at IS NULL ORDER BY team_name NULLS LAST`;

async function publish(o: Org, extra: Record<string, unknown> = {}) {
  viewerId = o.owner;
  const result = await assignments.createAssignmentAction({
    projectId: o.org, title: "Lab 1", description: "Write a lexer.", dueDate: future(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "always", target: { mode: "everyone" }, steps: ["Read the brief", "Write tests"],
    ...extra,
  } as Parameters<typeof assignments.createAssignmentAction>[0]);
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.masterId : "";
}

test("publishing to everyone makes one copy per member with the steps; a draft makes none", async () => {
  const o = await org();
  viewerId = o.owner;
  const draft = await assignments.createAssignmentAction({ projectId: o.org, title: "Draft", dueDate: future(), publish: false, submissionType: "none", lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.equal(draft.success && (await copies(draft.masterId)).length, 0);
  const master = await publish(o);
  const rows = await copies(master);
  assert.deepEqual(rows.map((r) => r.assignee_id).sort(), [o.a, o.b, o.c].sort(), "members only: not the owner or the guest");
  const [steps] = await sql`SELECT count(*)::int AS n FROM task_subtasks WHERE task_id = ${rows[0]!.id}`;
  assert.equal(steps!.n, 2);
  assert.equal((await assignments.publishAssignmentAction(draft.success ? draft.masterId : "")).success, true);
  assert.equal(draft.success && (await copies(draft.masterId)).length, 3);
});

test("members see the master and their own copy only; admins see every copy in the roster, not on the board", async () => {
  const o = await org();
  const master = await publish(o);
  await sql`INSERT INTO tasks (project_id, title, assignee_id) VALUES (${o.org}, 'Prepare CO2 quiz', ${o.owner})`;
  viewerId = o.a;
  const mine = await tasks.fetchWorkspaceTasksAction(o.org);
  assert.equal(mine.success, true, JSON.stringify(mine));
  const titles = mine.success ? mine.tasks.map((t) => `${t.title}:${t.assigneeId === o.a ? "me" : t.assigneeId ?? "master"}`) : [];
  assert.deepEqual(titles.sort(), ["Lab 1:master", "Lab 1:me"].sort());
  viewerId = o.owner;
  const board = await tasks.fetchWorkspaceTasksAction(o.org);
  assert.deepEqual(board.success ? board.tasks.map((t) => t.title).sort() : [], ["Lab 1", "Prepare CO2 quiz"].sort(), "copies stay off the admin board");
  const roster = await assignments.readAssignmentRosterAction(master);
  assert.equal(roster.success && roster.rows.length, 3);
  viewerId = o.guest;
  const guestRoster = await assignments.readAssignmentRosterAction(master);
  assert.equal(guestRoster.success, true);
  assert.equal(guestRoster.success && guestRoster.rows.length, 0, "guests get counts without names");
  assert.equal(guestRoster.success && guestRoster.counts.total, 3);
});

test("submit, return with a reason, resubmit, approve; drag to Done needs Submit for link work", async () => {
  const o = await org();
  const master = await publish(o);
  const [copy] = (await copies(master)).filter((r) => r.assignee_id === o.a);
  viewerId = o.a;
  const dragged = await taskActions.updateTaskStatusAction(copy!.id, "done", o.org);
  assert.equal(dragged.success, false, "link submissions go through Submit");
  assert.equal((await assignments.submitAssignmentAction(copy!.id, { link: "https://github.com/a/lexer" })).success, true);
  assert.equal((await copies(master)).find((r) => r.id === copy!.id)!.review_status, "pending");
  viewerId = o.b;
  assert.equal((await assignments.reviewAssignmentCopyAction(copy!.id, "approve")).success, false, "members don't review");
  viewerId = o.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(copy!.id, "return")).success, false, "a return needs a reason");
  assert.equal((await assignments.reviewAssignmentCopyAction(copy!.id, "return", "Add the test cases")).success, true);
  let row = (await copies(master)).find((r) => r.id === copy!.id)!;
  assert.deepEqual([row.status, row.review_status], ["in_progress", "rejected"]);
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(copy!.id, { link: "https://github.com/a/lexer/pull/2" })).success, true);
  viewerId = o.owner;
  assert.equal((await assignments.approveAllSubmittedAction(master)).success, true);
  row = (await copies(master)).find((r) => r.id === copy!.id)!;
  assert.deepEqual([row.status, row.review_status], ["done", "none"]);
});

test("teams: one copy per team, any teammate submits, other teams never see it", async () => {
  const o = await org();
  const master = await publish(o, { target: { mode: "teams", teams: [{ name: "Team A", userIds: [o.a, o.b], leadId: o.a }], individuals: [o.c] } });
  const rows = await copies(master);
  assert.deepEqual(rows.map((r) => r.team_name), ["Team A", null]);
  const team = rows.find((r) => r.team_name === "Team A")!;
  assert.equal(team.assignee_id, o.a, "the team lead holds the copy");
  viewerId = o.b;
  assert.equal((await assignments.submitAssignmentAction(team.id, { link: "https://example.com/deck" })).success, true, "a teammate submits for the team");
  viewerId = o.c;
  const cView = await tasks.fetchWorkspaceTasksAction(o.org);
  assert.equal(cView.success && cView.tasks.some((t) => t.id === team.id), false);
});

test("group assignment: a copy in each child project for its lead; the org reviews it", async () => {
  const o = await org();
  const child = await sql.begin((tx) => createProject(tx, o.a));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${o.a}, 'owner')`;
  await sql`UPDATE projects SET parent_id = ${o.org} WHERE id = ${child}`;
  created.push(child);
  const master = await publish(o, { title: "Mini-project proposal", target: { mode: "each_child" }, submissionType: "text" });
  const [groupCopy] = await copies(master);
  assert.deepEqual([groupCopy!.project_id, groupCopy!.assignee_id], [child, o.a]);
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(groupCopy!.id, { text: "We build a quiz app." })).success, true);
  assert.equal((await taskActions.approveTaskReviewAction(groupCopy!.id, child)).success, false, "the lead doesn't approve the org's review");
  viewerId = o.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(groupCopy!.id, "approve")).success, true);
  assert.equal((await orgs.detachChildAction(child)).success, true);
  const [after] = await sql`SELECT assignment_id FROM tasks WHERE id = ${groupCopy!.id}`;
  assert.equal(after!.assignment_id, null, "a detached project keeps it as a normal task");
});

test("admin actions: extend, excuse, edit the master, close, and delete only before anyone submits", async () => {
  const o = await org();
  const master = await publish(o, { submissionType: "none" });
  const rows = await copies(master);
  const aCopy = rows.find((r) => r.assignee_id === o.a)!;
  const bCopy = rows.find((r) => r.assignee_id === o.b)!;
  viewerId = o.owner;
  const later = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  assert.equal((await assignments.extendCopyAction(aCopy.id, later)).success, true);
  assert.equal((await assignments.excuseCopyAction(bCopy.id, "Medical leave")).success, true);
  const moved = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
  assert.equal((await assignments.updateAssignmentAction(master, { title: "Lab 1 (lexer)", dueDate: moved })).success, true);
  const after = await copies(master);
  assert.equal(after.find((r) => r.id === aCopy.id)!.due_date.toISOString(), later, "an extension survives a master due-date move");
  assert.equal(after.find((r) => r.assignee_id === o.c)!.due_date.toISOString(), moved);
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${master} AND title = 'Lab 1 (lexer)'`)[0]!.n, 3);
  viewerId = o.c;
  const cCopy = after.find((r) => r.assignee_id === o.c)!;
  assert.equal((await assignments.submitAssignmentAction(cCopy.id, {})).success, true);
  viewerId = o.owner;
  assert.equal((await assignments.deleteAssignmentAction(master)).success, false, "someone submitted: close instead");
  assert.equal((await assignments.closeAssignmentAction(master)).success, true);
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(aCopy.id, {})).success, false, "closed");
});

test("late joiners get copies of open assignments; leaving drops unfinished copies", async () => {
  const o = await org();
  const master = await publish(o, { submissionType: "none" });
  const newcomer = await sql.begin((tx) => createUser(tx));
  viewerId = newcomer;
  assert.equal((await orgs.joinOrganizationAction(o.code)).success, true);
  assert.equal((await copies(master)).some((r) => r.assignee_id === newcomer), true);
  viewerId = o.b;
  assert.equal((await orgs.leaveOrgAction(o.org)).success, true);
  assert.equal((await copies(master)).some((r) => r.assignee_id === o.b), false);
});
