import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Org workflow audit 2026-11-09, phase 1 (docs/superpowers/plans/2026-11-09-org-workflow-audit.md).

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.31" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/lib/security/step-up", { resolveSecurityStepUp: async () => ({ ok: true, payload: { method: "test" } }) });

let members: typeof import("../../src/app/actions/org-members");
let lifecycle: typeof import("../../src/app/actions/org-lifecycle");
let lib: typeof import("../../src/lib/organizations/lifecycle");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  lifecycle = await loadAppModule(() => import("../../src/app/actions/org-lifecycle"));
  lib = await loadAppModule(() => import("../../src/lib/organizations/lifecycle"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const user = () => sql.begin((tx) => createUser(tx));
async function org() {
  const owner = await user();
  const id = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', join_code = ${generateJoinCode()}, join_code_enabled = true, title = 'Acme' WHERE id = ${id}`;
  created.push(id);
  return { id, owner };
}
async function join(orgId: string, role: "admin" | "member" | "viewer", n = 1) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await user();
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${orgId}, ${id}, ${role})`;
    ids.push(id);
  }
  return ids;
}
const emailOf = async (id: string) => (await sql<{ email: string }[]>`SELECT email FROM profiles WHERE id = ${id}`)[0]!.email;

test("2.3: the 20-admin cap counts open admin invites, on invite and on accept", async () => {
  const o = await org();
  await join(o.id, "admin", 19);
  viewerId = o.owner;
  const first = await members.inviteByEmailAction(o.id, { emails: "one@example.com", role: "admin" });
  assert.equal(first.success, true, JSON.stringify(first));
  const second = await members.inviteByEmailAction(o.id, { emails: "two@example.com", role: "admin" });
  assert.equal(second.success, false, "19 admins + 1 open admin invite = 20");
  // Re-sending to the same address doesn't count its own seat twice.
  assert.equal((await members.inviteByEmailAction(o.id, { emails: "one@example.com", role: "admin" })).success, true);

  const invitee = await user();
  const [invite] = await sql<{ id: string }[]>`INSERT INTO org_email_invites (org_id, email, role, invited_by, expires_at)
    VALUES (${o.id}, ${await emailOf(invitee)}, 'admin', ${o.owner}, now() + interval '7 days') RETURNING id`;
  await join(o.id, "admin");
  viewerId = invitee;
  const accepted = await members.acceptOrgInviteAction(invite!.id);
  assert.equal(accepted.success, false);
  assert.match(accepted.success ? "" : accepted.error, /already has 20 admins/);
  const [still] = await sql`SELECT accepted_at FROM org_email_invites WHERE id = ${invite!.id}`;
  assert.equal(still!.accepted_at, null, "the invite stays open");
});

test("3.5: viewers are never placed in a workspace", async () => {
  const o = await org();
  const child = await sql.begin((tx) => createProject(tx, o.owner));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${child}`;
  const [viewer] = await join(o.id, "viewer");
  viewerId = o.owner;
  const invite = await members.inviteByEmailAction(o.id, { emails: "guest@example.com", role: "viewer", childProjectId: child });
  assert.equal(invite.success, false);
  const added = await members.addMembersToChildAction(o.id, child, [viewer!], null);
  assert.deepEqual(added, { success: true, added: 0, skipped: 1 });
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${child} AND user_id = ${viewer!}`;
  assert.equal(n, 0);
});

test("3.4, 2.8, N5, N17: admins can't touch admin invites; resend is throttled and counts today", async () => {
  const o = await org();
  const [admin] = await join(o.id, "admin");
  const [adminInvite] = await sql<{ id: string }[]>`INSERT INTO org_email_invites (org_id, email, role, invited_by, expires_at, created_at)
    VALUES (${o.id}, 'boss@example.com', 'admin', ${o.owner}, now() + interval '7 days', now() - interval '3 days') RETURNING id`;
  const [memberInvite] = await sql<{ id: string }[]>`INSERT INTO org_email_invites (org_id, email, role, invited_by, expires_at, created_at)
    VALUES (${o.id}, 'pal@example.com', 'member', ${o.owner}, now() + interval '7 days', now() - interval '3 days') RETURNING id`;
  viewerId = admin!;
  assert.equal((await members.cancelOrgInviteAction(o.id, adminInvite!.id)).success, false);
  assert.equal((await members.resendOrgInviteAction(o.id, adminInvite!.id)).success, false);
  // Two clicks at once: one goes out, the other is refused (one resend a minute).
  const both = await Promise.all([members.resendOrgInviteAction(o.id, memberInvite!.id), members.resendOrgInviteAction(o.id, memberInvite!.id)]);
  assert.deepEqual(both.map((r) => r.success).sort(), [false, true], JSON.stringify(both));
  const [row] = await sql<{ today: boolean }[]>`SELECT created_at > now() - interval '1 minute' AS today FROM org_email_invites WHERE id = ${memberInvite!.id}`;
  assert.equal(row!.today, true, "a resend counts toward today's invites");
  assert.equal((await members.cancelOrgInviteAction(o.id, memberInvite!.id)).success, true);
  assert.equal((await members.cancelOrgInviteAction(o.id, memberInvite!.id)).success, false, "nothing left to cancel");
});

test("7.2, 7.3, N40: org viewers are in no channel, can't make one, and move in and out of #general with their role", async () => {
  const o = await org();
  const [member, viewer] = [...await join(o.id, "member"), ...await join(o.id, "viewer")];
  await sql`SELECT app_private.chat_sync_workspace_members(${o.id}::uuid, NULL, 'ensure_default')`;
  const inGeneral = async (id: string) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id
    WHERE c.workspace_id = ${o.id} AND c.is_default AND m.user_id = ${id}`)[0]!.n === 1;
  assert.equal(await inGeneral(member!), true);
  assert.equal(await inGeneral(viewer!), false);
  await assert.rejects(sql`SELECT app_private.chat_create_channel(${o.id}::uuid, ${viewer!}::uuid, 'side', NULL, false)`);

  viewerId = o.owner;
  assert.equal((await members.changeMemberRoleAction(o.id, [member!], "viewer")).success, true);
  assert.equal(await inGeneral(member!), false, "demoted to viewer: out of #general");
  assert.equal((await members.changeMemberRoleAction(o.id, [viewer!], "member")).success, true);
  assert.equal(await inGeneral(viewer!), true, "promoted from viewer: into #general");
});

test("3.6, 3.7, N4, N38: takeover requests expire, die with the asker's admin role, and need the owner still away", async () => {
  const o = await org();
  const [asker, other] = await join(o.id, "admin", 2);
  const away = sql`now() - interval '60 days'`;
  await sql`UPDATE workspace_members SET last_active_here_at = ${away}, joined_at = ${away} WHERE workspace_id = ${o.id} AND user_id = ${o.owner}`;

  // 3.7 / N38: the asker is demoted, so another admin may ask.
  await sql`UPDATE workspaces SET takeover_requested_by = ${asker!}, takeover_requested_at = now() - interval '1 day' WHERE id = ${o.id}`;
  viewerId = other!;
  assert.equal((await lifecycle.readTakeoverAction(o.id) as { state?: string }).state, "asked_by_other");
  viewerId = o.owner;
  await members.changeMemberRoleAction(o.id, [asker!], "member");
  const [cleared] = await sql`SELECT takeover_requested_by FROM workspaces WHERE id = ${o.id}`;
  assert.equal(cleared!.takeover_requested_by, null);

  // N4: a request older than 14 days is gone.
  await sql`UPDATE workspaces SET takeover_requested_by = ${other!}, takeover_requested_at = now() - interval '15 days' WHERE id = ${o.id}`;
  viewerId = other!;
  assert.equal((await lifecycle.readTakeoverAction(o.id) as { state?: string }).state, "can_ask");
  assert.deepEqual(await lib.takeOverOrg(o.id, other!, null), { error: "This request has expired. Ask again." });

  // N4: the owner came back during the 7 days, so taking over is refused and the request ends.
  await sql`UPDATE workspaces SET takeover_requested_at = now() - interval '8 days' WHERE id = ${o.id}`;
  await sql`UPDATE workspace_members SET last_active_here_at = now() WHERE workspace_id = ${o.id} AND user_id = ${o.owner}`;
  assert.deepEqual(await lib.takeOverOrg(o.id, other!, null), { error: "The owner has been active here, so the request ended." });
  const [ended] = await sql`SELECT takeover_requested_by FROM workspaces WHERE id = ${o.id}`;
  assert.equal(ended!.takeover_requested_by, null);

  // 3.6: an owner who never opened the org counts from joining, not from when tracking began.
  await sql`UPDATE workspace_members SET last_active_here_at = NULL, joined_at = now() - interval '2 days' WHERE workspace_id = ${o.id} AND user_id = ${o.owner}`;
  assert.equal((await lifecycle.readTakeoverAction(o.id) as { state?: string }).state, "hidden");
});
