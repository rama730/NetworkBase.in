import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Board view dropdown §3, §5: one count per view, by the list's own rules, for every role; the orange numbers equal
// the Tasks tab badge.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.171" }) });
stubNextAfter();
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let assignments: typeof import("../../src/app/actions/assignments");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let needsYou: typeof import("../../src/lib/organizations/needs-you");
let access: typeof import("../../src/lib/data/workspace-access");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  needsYou = await loadAppModule(() => import("../../src/lib/organizations/needs-you"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
});

const created: string[] = [];
after(async () => {
  for (const id of created) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const SCOPES = ["all", "sprint", "backlog", "review", "assignments", "mine"] as const;

test("board counts: each view's open number equals the open cards it lists, for an admin, members and a viewer; orange equals the tab badge", async () => {
  const [owner, a, b, v] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${a!}, 'member'), (${org}, ${b!}, 'member'), (${org}, ${v!}, 'viewer') ON CONFLICT DO NOTHING`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  // A second one, already past due and not handed in: missing, which needs the member too.
  const late = await assignments.createAssignmentAction({ projectId: org, title: "Lab 0", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "always", target: { mode: "everyone" }, steps: [] });
  assert.ok(late.success);
  await sql`UPDATE tasks SET due_date = now() - interval '2 days' WHERE assignment_id = ${late.success ? late.masterId : ""} OR id = ${late.success ? late.masterId : ""}`;
  // a handed in (waiting for review); b hasn't (due tomorrow: needs b).
  await sql`UPDATE tasks SET status = 'in_progress', review_status = 'pending', review_submitted_at = now() WHERE assignment_id = ${masterId} AND assignee_id = ${a!}`;
  const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${org} AND status = 'todo' LIMIT 1`;
  const [done] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${org} AND status = 'done' LIMIT 1`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status) VALUES (${org}, ${owner!}, 'CO1', now() - interval '1 day', now() + interval '13 days', 'active') RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, workflow_column_id, assignee_id, due_date, sprint_id) VALUES
    (${org}, ${owner!}, 'Rubric', 'todo', ${col!.id}, ${owner!}, now() + interval '1 day', ${sprint!.id}),
    (${org}, ${owner!}, 'Plan CO2', 'todo', ${col!.id}, null, null, null),
    (${org}, ${owner!}, 'Old', 'done', ${done!.id}, ${owner!}, null, null)`;
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id} WHERE id = ${masterId}`;
  // A plain task waiting for review, and a group hand-in from a team workspace: both are in the admin's review queue.
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, workflow_column_id, assignee_id, review_status, review_submitted_at) VALUES (${org}, ${owner!}, 'Slides', 'in_progress', ${col!.id}, ${a!}, 'pending', now())`;
  const team = await sql.begin((tx) => createProject(tx, owner!));
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${team}`;
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, assignment_id, team_name, review_status, review_submitted_at) VALUES (${team}, ${owner!}, 'Lab 1', 'in_progress', ${masterId}, 'Team Falcon', 'pending', now())`;

  const expectFor = async (who: string, skip: string[] = []) => {
    viewerId = who;
    const counts = await tasks.readBoardCountsAction(org);
    assert.ok(counts.success, JSON.stringify(counts));
    for (const scope of SCOPES.filter((x) => !skip.includes(x))) {
      const list = await tasks.fetchWorkspaceTasksAction(org, 200, undefined, scope);
      assert.ok(list.success);
      const open = list.success ? list.tasks.filter((t) => t.status !== "done" && (scope !== "sprint" || t.sprintId === sprint!.id)) : [];
      assert.equal(counts.success ? counts.counts[scope].open : -1, open.length, `${scope} for ${who === owner ? "owner" : who === a ? "a" : who === b ? "b" : "viewer"}: ${JSON.stringify(open.map((t) => t.title))}`);
    }
    return counts.success ? counts.counts : null;
  };
  viewerId = owner!;
  const queue = await assignments.readReviewQueueAction(org);
  assert.ok(queue.success);
  const adminCounts = await expectFor(owner!, ["review"]);
  assert.equal(adminCounts!.review.open, queue.success ? queue.total : -1, "an admin's In review is the review queue, group hand-ins included");
  assert.equal(adminCounts!.review.needsYou, 3, "a's hand-in, the team's, and the plain task");
  // The Overview's Needs you rows add up to the same number.
  const viewerAccess = await access.getWorkspaceAccessById(org, owner!);
  const rows = await needsYou.readNeedsYou({ userId: owner!, access: viewerAccess, isAdmin: true, isInside: true, isGuest: false, org: { id: org, title: "Org", slug: null, status: "active" } }, new Date());
  assert.equal(rows.filter((r) => r.kind === "review").reduce((n, r) => n + (r.count ?? 0), 0), adminCounts!.review.needsYou, JSON.stringify(rows));
  assert.equal(adminCounts!.mine.needsYou, 1, "the rubric is due tomorrow");
  viewerId = owner!;
  assert.equal((await assignments.readOrgTabBadgesAction(org))!.tasks, adminCounts!.review.needsYou, "the Tasks tab badge is the admin's orange review number");
  const bCounts = await expectFor(b!);
  assert.equal(bCounts!.assignments.needsYou, 2, "b's copy is due within 2 days, and Lab 0 is missing");
  viewerId = b!;
  assert.equal((await assignments.readOrgTabBadgesAction(org))!.tasks, bCounts!.assignments.needsYou, "a member's badge is their orange assignments number");
  const aCounts = await expectFor(a!);
  assert.equal(aCounts!.assignments.needsYou, 1, "a handed in Lab 1; Lab 0 is missing");
  assert.equal(aCounts!.review.needsYou, 0, "members don't review");
  await expectFor(v!);
  viewerId = "";
});

test("board counts: a stranger gets nothing", async () => {
  const [owner, stranger] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(ws);
  viewerId = stranger!;
  const r = await tasks.readBoardCountsAction(ws);
  assert.equal(r.success, false);
  viewerId = "";
});

test("review queue §4b: every hand-in can be reached past the first 200; each row carries its story, unread messages and people; an ordinary task brings its files", async () => {
  const [owner, kid] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${kid!}, 'member') ON CONFLICT DO NOTHING`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 9", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  // 250 more hand-ins of the same assignment (as if a big class), each a copy waiting for review.
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, assignment_id, assignee_id, review_status, review_submitted_at)
    SELECT ${org}, ${owner!}, 'Lab 9', 'in_progress', ${masterId}, ${kid!}, 'pending', now() - (g || ' minutes')::interval FROM generate_series(1, 250) g`;
  // The member's own copy: handed in twice, returned once in between, with a new message.
  const [own] = await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${kid!} AND review_status <> 'pending' LIMIT 1`;
  await sql`UPDATE tasks SET review_status = 'pending', review_submitted_at = now(), submission = ${sql.json({ version: 2, link: "https://example.com/v2" })} WHERE id = ${own!.id}`;
  await sql`INSERT INTO assignment_submissions (copy_id, workspace_id, version, submitted_by, submitted_at, link, files) VALUES (${own!.id}, ${org}, 1, ${kid!}, now() - interval '2 days', 'https://example.com/v1', '[]'), (${own!.id}, ${org}, 2, ${kid!}, now(), 'https://example.com/v2', '[]')`;
  await sql`INSERT INTO task_activity_events (task_id, workspace_id, actor_id, event_type, payload, created_at) VALUES (${own!.id}, ${org}, ${owner!}, 'changes_requested', ${sql.json({ reason: "fix the README", fixBy: "2026-11-13T10:00:00.000Z" })}, now() - interval '1 day')`;
  await sql`INSERT INTO task_comments (task_id, user_id, content) VALUES (${own!.id}, ${kid!}, 'Done, see v2')`;
  // An ordinary task waiting for review, with a file.
  const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${org} AND status = 'todo' LIMIT 1`;
  const [plain] = await sql`INSERT INTO tasks (workspace_id, creator_id, title, description, status, workflow_column_id, assignee_id, review_status, review_submitted_at) VALUES (${org}, ${owner!}, 'Slides', 'Make 5 slides', 'in_progress', ${col!.id}, ${kid!}, 'pending', now()) RETURNING id`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, size) VALUES (${org}, 'file', 'slides.pdf', 1234) RETURNING id`;
  await sql`INSERT INTO task_node_links (task_id, node_id) VALUES (${plain!.id}, ${node!.id})`;

  const first = await assignments.readReviewQueueAction(org);
  assert.ok(first.success, JSON.stringify(first));
  if (!first.success) return;
  assert.equal(first.total, 252, "250 + the member's copy + the plain task");
  assert.ok(first.nextCursor, "there's a next page");
  const second = await assignments.readReviewQueueAction(org, first.nextCursor);
  assert.ok(second.success);
  if (!second.success) return;
  const ids = new Set([...first.rows, ...second.rows].map((r) => r.copyId));
  assert.equal(ids.size, 252, "every hand-in reached across the two pages, none twice");
  assert.equal(second.nextCursor, null);
  const mine = [...first.rows, ...second.rows].find((r) => r.copyId === own!.id)!;
  assert.deepEqual(mine.events.map((e) => e.text), ["Version 1 handed in by " + mine.people[0]!.name, "Returned by " + (await sql`SELECT coalesce(full_name, username) AS n FROM profiles WHERE id = ${owner!}`)[0]!.n + ": fix the README · fix by Nov 13", "Version 2 handed in by " + mine.people[0]!.name]);
  assert.equal(mine.lastAsk, "fix the README");
  assert.equal(mine.newMessages, 1);
  assert.equal(mine.people.length, 1);
  const task = first.rows.find((r) => r.copyId === plain!.id)!;
  assert.equal(task.description, "Make 5 slides");
  assert.deepEqual(task.files.map((f) => f.name), ["slides.pdf"]);
  // Opening it marks the message read.
  await sql`INSERT INTO task_read_receipts (task_id, user_id, last_read_at) VALUES (${own!.id}, ${owner!}, now() + interval '1 second')`;
  const again = await assignments.readReviewQueueAction(org);
  const later = again.success ? [...again.rows].find((r) => r.copyId === own!.id) ?? (await assignments.readReviewQueueAction(org, again.nextCursor)) : null;
  const row = later && "copyId" in later ? later : later && "rows" in later && later.success ? later.rows.find((r) => r.copyId === own!.id) : null;
  assert.equal(row?.newMessages, 0);
  viewerId = "";
});

test("files §1–§2: Submissions rows say who handed in and whether review is needed; a hand-in's files and earlier versions load for admins only; sprint materials carry their CO", async () => {
  const orgFiles = await loadAppModule(() => import("../../src/app/actions/org-files"));
  const [owner, kid] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${kid!}, 'member') ON CONFLICT DO NOTHING`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 5", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "file", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${kid!}`;
  const [v1] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, size, created_by, task_id, path) VALUES (${org}, 'file', 'draft.pdf', 900, ${kid!}, ${copy!.id}, '/draft.pdf') RETURNING id`;
  const [v2] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, size, created_by, task_id, path) VALUES (${org}, 'file', 'final.pdf', 1200, ${kid!}, ${copy!.id}, '/final.pdf') RETURNING id`;
  await sql`INSERT INTO assignment_submissions (copy_id, workspace_id, version, submitted_by, submitted_at, files) VALUES
    (${copy!.id}, ${org}, 1, ${kid!}, now() - interval '1 day', ${sql.json([{ nodeId: v1!.id, name: "draft.pdf" }])}),
    (${copy!.id}, ${org}, 2, ${kid!}, now(), ${sql.json([{ nodeId: v2!.id, name: "final.pdf" }])})`;
  await sql`UPDATE tasks SET review_status = 'pending', review_submitted_at = now(), submission = ${sql.json({ version: 2, by: kid! })} WHERE id = ${copy!.id}`;
  await sql`UPDATE workspace_nodes SET task_id = NULL WHERE id = ${v1!.id}`;

  const subs = await orgFiles.readOrgSubmissionsAction(org);
  assert.ok(subs.success);
  const group = subs.success ? subs.assignments.find((g) => g.id === masterId)! : null;
  assert.equal(group!.reviewRequired, true);
  assert.equal(group!.closed, false);
  const row = group!.rows.find((r) => r.copyId === copy!.id)!;
  assert.equal(row.status, "In review");
  assert.ok(row.by, "who handed it in");
  assert.equal(row.projectId, org);

  const files = await orgFiles.readHandInFilesAction(copy!.id);
  assert.ok(files.success, JSON.stringify(files));
  if (!files.success) return;
  assert.deepEqual(files.current.map((f) => [f.name, f.size]), [["final.pdf", 1200]]);
  assert.deepEqual(files.versions.map((v) => [v.version, v.files.map((f) => f.name)]), [[1, ["draft.pdf"]]]);
  viewerId = kid!;
  assert.equal((await orgFiles.readHandInFilesAction(copy!.id)).success, false, "a member can't read another hand-in through the admin's Submissions");

  // Sprint materials: a sprint inside a CO says which CO.
  viewerId = owner!;
  const [co] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status, sprint_number) VALUES (${org}, ${owner!}, 'CO1', now() - interval '1 day', now() + interval '30 days', 'active', 1) RETURNING id`;
  const [wk] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status, parent_sprint_id, sprint_number) VALUES (${org}, ${owner!}, 'Week 1', now() - interval '1 day', now() + interval '6 days', 'active', ${co!.id}, 2) RETURNING id`;
  const [doc] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, size, created_by, path) VALUES (${org}, 'file', 'slides.pdf', 500, ${owner!}, '/slides.pdf') RETURNING id`;
  await sql`INSERT INTO sprint_materials (sprint_id, node_id, added_by) VALUES (${wk!.id}, ${doc!.id}, ${owner!})`;
  const mats = await orgFiles.readOrgSprintMaterialsAction(org);
  assert.ok(mats.success, JSON.stringify(mats));
  const week = mats.success ? mats.groups.find((g) => g.sprintId === wk!.id)! : null;
  assert.equal(week!.parentId, co!.id);
  assert.equal(week!.parentName, "CO1");
  assert.equal(week!.files[0]!.size, 500);
  viewerId = "";
});
