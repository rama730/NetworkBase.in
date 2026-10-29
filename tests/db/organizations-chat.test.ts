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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.20" }) });

let orgChat: typeof import("../../src/app/actions/org-chat");
let updates: typeof import("../../src/app/actions/project/updates");
let cards: typeof import("../../src/lib/messaging/cards");
let orgs: typeof import("../../src/app/actions/organizations");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  updates = await loadAppModule(() => import("../../src/app/actions/project/updates"));
  cards = await loadAppModule(() => import("../../src/lib/messaging/cards"));
  orgChat = await loadAppModule(() => import("../../src/app/actions/org-chat"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const sync = (projectId: string, userId: string | null = null, op = "add") => sql`SELECT app_private.chat_sync_project_members(${projectId}::uuid, ${userId}::uuid, ${op})`;
const defaultChannel = async (projectId: string) => (await sql`SELECT id, name FROM chat_channels WHERE project_id = ${projectId} AND is_default`)[0] as { id: string; name: string };
const inChannel = async (channelId: string, userId: string) => (await sql`SELECT notify FROM chat_channel_members WHERE channel_id = ${channelId} AND user_id = ${userId}`)[0]?.notify ?? null;

async function org(orgType = "education") {
  const [owner, admin, a, b, guest, outsider] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  await sql`UPDATE profiles SET message_privacy = 'connections' WHERE id IN (${a!}, ${b!}, ${guest!}, ${outsider!})`;
  const orgId = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${orgId}, ${owner!}, 'owner'), (${orgId}, ${admin!}, 'admin'), (${orgId}, ${a!}, 'member'), (${orgId}, ${b!}, 'member'), (${orgId}, ${guest!}, 'viewer')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = ${orgType}, join_code = ${generateJoinCode()}, title = 'CSE-3A' WHERE id = ${orgId}`;
  const child = await sql.begin((tx) => createProject(tx, a!, { visibility: "org" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${a!}, 'owner'), (${child}, ${outsider!}, 'member')`;
  await sql`UPDATE projects SET parent_id = ${orgId}, title = 'Compiler Lab', slug = ${`compiler_lab_${child.slice(0, 6)}`} WHERE id = ${child}`;
  created.push(orgId, child);
  await sync(orgId);
  await sync(child);
  return { orgId, child, owner: owner!, admin: admin!, a: a!, b: b!, guest: guest!, outsider: outsider! };
}

test("child projects get #<handle>; guests aren't auto-added to #general; #general has no 500 cap", async () => {
  const o = await org();
  const general = await defaultChannel(o.orgId);
  const lab = await defaultChannel(o.child);
  assert.equal(general.name, "general");
  assert.equal(lab.name, `compiler-lab-${o.child.slice(0, 6)}`);
  assert.equal(await inChannel(general.id, o.guest), null, "guests are not auto-joined");
  assert.ok(await inChannel(general.id, o.b));
  assert.ok(await inChannel(lab.id, o.outsider), "outside people get their project's channel");
  await sql`UPDATE chat_channels SET member_count = 600 WHERE id = ${general.id}`;
  await sql`SELECT app_private.chat_assert_capacity(${general.id}::uuid, ARRAY[${o.b}::uuid])`;
  await sql`UPDATE chat_channels SET member_count = 500 WHERE id = ${lab.id}`;
  await assert.rejects(sql`SELECT app_private.chat_assert_capacity(${lab.id}::uuid, ARRAY[${o.b}::uuid])`, /chat_channel_member_limit/);
});

test("org admins open child channels as mentions-only; other org members can't", async () => {
  const o = await org();
  const lab = await defaultChannel(o.child);
  await sql`SELECT app_private.chat_join_channel(${lab.id}::uuid, ${o.admin}::uuid)`;
  assert.equal(await inChannel(lab.id, o.admin), "mentions");
  await assert.rejects(sql`SELECT app_private.chat_join_channel(${lab.id}::uuid, ${o.b}::uuid)`, /chat_not_project_member/);
  const [boot] = await sql`SELECT app_private.chat_bootstrap(${o.admin}::uuid) AS b`;
  const projects = boot!.b.projects as Array<{ id: string; kind: string; parent_id: string | null; role: string }>;
  assert.deepEqual(projects.find((p) => p.id === o.child) && { parent: projects.find((p) => p.id === o.child)!.parent_id, role: projects.find((p) => p.id === o.child)!.role }, { parent: o.orgId, role: "org_admin" });
  assert.equal(projects.find((p) => p.id === o.orgId)?.kind, "organization");
});

test("people in the same org may DM; guests and blocks follow the usual rules", async () => {
  const o = await org();
  const canDm = async (from: string, to: string) => (await sql`SELECT app_private.chat_can_dm(${from}::uuid, ${to}::uuid) AS ok`)[0]!.ok;
  assert.equal(await canDm(o.admin, o.a), true, "a teacher reaches a connections-only student");
  assert.equal(await canDm(o.a, o.b), true);
  assert.equal(await canDm(o.a, o.guest), false, "guests follow their privacy setting");
  assert.equal(await canDm(o.a, o.outsider), false, "outside people aren’t in the org");
  await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${o.b}, ${o.a}, 'blocked', ${o.b}, now())`;
  assert.equal(await canDm(o.a, o.b), false, "blocks win");
});

test("org rules: members create channels only where allowed; #general can be admins-only", async () => {
  const edu = await org("education");
  await assert.rejects(sql`SELECT app_private.chat_create_channel(${edu.orgId}::uuid, ${edu.a}::uuid, 'lab-help', '', false)`, /chat_org_channels_admins_only/);
  await sql`SELECT app_private.chat_create_channel(${edu.orgId}::uuid, ${edu.admin}::uuid, 'staff', '', true)`;
  await sql`SELECT app_private.chat_create_channel(${edu.child}::uuid, ${edu.a}::uuid, 'lab-tests', '', false)`; // child projects keep the existing rule
  const company = await org("company");
  await sql`SELECT app_private.chat_create_channel(${company.orgId}::uuid, ${company.a}::uuid, 'deals', '', false)`;

  viewerId = edu.admin;
  assert.equal((await orgChat.updateOrgChatSettingsAction(edu.orgId, { generalAdminsOnly: true, membersCreateChannels: true })).success, true);
  viewerId = edu.a;
  assert.equal((await orgChat.updateOrgChatSettingsAction(edu.orgId, { generalAdminsOnly: false })).success, false);
  const general = await defaultChannel(edu.orgId);
  const post = (author: string) => sql`SELECT app_private.chat_append_message(${general.id}::uuid, ${author}::uuid, 'user', 'Hello', NULL, NULL, '[]'::jsonb, NULL)`;
  await assert.rejects(post(edu.a), /chat_general_admins_only/);
  await post(edu.admin);
  await sql`SELECT app_private.chat_create_channel(${edu.orgId}::uuid, ${edu.a}::uuid, 'lab-help', '', false)`;
});

test("detach: the project's channels leave the org (default back to #general, org admins out); move-in renames", async () => {
  const o = await org();
  const lab = await defaultChannel(o.child);
  await sql`SELECT app_private.chat_join_channel(${lab.id}::uuid, ${o.admin}::uuid)`;
  viewerId = o.owner;
  assert.equal((await orgs.detachChildAction(o.child)).success, true);
  assert.equal((await defaultChannel(o.child)).name, "general");
  assert.equal(await inChannel(lab.id, o.admin), null, "org admins lose access");
  assert.ok(await inChannel(lab.id, o.a), "the team keeps its chat");
});

test("Also share in #general posts a live card; each viewer sees what they may, assignments their own status", async () => {
  const o = await org();
  viewerId = o.admin;
  const posted = await updates.createProjectUpdateAction(o.orgId, { content: "Midterm moved to Nov 10", updateType: "announcement", visibility: "members", shareToGeneral: true } as never);
  assert.equal(posted.success, true, JSON.stringify(posted));
  const updateId = posted.success ? posted.data!.id : "";
  const general = await defaultChannel(o.orgId);
  const [card] = await sql`SELECT kind, ref_id FROM chat_message_cards WHERE channel_id = ${general.id} AND ref_id = ${updateId}`;
  assert.equal(card?.kind, "announcement");
  const memberView = (await cards.hydrateCards(o.a, [{ kind: "announcement", ref_id: updateId }]))[`announcement:${updateId}`]!;
  assert.equal("restricted" in memberView, false);

  const limited = await updates.createProjectUpdateAction(o.orgId, { content: "Staff only", updateType: "announcement", visibility: "members", audience: { roles: ["admin"] } } as never);
  const limitedId = limited.success ? limited.data!.id : "";
  assert.ok("restricted" in (await cards.hydrateCards(o.a, [{ kind: "announcement", ref_id: limitedId }]))[`announcement:${limitedId}`]!, "outside the audience");

  const [master] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, due_date) VALUES (${o.orgId}, 'Lab 2', 'assignment', ${o.owner}, now() + interval '2 days') RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, review_status, review_submitted_at) VALUES
    (${o.orgId}, 'Lab 2', 'task', ${master!.id}, ${o.a}, ${o.owner}, 'pending', now()), (${o.orgId}, 'Lab 2', 'task', ${master!.id}, ${o.b}, ${o.owner}, 'none', null)`;
  const mine = (await cards.hydrateCards(o.a, [{ kind: "assignment", ref_id: master!.id }]))[`assignment:${master!.id}`] as { own: { state: string } | null; counts: unknown };
  assert.deepEqual([mine.own?.state, mine.counts], ["submitted", null], "a member sees only their own status");
  const staff = (await cards.hydrateCards(o.admin, [{ kind: "assignment", ref_id: master!.id }]))[`assignment:${master!.id}`] as { counts: { submitted: number; total: number } };
  assert.deepEqual([staff.counts.submitted, staff.counts.total], [1, 2]);
});

test("§25 pass: #general starts at the org's notify default; an archived child's channels are read-only; group copies post in the child channel", async () => {
  const edu = await org("education");
  const general = await defaultChannel(edu.orgId);
  assert.equal(await inChannel(general.id, edu.b), "mentions", "Education defaults to Mentions");
  const company = await org("company");
  assert.equal(await inChannel((await defaultChannel(company.orgId)).id, company.b), "all");
  const late = await sql.begin((tx) => createUser(tx));
  await sql`UPDATE projects SET org_settings = coalesce(org_settings, '{}'::jsonb) || '{"generalNotify":"all"}'::jsonb WHERE id = ${edu.orgId}`;
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${edu.orgId}, ${late}, 'member')`;
  await sync(edu.orgId, late);
  assert.equal(await inChannel(general.id, late), "all", "the setting applies to people joining from now on");

  const lab = await defaultChannel(edu.child);
  await sql`UPDATE projects SET status = 'archived' WHERE id = ${edu.child}`;
  await assert.rejects(sql`INSERT INTO chat_messages (channel_id, author_id, kind, body, channel_seq) VALUES (${lab.id}, ${edu.a}, 'user', 'hi', 999999)`, /chat_org_read_only/);
  await sql`UPDATE projects SET status = 'active' WHERE id = ${edu.child}`;

  const notify = await loadAppModule(() => import("../../src/lib/organizations/assignment-notify"));
  const [m] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, assignment_settings) VALUES (${edu.orgId}, 'Mini-project proposal', 'assignment', ${edu.owner},
    ${sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "each_child" }, publishedAt: new Date().toISOString(), closedAt: null })}) RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id) VALUES (${edu.child}, 'Mini-project proposal', 'task', ${m!.id}, ${edu.a}, ${edu.owner})`;
  await notify.notifyAssignmentPublished(m!.id, edu.owner);
  const posted = await sql`SELECT body FROM chat_messages WHERE channel_id = ${lab.id} AND kind = 'system' ORDER BY channel_seq DESC LIMIT 3`;
  assert.ok(posted.some((p) => String(p.body).includes("CSE-3A assigned Mini-project proposal")), JSON.stringify(posted));
});
