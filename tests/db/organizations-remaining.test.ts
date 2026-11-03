import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// The plan's remaining items (2026-11-03 audit): gaps in finished steps, and the after-pilot and later features.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.142" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let members: typeof import("../../src/app/actions/org-members");
let orgUpdates: typeof import("../../src/app/actions/org-updates");
let units: typeof import("../../src/app/actions/child-units");
let orgFiles: typeof import("../../src/app/actions/org-files");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: { fullName: "Tester", username: "tester", avatarUrl: null } }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  orgUpdates = await loadAppModule(() => import("../../src/app/actions/org-updates"));
  units = await loadAppModule(() => import("../../src/app/actions/child-units"));
  orgFiles = await loadAppModule(() => import("../../src/app/actions/org-files"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org() {
  const tag = Math.random().toString(36).slice(2, 8);
  const [owner, admin, a, b, viewer] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member'), (${id}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', status = 'active', join_code = ${generateJoinCode()}, title = ${`Class ${tag}`}, slug = ${`class-${tag}`} WHERE id = ${id}`;
  created.push(id);
  return { id, tag, owner: owner!, admin: admin!, a: a!, b: b!, viewer: viewer! };
}

test("7.11: an email invite carries the sender's message into the invite and its email", async () => {
  const o = await org();
  viewerId = o.owner;
  const email = `new-${o.tag}@example.test`;
  const sent = await members.inviteByEmailAction(o.id, { emails: email, role: "member", message: "Welcome. We start on Monday." });
  assert.equal(sent.success, true, JSON.stringify(sent));
  const [invite] = await sql`SELECT message FROM org_email_invites WHERE org_id = ${o.id} AND email = ${email}`;
  assert.equal(invite!.message, "Welcome. We start on Monday.");
  const [queued] = await sql`SELECT data FROM email_outbox WHERE to_email = ${email} ORDER BY created_at DESC LIMIT 1`;
  assert.equal(queued?.data?.note, "Welcome. We start on Monday.");
  const long = await members.inviteByEmailAction(o.id, { emails: `x-${email}`, role: "member", message: "x".repeat(501) });
  assert.equal(long.success, false);
  const preview = await members.previewOrgInviteEmailAction(o.id, { role: "member", message: "<b>Hi</b>" });
  assert.ok(preview.success && preview.html.includes("&lt;b&gt;Hi&lt;/b&gt;"), "the message is escaped in the email");
});

test("37.3: widening a post's audience tells only the people it adds, once, in the tray", async () => {
  const o = await org();
  const [post] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, visibility, audience)
    VALUES (${o.id}, ${o.owner}, 'Lab rooms change on Friday', 'announcement', 'members', ${sql.json({ roles: ["admin"] })}) RETURNING id`;
  viewerId = o.owner;
  const widened = await orgUpdates.setOrgUpdateAudienceAction(o.id, post!.id, { audience: null, visibility: "members" }, true);
  assert.equal(widened.success, true, JSON.stringify(widened));
  const told = (await sql`SELECT user_id FROM user_notifications WHERE dedupe_key LIKE ${`%announcement:${post!.id}:widened:%`}`).map((r) => r.user_id).sort();
  assert.deepEqual(told, [o.a, o.b, o.viewer].sort(), "members and viewers were added; the admin already had it");
});

test("step 11: the organization's admins see a workspace's open team applications; members don't", async () => {
  const o = await org();
  const lead = await sql.begin((tx) => createUser(tx));
  const child = await sql.begin((tx) => createProject(tx, lead, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon' WHERE id = ${child}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${lead}, 'owner'), (${o.id}, ${lead}, 'member')`;
  const [role] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count) VALUES (${child}, 'Frontend', 'Frontend', 2) RETURNING id`;
  await sql`INSERT INTO role_applications (workspace_id, role_id, applicant_id, creator_id, message, status) VALUES (${child}, ${role!.id}, ${o.a}, ${lead}, 'I build UIs', 'pending')`;
  viewerId = o.admin;
  const seen = await units.readTeamApplicationsAction(child);
  assert.ok(seen.success);
  assert.deepEqual(seen.success ? seen.applications.map((a) => [a.team, a.message]) : [], [["Frontend", "I build UIs"]]);
  viewerId = o.b;
  assert.equal((await units.readTeamApplicationsAction(child)).success, false);
});

test("step 9: a By type row lists that type's largest files, for admins only", async () => {
  const o = await org();
  await sql`INSERT INTO workspace_nodes (workspace_id, path, type, name, size, mime_type) VALUES
    (${o.id}, '/a.png', 'file', 'a.png', 500, 'image/png'), (${o.id}, '/b.png', 'file', 'b.png', 900, 'image/png'), (${o.id}, '/c.pdf', 'file', 'c.pdf', 999, 'application/pdf')`;
  viewerId = o.admin;
  const images = await orgFiles.readOrgStorageFilesAction(o.id, "images");
  assert.deepEqual(images.success ? images.files.map((f) => f.name) : null, ["b.png", "a.png"]);
  viewerId = o.a;
  assert.equal((await orgFiles.readOrgStorageFilesAction(o.id, "images")).success, false);
});
