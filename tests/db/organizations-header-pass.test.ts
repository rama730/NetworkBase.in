import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P17 §18 pass: org tab badges. Admins count submissions to review and join requests; members count work due
// within 2 days; everyone gets a dot for unseen announcements.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.71" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });

let assignments: typeof import("../../src/app/actions/assignments");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("tab badges by person", async () => {
  const [owner, member, applicant] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  created.push(id);
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', title = 'CSE-3A', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const settings = sql.json({ version: 1, submissionType: "none", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null });
  const [m] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, assignment_settings) VALUES (${id}, 'Lab 1', 'assignment', ${owner!}, ${settings}) RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, due_date) VALUES
    (${id}, 'Lab 1', 'task', ${m!.id}, ${member!}, ${owner!}, now() + interval '1 day'),
    (${id}, 'Lab 1', 'task', ${m!.id}, ${owner!}, ${owner!}, now() + interval '1 day')`;
  await sql`UPDATE tasks SET review_status = 'pending', review_submitted_at = now() WHERE assignment_id = ${m!.id} AND assignee_id = ${owner!}`;
  await sql`INSERT INTO role_applications (project_id, applicant_id, status, message) VALUES (${id}, ${applicant!}, 'pending', 'hi')`;
  await sql`INSERT INTO project_updates (project_id, author_id, content, update_type, visibility) VALUES (${id}, ${owner!}, 'Midterm moved', 'announcement', 'members')`;

  viewerId = owner!;
  assert.deepEqual(await assignments.readOrgTabBadgesAction(id), { tasks: 1, updates: false, members: 1 }, "own announcement is not new");
  viewerId = member!;
  assert.deepEqual(await assignments.readOrgTabBadgesAction(id), { tasks: 1, updates: true, members: 0 });
  await sql`UPDATE project_members SET last_seen_updates_at = now() WHERE project_id = ${id} AND user_id = ${member!}`;
  assert.equal((await assignments.readOrgTabBadgesAction(id))?.updates, false);
  viewerId = applicant!;
  assert.equal(await assignments.readOrgTabBadgesAction(id), null, "not in the org");
});
