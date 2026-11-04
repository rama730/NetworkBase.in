import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, inRollback, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §41.3 deploy 1a (privacy): one test per problem, each failing before its fix.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.14" }) });

let assignments: typeof import("../../src/app/actions/assignments");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let dash: typeof import("../../src/app/actions/org-dashboard");
let cards: typeof import("../../src/lib/messaging/cards");
let access: typeof import("../../src/lib/data/workspace-access");
let files: typeof import("../../src/lib/files/internal-helpers");
let appDb: typeof import("../../src/lib/db");
let schema: typeof import("../../src/lib/db/schema");
let orm: typeof import("drizzle-orm");
let comments: typeof import("../../src/app/actions/task-comment");
let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let subtasks: typeof import("../../src/app/actions/subtask");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null }),
  });
  comments = await loadAppModule(() => import("../../src/app/actions/task-comment"));
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  subtasks = await loadAppModule(() => import("../../src/app/actions/subtask"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  cards = await loadAppModule(() => import("../../src/lib/messaging/cards"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  files = await loadAppModule(() => import("../../src/lib/files/internal-helpers"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
  schema = await loadAppModule(() => import("../../src/lib/db/schema"));
  orm = await import("drizzle-orm");
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

type Org = { org: string; owner: string; admin: string; a: string; b: string };

async function org(): Promise<Org> {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, task_review_required = true WHERE id = ${id}`;
  created.push(id);
  return { org: id, owner: owner!, admin: admin!, a: a!, b: b! };
}

const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

async function draft(o: Org, title: string) {
  viewerId = o.owner;
  const result = await assignments.createAssignmentAction({ projectId: o.org, title, dueDate: future(), publish: false, submissionType: "none", lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.masterId : "";
}

async function boardTitles(o: Org, as: string) {
  viewerId = as;
  const board = await tasks.fetchWorkspaceTasksAction(o.org);
  assert.equal(board.success, true, JSON.stringify(board));
  return board.success ? board.tasks.map((t) => t.title).sort() : [];
}

async function databaseRule(as: string, taskId: string, orgId: string, path: string) {
  // Browsers can't call nb_org_node_access_ok directly, so only the identity is set: auth.uid() is `as`.
  return inRollback(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: as, role: "authenticated" })}, true)`;
    const [row] = await tx`SELECT app_private.nb_task_visible(${taskId}) AS task, app_private.nb_org_node_access_ok(${orgId}, ${taskId}, ${path}) AS node`;
    return row;
  });
}

async function nodeVisibleTo(o: Org, as: string, nodeId: string) {
  const viewerAccess = await access.getWorkspaceAccessById(o.org, as);
  const { workspaceNodes } = schema;
  const rows = await appDb.db.select({ id: workspaceNodes.id }).from(workspaceNodes)
    .where(orm.and(orm.eq(workspaceNodes.id, nodeId), files.orgFileAccessSql(viewerAccess)));
  return rows.length === 1;
}

test("problem 1: a draft assignment and its files stay hidden from members, on the board, Overview, files, chat and the database rule", async () => {
  const o = await org();
  const master = await draft(o, "Exam answers");
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.org}, 'CO1', now() - interval '1 day', now() + interval '6 days', 'active') RETURNING id`;
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id} WHERE id = ${master}`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, task_id) VALUES (${o.org}, 'file', 'key.pdf', '/key.pdf', ${master}) RETURNING id`;

  // Board
  assert.deepEqual(await boardTitles(o, o.a), [], "members don't see a draft on the board");
  assert.deepEqual(await boardTitles(o, o.admin), ["Exam answers"], "admins do");

  // Overview: This sprint and activity
  viewerId = o.a;
  const overview = await dash.readOrgDashboardAction(o.org);
  assert.equal(overview.success, true, JSON.stringify(overview));
  if (overview.success) {
    assert.equal(overview.thisSprint.items.some((i) => i.masterId === master), false, "This sprint leaves the draft out");
    assert.equal(overview.activity.some((e) => e.text.includes("Exam answers")), false, "activity doesn't say it was assigned");
  }

  // Files: the server rule and the database rule
  assert.equal(await nodeVisibleTo(o, o.a, node!.id), false, "a draft's file is hidden from members");
  assert.equal(await nodeVisibleTo(o, o.admin, node!.id), true);
  assert.deepEqual({ ...(await databaseRule(o.a, master, o.org, "/key.pdf")) }, { task: false, node: false });
  assert.deepEqual({ ...(await databaseRule(o.admin, master, o.org, "/key.pdf")) }, { task: true, node: true });

  // Chat: an assignment card and a task card for the draft
  const memberCards = await cards.hydrateCards(o.a, [{ kind: "assignment", ref_id: master }, { kind: "task", ref_id: master }]);
  assert.equal((memberCards[`assignment:${master}`] as { restricted?: boolean }).restricted, true);
  assert.equal((memberCards[`task:${master}`] as { restricted?: boolean }).restricted, true);

  // Once published, members see it everywhere.
  viewerId = o.owner;
  assert.equal((await assignments.publishAssignmentAction(master)).success, true);
  // Decision 15 (step 13): their own copy only; the main one stays readable from it.
  assert.deepEqual(await boardTitles(o, o.a), ["Exam answers"], "their own copy");
  assert.equal(await nodeVisibleTo(o, o.a, node!.id), true);
  assert.deepEqual({ ...(await databaseRule(o.a, master, o.org, "/key.pdf")) }, { task: true, node: true });
  const published = await cards.hydrateCards(o.a, [{ kind: "assignment", ref_id: master }]);
  assert.equal((published[`assignment:${master}`] as { restricted?: boolean }).restricted, undefined);
});

test("problem 1: another student's copy never shows on a chat task card", async () => {
  const o = await org();
  const master = await draft(o, "Lab 1");
  viewerId = o.owner;
  assert.equal((await assignments.publishAssignmentAction(master)).success, true);
  const [copyB] = await sql`SELECT id FROM tasks WHERE assignment_id = ${master} AND assignee_id = ${o.b}`;
  const seenByA = await cards.hydrateCards(o.a, [{ kind: "task", ref_id: copyB!.id }]);
  assert.equal((seenByA[`task:${copyB!.id}`] as { restricted?: boolean }).restricted, true);
  const seenByB = await cards.hydrateCards(o.b, [{ kind: "task", ref_id: copyB!.id }]);
  assert.equal((seenByB[`task:${copyB!.id}`] as { restricted?: boolean }).restricted, undefined);
});

async function published(o: Org, title: string) {
  const master = await draft(o, title);
  viewerId = o.owner;
  assert.equal((await assignments.publishAssignmentAction(master)).success, true);
  const rows = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${master}`;
  const copyOf = (user: string) => rows.find((r) => r.assignee_id === user)!.id as string;
  return { master, copyOf };
}

test("comment privacy (decision 37): another person's copy can't be read, commented on or used to mention, and mentions reach only people who can see the work", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 2");
  viewerId = o.b;
  assert.equal((await comments.createTaskCommentAction(copyOf(o.b), o.org, "Is this right?")).success, true);

  viewerId = o.a;
  const read = await comments.readTaskDiscussionAction(o.org, copyOf(o.b));
  assert.equal(read.success, false, "a classmate can't read the private conversation");
  assert.equal((await comments.createTaskCommentAction(copyOf(o.b), o.org, "Copying yours")).success, false, "or write in it");

  const { buildMentionToken } = await import("../../src/lib/workspaces/mention-tokens");
  const onOwn = await comments.createTaskCommentAction(copyOf(o.a), o.org, `Help ${buildMentionToken({ userId: o.b, displayName: "B" })}`);
  assert.equal(onOwn.success, true, JSON.stringify(onOwn));
  const [mentioned] = await sql`SELECT count(*)::int AS n FROM comment_mentions cm JOIN task_comments c ON c.id = cm.comment_id WHERE c.task_id = ${copyOf(o.a)} AND cm.mentioned_user_id = ${o.b}`;
  assert.equal(mentioned!.n, 0, "a classmate who can't see this copy isn't mentioned");

  viewerId = o.admin;
  assert.equal((await comments.readTaskDiscussionAction(o.org, copyOf(o.b))).success, true, "admins read every copy's conversation");
});

test("decision 53: a suspension's reason goes only to the owner and admins", async () => {
  const o = await org();
  await sql`UPDATE workspaces SET suspended_at = now(), suspend_reason = 'Spam reports from three people' WHERE id = ${o.org}`;
  const { readOrgDetail } = await loadAppModule(() => import("../../src/lib/organizations/detail"));
  const member = await readOrgDetail(o.org, { userId: o.a, isAdmin: false, isInOrg: true });
  const admin = await readOrgDetail(o.org, { userId: o.admin, isAdmin: true, isInOrg: true });
  assert.equal(member?.suspended, true, "members still see that it's suspended");
  assert.equal(member?.suspendReason, null);
  assert.equal(admin?.suspendReason, "Spam reports from three people");
});

test("decision 62: Members shows Last active here, never the account-wide time; opening the org or a workspace in it stamps it, at most hourly", async () => {
  const o = await org();
  await sql`UPDATE profiles SET last_active_at = now() WHERE id = ${o.a}`;
  const members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  const { stampLastActiveHere } = await loadAppModule(() => import("../../src/lib/organizations/members"));
  const rowOf = async (user: string) => {
    viewerId = o.admin;
    const r = await members.readOrgMembersAction(o.org);
    assert.equal(r.success, true, JSON.stringify(r));
    return r.success ? r.rows.find((row) => row.userId === user)! : null;
  };
  const before = await rowOf(o.a);
  assert.equal(before?.lastActiveAt, null, "account-wide activity isn't shown");
  assert.equal(before?.inactive, false, "an empty value doesn't make someone inactive");

  const child = await sql.begin((tx) => createProject(tx, o.a));
  created.push(child);
  await sql`UPDATE workspaces SET parent_id = ${o.org} WHERE id = ${child}`;
  await stampLastActiveHere(child, o.a);
  const [first] = await sql`SELECT last_active_here_at AS at FROM workspace_members WHERE workspace_id = ${o.org} AND user_id = ${o.a}`;
  assert.ok(first!.at, "opening a workspace in the org counts");
  await sql`UPDATE workspace_members SET last_active_here_at = now() - interval '30 minutes' WHERE workspace_id = ${o.org} AND user_id = ${o.a}`;
  await stampLastActiveHere(o.org, o.a);
  const [second] = await sql`SELECT last_active_here_at > now() - interval '1 minute' AS fresh FROM workspace_members WHERE workspace_id = ${o.org} AND user_id = ${o.a}`;
  assert.equal(second!.fresh, false, "no new write within the hour");
  assert.ok((await rowOf(o.a))?.lastActiveAt);
});

test("decision 69: the sitemap and page indexing use Discover's rule (D7), so a new public organization isn't indexed until it qualifies", async () => {
  // Dates sit after the indexing rule's start (2026-11-03) so the test doesn't depend on today.
  const fresh = await org();
  await sql`UPDATE workspaces SET visibility = 'public', status = 'active', slug = ${"fresh-" + fresh.org.slice(0, 8)}, short_description = NULL, description = NULL, created_at = GREATEST(now(), '2026-11-04'::timestamptz) WHERE id = ${fresh.org}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${fresh.org} AND role <> 'owner'`;
  const grown = await org();
  // D7: a description and a second member — no waiting days.
  await sql`UPDATE workspaces SET visibility = 'public', status = 'active', slug = ${"grown-" + grown.org.slice(0, 8)}, short_description = 'Section B', created_at = GREATEST(now(), '2026-11-04'::timestamptz) WHERE id = ${grown.org}`;
  const old = await org();
  await sql`UPDATE workspaces SET visibility = 'public', status = 'active', slug = ${"old-" + old.org.slice(0, 8)}, short_description = NULL, description = NULL, created_at = '2026-01-01' WHERE id = ${old.org}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${old.org} AND role <> 'owner'`;

  const { default: sitemap } = await loadAppModule(() => import("../../src/app/sitemap"));
  const urls = (await sitemap()).map((entry) => entry.url).join(" ");
  assert.equal(urls.includes(`fresh-${fresh.org.slice(0, 8)}`), false, "too new and too small: not listed");
  assert.equal(urls.includes(`grown-${grown.org.slice(0, 8)}`), true, "a description and a second member: listed");
  assert.equal(urls.includes(`old-${old.org.slice(0, 8)}`), true, "public before the rule: stays listed (§41.4)");

  const { orgIndexableSql, orgQualifiesSql } = await loadAppModule(() => import("../../src/lib/discover/listed-sql"));
  const { workspaces } = schema;
  const rows = await appDb.db.select({ id: workspaces.id, index: orgIndexableSql(), discover: orgQualifiesSql() }).from(workspaces)
    .where(orm.inArray(workspaces.id, [fresh.org, grown.org, old.org]));
  const by = Object.fromEntries(rows.map((r) => [r.id, [r.index, r.discover]]));
  assert.deepEqual(by[fresh.org], [false, false], "the share page and Discover agree on a new one");
  assert.deepEqual(by[grown.org], [true, true]);
  assert.deepEqual(by[old.org], [true, false], "an old small one stays indexed but was never on Discover");
});

test("problems 16 and 24: the Sprints tab never shows members an Admins-only file's name, a draft, or another person's copy", async () => {
  const o = await org();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.org}, 'CO1', now() - interval '1 day', now() + interval '6 days', 'active') RETURNING id`;
  const [locked] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, metadata) VALUES (${o.org}, 'folder', 'Staff', '/Staff', '{"access": "admins"}') RETURNING id`;
  const [key] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path) VALUES (${o.org}, 'file', 'Exam answers.pdf', '/Staff/Exam answers.pdf') RETURNING id`;
  const [notes] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path) VALUES (${o.org}, 'file', 'notes.pdf', '/notes.pdf') RETURNING id`;
  assert.ok(locked);
  await sql`INSERT INTO sprint_materials (sprint_id, node_id) VALUES (${sprint!.id}, ${key!.id}), (${sprint!.id}, ${notes!.id})`;

  const hidden = await draft(o, "Final exam");
  const { master, copyOf } = await published(o, "Lab 3");
  for (const id of [hidden, master, copyOf(o.a), copyOf(o.b)]) {
    await sql`INSERT INTO sprint_task_memberships (workspace_id, sprint_id, task_id, added_at) VALUES (${o.org}, ${sprint!.id}, ${id}, now())`;
  }

  const sprintFor = async (as: string) => {
    viewerId = as;
    const r = await sprints.fetchWorkspaceSprintDetailAction({ projectId: o.org, sprintId: sprint!.id });
    assert.equal(r.success, true, JSON.stringify(r));
    if (!r.success) return { materials: [] as string[], tasks: [] as string[] };
    return {
      materials: r.data.materials.map((m) => m.title).sort(),
      tasks: r.data.rows.flatMap((row) => row.kind === "task" ? [`${row.task.title}:${row.task.id === master || row.task.id === hidden ? "main" : row.task.id === copyOf(o.a) ? "a" : "b"}`] : []).sort(),
    };
  };
  const member = await sprintFor(o.a);
  assert.deepEqual(member.materials, ["notes.pdf"], "the answer key's name stays hidden");
  assert.deepEqual(member.tasks, ["Lab 3:a", "Lab 3:main"], "no draft and no classmate's copy");
  const admin = await sprintFor(o.admin);
  assert.deepEqual(admin.materials, ["Exam answers.pdf", "notes.pdf"]);
  assert.deepEqual(admin.tasks, ["Final exam:main", "Lab 3:main"], "admins see drafts; copies live in the roster, not here");
});

test("problem 28: steps change only on your own copy; a main assignment's steps only for admins", async () => {
  const o = await org();
  const { master, copyOf } = await published(o, "Lab 4");
  const [bStep] = await sql`SELECT id FROM task_subtasks WHERE task_id = ${copyOf(o.b)} LIMIT 1`;
  const [mainStep] = await sql`INSERT INTO task_subtasks (task_id, title, position) VALUES (${master}, 'Read the brief', 1) RETURNING id`;
  viewerId = o.a;
  assert.equal((await subtasks.createSubtaskAction(copyOf(o.a), "My own step", o.org)).success, true, "your own copy: fine");
  assert.equal((await subtasks.createSubtaskAction(copyOf(o.b), "Sneaky", o.org)).success, false, "a classmate's copy: refused");
  if (bStep) assert.equal((await subtasks.toggleSubtaskAction(bStep.id, true, o.org)).success, false);
  assert.equal((await subtasks.deleteSubtaskAction(mainStep!.id, o.org)).success, false, "the main assignment: refused");
  viewerId = o.admin;
  assert.equal((await subtasks.updateSubtaskAction(mainStep!.id, "Read the whole brief", o.org)).success, true, "admins edit the main assignment");
});

test("problem 37 (decision 149): nobody reassigns a main assignment or an individual copy; a team copy only by an admin or its lead, within the team", async () => {
  const o = await org();
  const { master, copyOf } = await published(o, "Lab 5");
  viewerId = o.a;
  assert.equal((await taskActions.assignTaskAction(copyOf(o.a), o.b, o.org)).success, false, "can't give your copy away");
  assert.equal((await taskActions.assignTaskAction(master, o.a, o.org)).success, false, "can't take over the main assignment");
  viewerId = o.admin;
  assert.equal((await taskActions.assignTaskAction(copyOf(o.a), o.b, o.org)).success, false, "an individual copy has no reassign");

  const [c] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.org}, ${c!}, 'member')`;
  viewerId = o.owner;
  const team = await assignments.createAssignmentAction({ projectId: o.org, title: "Project", dueDate: future(), publish: true, submissionType: "none", lateRule: "none",
    target: { mode: "teams", teams: [{ name: "Falcon", userIds: [o.a, o.b], leadId: o.a }], individuals: [c!] }, steps: [] } as Parameters<typeof assignments.createAssignmentAction>[0]);
  assert.equal(team.success, true, JSON.stringify(team));
  const [falcon] = await sql`SELECT id FROM tasks WHERE assignment_id = ${team.success ? team.masterId : ""} AND team_name = 'Falcon'`;
  viewerId = o.b;
  assert.equal((await taskActions.assignTaskAction(falcon!.id, o.b, o.org)).success, false, "only the lead or an admin");
  viewerId = o.a;
  assert.equal((await taskActions.assignTaskAction(falcon!.id, c!, o.org)).success, false, "only within the team");
  assert.equal((await taskActions.assignTaskAction(falcon!.id, o.b, o.org)).success, true, "the lead hands it to a teammate");
  viewerId = o.admin;
  assert.equal((await taskActions.assignTaskAction(falcon!.id, o.a, o.org)).success, true, "an admin too");
});

test("decision 95: nobody reviews their own or their group's submission; Approve all skips it", async () => {
  const o = await org();
  viewerId = o.owner;
  const made = await assignments.createAssignmentAction({ projectId: o.org, title: "Peer lab", dueDate: future(), publish: true, submissionType: "none", lateRule: "none", reviewRequired: true,
    target: { mode: "people", userIds: [o.admin, o.a] }, steps: [] } as Parameters<typeof assignments.createAssignmentAction>[0]);
  assert.equal(made.success, true, JSON.stringify(made));
  const master = made.success ? made.masterId : "";
  const rows = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${master}`;
  const adminCopy = rows.find((r) => r.assignee_id === o.admin)!.id as string;
  const aCopy = rows.find((r) => r.assignee_id === o.a)!.id as string;
  for (const [as, copy] of [[o.admin, adminCopy], [o.a, aCopy]] as const) {
    viewerId = as;
    assert.equal((await assignments.submitAssignmentAction(copy, {})).success, true);
  }
  viewerId = o.admin;
  assert.equal((await assignments.reviewAssignmentCopyAction(adminCopy, "approve")).success, false, "an admin can't approve their own copy");
  const [locked] = await sql`SELECT updated_at FROM tasks WHERE id = ${adminCopy}`;
  assert.equal((await taskActions.approveTaskReviewAction(adminCopy, o.org, new Date(locked!.updated_at).toISOString())).success, false, "nor from the task panel");
  const all = await assignments.approveAllSubmittedAction(master);
  assert.equal(all.success && all.approved, 1, "Approve all skips their own");
  const [still] = await sql`SELECT review_status FROM tasks WHERE id = ${adminCopy}`;
  assert.equal(still!.review_status, "pending");
  viewerId = o.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(adminCopy, "approve")).success, true, "someone else can");
});

test("decision 95 guard (41.6): in a normal workspace an admin still approves their own task, as today", async () => {
  const [owner, admin] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const project = await sql.begin((tx) => createProject(tx, owner!));
  created.push(project);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${project}, ${owner!}, 'owner'), (${project}, ${admin!}, 'admin')`;
  await sql`UPDATE workspaces SET task_review_required = true WHERE id = ${project}`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, assignee_id, creator_id) VALUES (${project}, 'Write the docs', ${admin!}, ${owner!}) RETURNING id`;
  viewerId = admin!;
  const submitted = await taskActions.updateTaskStatusAction(task!.id, "done", project);
  assert.equal(submitted.success, true, JSON.stringify(submitted));
  const [row] = await sql`SELECT review_status, updated_at FROM tasks WHERE id = ${task!.id}`;
  assert.equal(row!.review_status, "pending");
  const approved = await taskActions.approveTaskReviewAction(task!.id, project, new Date(row!.updated_at).toISOString());
  assert.equal(approved.success, true, JSON.stringify(approved));
});

test("decision 41: inside an organization, a workspace that isn't Public uses only private repositories", async () => {
  const o = await org();
  await sql`UPDATE workspaces SET title = 'CSE 3B' WHERE id = ${o.org}`;
  const team = await sql.begin((tx) => createProject(tx, o.a, { visibility: "org" }));
  const open = await sql.begin((tx) => createProject(tx, o.a, { visibility: "public" }));
  const personal = await sql.begin((tx) => createProject(tx, o.a, { visibility: "private" }));
  created.push(team, open, personal);
  await sql`UPDATE workspaces SET parent_id = ${o.org} WHERE id IN (${team}, ${open})`;
  const { orgRepositoryBlock } = await loadAppModule(() => import("../../src/lib/organizations/children"));
  assert.equal(await orgRepositoryBlock(team, false, "connect"), "This workspace is only visible inside CSE 3B, so its repository must be private.");
  assert.equal(await orgRepositoryBlock(team, false, "push"), "This repository is now public. Make it private or disconnect it.");
  assert.equal(await orgRepositoryBlock(team, true, "connect"), null);
  assert.equal(await orgRepositoryBlock(open, false, "connect"), null, "a Public workspace may use a public repository");
  assert.equal(await orgRepositoryBlock(personal, false, "connect"), null, "outside an organization nothing changes");
});
