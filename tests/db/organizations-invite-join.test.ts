import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 6 (report §7.11, §26.2, §26.3, §29.4): the join page's states and the one invite panel.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.19" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let orgs: typeof import("../../src/app/actions/organizations");
let members: typeof import("../../src/app/actions/org-members");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(extra: { max?: string; joinMode?: "instant" | "approval" } = {}) {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner));
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${code}, join_code_enabled = true, title = 'CSE 3B',
    visibility = 'private', max_collaborators = ${extra.max ?? null}, org_settings = ${sql.json({ joinMode: extra.joinMode ?? "instant" })} WHERE id = ${id}`;
  created.push(id);
  return { id, owner, code };
}

const preview = async (code: string, as: string) => {
  viewerId = as;
  const result = await orgs.getJoinPreviewAction(code);
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.preview : null!;
};

test("26.2, gap 14, decision 63: the join page knows each state and says what admins can see", async () => {
  const o = await org({ max: "2" });
  const [stranger, blocked, declined] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const open = await preview(o.code, stranger!);
  assert.equal(open.state, "open");
  assert.equal(open.adminsLine, "CSE 3B’s Teachers and TAs can see your work here and when you were last active here. They can’t see your DMs or anything outside CSE 3B.");
  await sql`INSERT INTO org_join_blocks (org_id, user_id, blocked_by) VALUES (${o.id}, ${blocked!}, ${o.owner})`;
  assert.deepEqual([(await preview(o.code, blocked!)).state, (await preview(o.code, blocked!)).stateMessage], ["blocked", "You can’t join this organization."]);
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${o.id}, ${declined!}, ${o.owner}, 'rejected')`;
  assert.equal((await preview(o.code, declined!)).stateMessage, "Your last request was declined. You can ask again tomorrow.");
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${stranger!}, 'member')`;
  assert.equal((await preview(o.code, stranger!)).state, "member");
  const late = await sql.begin((tx) => createUser(tx));
  assert.deepEqual([(await preview(o.code, late)).state, (await preview(o.code, late)).stateMessage], ["full", "This organization is full."], "max 2, and 2 are in");
  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${o.id}`;
  assert.equal((await preview(o.code, late)).stateMessage, "This organization isn’t accepting new members.");
});

test("26.2: someone waiting can cancel from the join page", async () => {
  const o = await org({ joinMode: "approval" });
  const asker = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${o.id}, ${asker}, ${o.owner}, 'pending')`;
  assert.equal((await preview(o.code, asker)).state, "waiting");
  viewerId = asker;
  assert.equal((await orgs.cancelJoinRequestAction(o.id)).success, true);
  assert.equal((await preview(o.code, asker)).state, "open");
});

test("7.11, 26.3: one invite read; expired invites stay listed; the email preview is the real template", async () => {
  const o = await org({ joinMode: "approval" });
  await sql`INSERT INTO org_email_invites (org_id, email, role, invited_by, expires_at) VALUES (${o.id}, 'late@example.com', 'member', ${o.owner}, now() - interval '1 day')`;
  viewerId = o.owner;
  const panel = await members.readOrgInvitePanelAction(o.id);
  assert.ok(panel.success);
  assert.deepEqual(panel.success && [panel.data.joinCode, panel.data.joinMode, panel.data.roleNames.member, panel.data.invitesLeft], [o.code, "approval", "Student", 999]);
  const roster = await members.readOrgMembersAction(o.id);
  assert.deepEqual(roster.success && roster.invites.map((i) => [i.email, i.expired]), [["late@example.com", true]]);
  const email = await members.previewOrgInviteEmailAction(o.id, { role: "member", title: "Section B" });
  assert.ok(email.success && email.subject.includes("CSE 3B") && email.html.includes("Section B"), JSON.stringify(email.success && email.subject));
});
