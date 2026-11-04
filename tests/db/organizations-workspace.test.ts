import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P15 app-wide pieces (report §29.2, §29.3, §30.1): My work's copy rules, To review, the sidebar tree and search privacy.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let workspace: typeof import("../../src/app/actions/my-work");
let orgWorkspace: typeof import("../../src/app/actions/org-workspace");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  workspace = await loadAppModule(() => import("../../src/app/actions/my-work"));
  orgWorkspace = await loadAppModule(() => import("../../src/app/actions/org-workspace"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("My work: masters never show, admins don't see copies, teammates see team copies; To review reaches the admin", async () => {
  const [owner, a, b, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  created.push(org);
  const tag = org.slice(0, 6);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${a!}, 'member'), (${org}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = ${`Secret Org ${tag}`}, visibility = 'private', status = 'active' WHERE id = ${org}`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date, assignment_settings) VALUES (${org}, ${`Lab ${tag}`}, 'assignment', ${owner!}, now() + interval '1 day',
    ${sql.json({ version: 1, submissionType: "none", lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null })}) RETURNING id`;
  const [team] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, team_name, due_date, review_status, review_submitted_at) VALUES (${org}, ${`Lab ${tag}`}, 'task', ${master!.id}, ${a!}, ${owner!}, 'Team A', now() + interval '1 day', 'pending', now()) RETURNING id`;
  await sql`INSERT INTO task_team_members (task_id, user_id, is_lead) VALUES (${team!.id}, ${a!}, true), (${team!.id}, ${b!}, false)`;

  viewerId = b!;
  const mine = await workspace.fetchMyWorkTasksAction(50, "my");
  assert.ok(mine.success);
  const row = mine.success ? mine.tasks.find((t) => t.id === team!.id) : undefined;
  assert.ok(row, "a teammate sees the team copy in My tasks");
  assert.equal(row!.org?.teamName, "Team A");
  assert.ok(row!.org?.context.startsWith("Secret Org"));
  assert.ok(mine.success && !mine.tasks.some((t) => t.id === master!.id), "never the master");

  viewerId = owner!;
  const all = await workspace.fetchMyWorkTasksAction(50, "all");
  assert.ok(all.success && !all.tasks.some((t) => t.id === team!.id || t.id === master!.id), "admins see neither copies nor masters here");
  const review = await orgWorkspace.fetchToReviewAction();
  assert.ok(review?.some((r) => r.id === team!.id && r.who === "Team A"), "the submission waits in To review");

  // Search: a private org is invisible by name to people outside it; members find it, with their assignment.
  viewerId = outsider!;
  assert.equal((await orgWorkspace.searchOrgPreviewsAction(`Secret Org ${tag}`)).length, 0);
  viewerId = b!;
  const found = await orgWorkspace.searchOrgPreviewsAction(`Secret Org ${tag}`);
  assert.equal(found.find((r) => r.kind === "org")?.chip, "Member");
  const assignment = (await orgWorkspace.searchOrgPreviewsAction(`Lab ${tag}`)).find((r) => r.kind === "assignment");
  assert.equal(assignment?.chip, "In review", "a member sees their own copy's state");
  await sql`UPDATE tasks SET review_status = 'none', status = 'in_progress' WHERE id = ${team!.id}`;
  const working = (await orgWorkspace.searchOrgPreviewsAction(`Lab ${tag}`)).find((r) => r.kind === "assignment");
  assert.equal(working?.chip, "In progress", "student check 10: a started copy doesn't read To do");

  // Sidebar: the org shows with its tree for members.
  const sidebar = await orgWorkspace.readSidebarWorkspacesAction();
  assert.ok(sidebar?.orgs.some((o) => o.id === org));
  viewerId = "";
});

test("student check 3: a member's My work holds only their own organization work, never a teacher's tasks", async () => {
  const [owner, a] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${a!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, status = 'active' WHERE id = ${org}`;
  const [rubric] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignee_id) VALUES (${org}, 'Prepare the Lab 1 grading rubric', 'task', ${owner!}, ${owner!}) RETURNING id`;
  const [open] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id) VALUES (${org}, 'Unassigned org task', 'task', ${owner!}) RETURNING id`;
  const [given] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignee_id) VALUES (${org}, 'Given to the student', 'task', ${owner!}, ${a!}) RETURNING id`;

  viewerId = a!;
  const all = await workspace.fetchMyWorkTasksAction(50, "all");
  const ids = all.success ? all.tasks.map((t) => t.id) : [];
  assert.ok(!ids.includes(rubric!.id) && !ids.includes(open!.id), "the teacher's own and unassigned tasks stay off a student's list");
  assert.ok(ids.includes(given!.id), "a task given to the student shows");
  viewerId = owner!;
  const teacher = await workspace.fetchMyWorkTasksAction(50, "all");
  assert.ok(teacher.success && teacher.tasks.some((t) => t.id === open!.id), "admins still see the organization's open work");
  viewerId = "";
});
