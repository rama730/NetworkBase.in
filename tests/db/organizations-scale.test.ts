import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ORG_LIMITS } from "../../src/lib/organizations/config";
import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P16 performance (plan §P16): an org at its 2,000-member limit. Each read is timed against a loose ceiling so a
// lost index or an N+1 shows up here; the timings print for the phase report.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.20" }) });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let assignments: typeof import("../../src/app/actions/assignments");
let dash: typeof import("../../src/app/actions/org-dashboard");
let members: typeof import("../../src/app/actions/org-members");
let orgWorkspace: typeof import("../../src/app/actions/org-workspace");
let workspace: typeof import("../../src/app/actions/workspace");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  orgWorkspace = await loadAppModule(() => import("../../src/app/actions/org-workspace"));
  workspace = await loadAppModule(() => import("../../src/app/actions/workspace"));
});

let orgId = "";
let userIds: string[] = [];
after(async () => {
  if (orgId) await sql`DELETE FROM projects WHERE id = ${orgId} OR parent_id = ${orgId}`;
  if (userIds.length) await sql`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  await sql.end();
  await closeAppDb();
});

const timings: Record<string, number> = {};
async function timed<T>(label: string, ceilingMs: number, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await work();
  timings[label] = Math.round(performance.now() - start);
  assert.ok(timings[label]! < ceilingMs, `${label} took ${timings[label]} ms (ceiling ${ceilingMs} ms)`);
  return result;
}

test("an org at 2,000 members: fan-out, roster, dashboard, projects and My work stay fast", { timeout: 300_000 }, async () => {
  const size = ORG_LIMITS.membersPerOrg;
  const owner = await sql.begin((tx) => createUser(tx));
  orgId = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, slug = ${`scale-${orgId.slice(0, 8)}`} WHERE id = ${orgId}`;
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${orgId}, ${owner}, 'owner')`;

  // 1,999 members, bulk-inserted; 20 child projects of ~100 each, one unit per project.
  const rows = await sql<{ id: string }[]>`
    WITH ids AS (SELECT gen_random_uuid() AS id, g FROM generate_series(1, ${size - 1}) g),
    users AS (INSERT INTO auth.users (id, email) SELECT id, 'scale-' || id || '@test.local' FROM ids RETURNING id)
    INSERT INTO public.profiles (id, email, username, full_name, visibility)
    SELECT id, 'scale-' || id || '@test.local', 's' || replace(left(id::text, 13), '-', ''), 'Student ' || left(id::text, 6), 'public' FROM users RETURNING id`;
  userIds = [owner, ...rows.map((r) => r.id)];
  const memberIds = userIds.slice(1);
  await sql`INSERT INTO project_members (project_id, user_id, role) SELECT ${orgId}, unnest(${memberIds}::uuid[]), 'member'`;
  for (let i = 0; i < 20; i++) {
    const child = await sql.begin((tx) => createProject(tx, owner, { visibility: "private" }));
    await sql`UPDATE projects SET parent_id = ${orgId}, title = ${`Team ${i}`} WHERE id = ${child}`;
    const [unit] = await sql`INSERT INTO project_open_roles (project_id, role, count) VALUES (${child}, 'Unit', 100) RETURNING id`;
    await sql`INSERT INTO project_members (project_id, user_id, role, unit_id) VALUES (${child}, ${owner}, 'owner', NULL)`;
    await sql`INSERT INTO project_members (project_id, user_id, role, unit_id) SELECT ${child}, unnest(${memberIds.slice(i * 100, i * 100 + 100)}::uuid[]), 'member', ${unit!.id}`;
  }

  viewerId = owner;
  const created = await timed("publish to everyone (copy fan-out)", 30_000, () => assignments.createAssignmentAction({
    projectId: orgId, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "none", lateRule: "none", target: { mode: "everyone" }, steps: [],
  }));
  assert.ok(created.success, created.success ? "" : created.error);
  assert.equal(created.success && created.copies, size - 1);
  await sql`UPDATE tasks SET review_status = 'pending', review_submitted_at = now() WHERE assignment_id = ${created.success ? created.masterId : ""} AND assignee_id = ANY(${memberIds.slice(0, 300)}::uuid[])`;

  const roster = await timed("Members tab roster", 3_000, () => members.readOrgMembersAction(orgId));
  assert.ok(roster.success && roster.rows.length === size);
  assert.ok((await timed("Dashboard", 3_000, () => dash.readOrgDashboardAction(orgId))).success);
  assert.ok((await timed("About (org page)", 2_000, () => dash.readOrgAboutAction(orgId))).success);
  const projectsTab = await timed("Projects tab", 2_000, () => dash.readOrgProjectsAction(orgId));
  assert.ok(projectsTab.success && projectsTab.rows.length === 20);
  assert.ok((await timed("Assignments list (admin)", 2_000, () => assignments.listAssignmentsAction(orgId))).success);
  const assignmentRoster = await timed("Assignment roster", 3_000, () => assignments.readAssignmentRosterAction(created.success ? created.masterId : ""));
  assert.ok(assignmentRoster.success && assignmentRoster.rows.length === size - 1);
  assert.equal((await timed("To review", 2_000, () => orgWorkspace.fetchToReviewAction()))?.length ? true : false, true);

  viewerId = memberIds[42]!;
  assert.ok((await timed("Sidebar (member)", 1_500, () => orgWorkspace.readSidebarWorkspacesAction()))?.orgs.some((o) => o.id === orgId));
  const mine = await timed("My work (member)", 1_500, () => workspace.fetchWorkspaceTasksAction(50, "my"));
  assert.ok(mine.success && mine.tasks.some((t) => t.org));
  viewerId = "";
  console.log("org-scale timings (ms):", JSON.stringify(timings));
});
