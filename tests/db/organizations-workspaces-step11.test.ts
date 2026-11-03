import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 11a (report §35.3–35.5; decisions 91, 92): a workspace's life on the Workspaces tab.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.111" }) });

let orgs: typeof import("../../src/app/actions/organizations");
let dash: typeof import("../../src/app/actions/org-dashboard");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, lead, member, viewer, outsider] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${lead!}, 'member'), (${id}, ${member!}, 'member'), (${id}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const child = await sql.begin((tx) => createProject(tx, lead!, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${lead!}, 'owner'), (${child}, ${member!}, 'member'), (${child}, ${outsider!}, 'member')`;
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'Team Falcon' WHERE id = ${child}`;
  created.push(id);
  return { id, child, owner: owner!, admin: admin!, lead: lead!, member: member!, viewer: viewer!, outsider: outsider! };
}

test("35.3, decision 91: whoever archived controls Unarchive; an admin's archive only an admin undoes, and the team is told", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.equal((await orgs.archiveChildAction(o.child)).success, true);
  const [row] = await sql`SELECT org_settings->'archivedBy' AS by FROM workspaces WHERE id = ${o.child}`;
  assert.deepEqual([row!.by.userId, row!.by.admin], [o.admin, true]);
  viewerId = o.lead;
  assert.deepEqual(await orgs.unarchiveChildAction(o.child), { success: false, error: "An organization admin archived it, so only an admin can unarchive it." });
  viewerId = o.admin;
  assert.equal((await orgs.unarchiveChildAction(o.child)).success, true);
  const [back] = await sql`SELECT status, org_settings ? 'archivedBy' AS has FROM workspaces WHERE id = ${o.child}`;
  assert.deepEqual([back!.status, back!.has], ["active", false]);
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.member} AND title LIKE 'Team Falcon is open again%'`;
  assert.ok(notice, "the team hears it");
  await sql`UPDATE workspaces SET status = 'archived', org_settings = org_settings || ${sql.json({ archivedBy: { userId: o.lead, admin: false } })} WHERE id = ${o.child}`;
  viewerId = o.lead;
  assert.equal((await orgs.unarchiveChildAction(o.child)).success, true, "the lead undoes their own");
});

test("35.4, decision 92: admins assign a lead only to a workspace that has none; never a Viewer or an outside person", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.deepEqual(await orgs.assignChildLeadAction(o.child, o.member), { success: false, error: "Team Falcon already has a workspace lead. Only they can hand it over." });
  // The lead's account closed: the organization's owner holds it, flagged.
  await sql`UPDATE workspaces SET owner_id = ${o.owner}, org_settings = org_settings || ${sql.json({ leadHandover: { from: o.lead, at: new Date().toISOString() } })} WHERE id = ${o.child}`;
  await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${o.child} AND user_id = ${o.lead}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.child}, ${o.owner}, 'owner') ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'`;
  const candidates = await orgs.readLeadCandidatesAction(o.child);
  assert.ok(candidates.success, JSON.stringify(candidates));
  const ids = candidates.success ? candidates.people.map((p) => p.id) : [];
  assert.ok(ids.includes(o.member) && !ids.includes(o.viewer) && !ids.includes(o.outsider), JSON.stringify(candidates));
  assert.equal(candidates.success && candidates.people[0]!.onTeam, true, "team members first");
  assert.equal((await orgs.assignChildLeadAction(o.child, o.viewer)).success, false);
  assert.equal((await orgs.assignChildLeadAction(o.child, o.member)).success, true);
  const [w] = await sql`SELECT owner_id, org_settings ? 'leadHandover' AS flagged FROM workspaces WHERE id = ${o.child}`;
  assert.deepEqual([w!.owner_id, w!.flagged], [o.member, false]);
  const [holder] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${o.child} AND user_id = ${o.owner}`;
  assert.equal(holder!.role, "admin", "the holder steps back to admin access");
  viewerId = o.member;
  assert.equal((await orgs.assignChildLeadAction(o.child, o.lead)).success, false, "members can't");
});

test("25.4, 35.5: rows show open seats, a Needs a lead flag and who archived it", async () => {
  const o = await org();
  await sql`INSERT INTO workspace_open_roles (workspace_id, role, count, filled) VALUES (${o.child}, 'Frontend', 3, 1)`;
  viewerId = o.admin;
  await orgs.archiveChildAction(o.child);
  const r = await dash.readOrgWorkspacesAction(o.id);
  assert.ok(r.success);
  const row = r.success ? r.rows.find((x) => x.id === o.child)! : null!;
  assert.deepEqual([row.openSeats, row.needsLead, row.archivedBy?.admin], [2, false, true]);
});
