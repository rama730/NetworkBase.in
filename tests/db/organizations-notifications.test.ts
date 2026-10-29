import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P14 (report §26): the scheduled jobs, the digest skip, material privacy in E5 and announcement audiences.
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
process.env.RESEND_EMAIL_ENABLED = "true";

let digests: typeof import("../../src/lib/organizations/org-digests");
let notify: typeof import("../../src/lib/organizations/notify");
let assignmentNotify: typeof import("../../src/lib/organizations/assignment-notify");
before(async () => {
  digests = await loadAppModule(() => import("../../src/lib/organizations/org-digests"));
  notify = await loadAppModule(() => import("../../src/lib/organizations/notify"));
  assignmentNotify = await loadAppModule(() => import("../../src/lib/organizations/assignment-notify"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) {
    await sql`DELETE FROM email_outbox WHERE workspace_id = ${id}`;
    await sql`DELETE FROM workspaces WHERE id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

async function org(timeZone = "UTC") {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  await sql`UPDATE profiles SET notification_preferences = ${sql.json({ quietHours: { enabled: false, startMinute: 0, endMinute: 0, timeZone: "UTC" } })} WHERE id IN (${a!}, ${b!})`;
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3A', time_zone = ${timeZone} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, a: a!, b: b! };
}

async function master(orgId: string, owner: string, settings: Record<string, unknown> = {}) {
  const [row] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_settings)
    VALUES (${orgId}, 'Lab 2', 'assignment', ${owner}, ${sql.json({ version: 1, submissionType: "file", reviewRequired: true, lateRule: "always", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null, ...settings })}) RETURNING id`;
  return row!.id as string;
}

async function copy(orgId: string, masterId: string, assignee: string, due: Date, extra: { reviewStatus?: string } = {}) {
  const [row] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, due_date, review_status, review_submitted_at)
    VALUES (${orgId}, 'Lab 2', 'task', ${masterId}, ${assignee}, ${assignee}, ${due}, ${extra.reviewStatus ?? "none"}, ${extra.reviewStatus === "pending" ? new Date() : null}) RETURNING id`;
  return row!.id as string;
}

const outbox = (orgId: string, kind: string) => sql`SELECT user_id, data FROM email_outbox WHERE workspace_id = ${orgId} AND kind = ${kind} ORDER BY created_at`;
const tray = (orgId: string, userId: string) => sql`SELECT title FROM user_notifications WHERE user_id = ${userId} AND entity_refs->>'orgId' = ${orgId}`;

test("due soon: one combined email and tray row per person per org per day at 9:00 local; overdue once; a rerun adds nothing", async () => {
  const o = await org();
  const now = new Date();
  now.setUTCHours(9, 20, 0, 0);
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  const m1 = await master(o.id, o.owner);
  const m2 = await master(o.id, o.owner);
  await copy(o.id, m1, o.a, tomorrow);
  await copy(o.id, m2, o.a, new Date(tomorrow.getTime() + 3600 * 1000));
  await copy(o.id, m1, o.b, new Date(now.getTime() - 2 * 3600 * 1000));

  await digests.runOrgDueSoon(new Date(now.getTime() + 3600 * 1000));
  assert.equal((await outbox(o.id, "org_due_soon")).length, 0, "10:20 is not 9:00 for anyone here");

  await digests.runOrgDueSoon(now);
  await digests.runOrgDueSoon(now);
  const due = await outbox(o.id, "org_due_soon");
  assert.equal(due.length, 1);
  assert.equal(due[0]!.user_id, o.a);
  assert.equal((due[0]!.data as { items: unknown[] }).items.length, 2, "both assignments in one email");
  assert.deepEqual((await outbox(o.id, "org_overdue")).map((r) => r.user_id), [o.b]);
  assert.deepEqual((await tray(o.id, o.a)).map((r) => r.title), ["2 assignments due tomorrow in CSE-3A"]);
  assert.equal((await tray(o.id, o.b)).length, 1);
});

test("admin digest: skipped when empty, sent to the owner and admins at 8:00 org time, once a day", async () => {
  const o = await org("Asia/Kolkata");
  const now = new Date();
  now.setUTCHours(2, 40, 0, 0); // 08:10 in Kolkata
  await digests.runOrgAdminDigest(now);
  assert.equal((await outbox(o.id, "org_digest")).length, 0, "nothing to report, nothing sent");

  await copy(o.id, await master(o.id, o.owner), o.a, new Date(now.getTime() + 86_400_000), { reviewStatus: "pending" });
  await digests.runOrgAdminDigest(new Date(now.getTime() + 3600 * 1000));
  assert.equal((await outbox(o.id, "org_digest")).length, 0, "09:10 is not digest time");
  await digests.runOrgAdminDigest(now);
  await digests.runOrgAdminDigest(now);
  const sent = await outbox(o.id, "org_digest");
  assert.deepEqual(sent.map((r) => r.user_id).sort(), [o.owner, o.admin].sort());
  assert.deepEqual((sent[0]!.data as { digest: { toReview: unknown } }).digest.toReview, [{ title: "Lab 2", count: 1 }]);

  await sql`UPDATE workspaces SET org_settings = org_settings || '{"adminDigest": "instant"}'::jsonb WHERE id = ${o.id}`;
  await sql`DELETE FROM email_outbox WHERE workspace_id = ${o.id}`;
  await digests.runOrgAdminDigest(now);
  assert.equal((await outbox(o.id, "org_digest")).length, 0, "instant orgs get no digest");
});

test("E5 lists only materials the members can open, and each person only their own team", async () => {
  const o = await org();
  const m = await master(o.id, o.owner);
  const insertNode = (path: string, type: string, access: string | null, taskId: string | null) => sql`INSERT INTO workspace_nodes (workspace_id, task_id, path, type, name, metadata, current_version)
    VALUES (${o.id}, ${taskId}, ${path}, ${type}, ${path.split("/").at(-1)!}, ${sql.json(access ? { access } : {})}, 1)`;
  await insertNode("/Staff", "folder", "admins", null);
  await insertNode("/Staff/answer-key.pdf", "file", null, m);
  await insertNode("/notes.pdf", "file", null, m);
  const teamCopy = await copy(o.id, m, o.a, new Date(Date.now() + 86_400_000));
  await sql`UPDATE tasks SET team_name = 'Team A' WHERE id = ${teamCopy}`;
  await sql`INSERT INTO task_team_members (task_id, user_id, is_lead) VALUES (${teamCopy}, ${o.a}, true), (${teamCopy}, ${o.b}, false)`;
  await copy(o.id, m, o.admin, new Date(Date.now() + 86_400_000));

  await assignmentNotify.notifyAssignmentPublished(m, o.owner);
  const rows = await outbox(o.id, "org_assignment");
  const byUser = new Map(rows.map((r) => [r.user_id, r.data as { assignment: { materials: Array<{ name: string }>; team: string[]; teamName: string | null } }]));
  assert.deepEqual(byUser.get(o.a)!.assignment.materials.map((f) => f.name), ["notes.pdf"]);
  assert.equal(byUser.get(o.b)!.assignment.teamName, "Team A");
  assert.equal(byUser.get(o.admin)!.assignment.team.length, 0, "the admin's own copy has no team");
  assert.equal(JSON.stringify(rows).includes("answer-key"), false);
  assert.equal((await tray(o.id, o.b)).length, 1);
});

test("announcements reach their audience only; the sixth emailed one in a day goes to the tray alone", async () => {
  const o = await org();
  const post = async (audience: unknown, email = false) => {
    const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, visibility, notify_level, audience)
      VALUES (${o.id}, ${o.owner}, 'Midterm moved', 'announcement', 'members', ${email ? "email" : "in_app"}, ${sql.json(audience ?? {})}) RETURNING id`;
    return notify.notifyAnnouncement({ orgId: o.id, updateId: row!.id, actorId: o.owner, content: "Midterm moved", audience: audience as never, email });
  };
  await post({ roles: ["admin"] });
  assert.equal((await tray(o.id, o.a)).length, 0, "members outside the audience hear nothing");
  assert.equal((await tray(o.id, o.admin)).length, 1);

  for (let i = 0; i < 5; i++) assert.equal((await post(null, true))?.emailed, true);
  assert.equal((await post(null, true))?.emailed, false);
  assert.equal((await tray(o.id, o.a)).length, 6, "every post still reaches the tray");
});

test("the signed mute link: GET only asks, POST mutes that org's email; a forged token does nothing", async () => {
  process.env.EMAIL_LINK_SECRET = "test-secret-for-links";
  const o = await org();
  const route = await loadAppModule(() => import("../../src/app/api/v1/email/org-mute/route"));
  const { orgMuteToken } = await loadAppModule(() => import("../../src/lib/email/org-templates"));
  const { NextRequest } = await import("next/server");
  const url = (token: string) => `http://localhost:3000/api/v1/email/org-mute?token=${encodeURIComponent(token)}`;
  const choice = async () => (await sql`SELECT notification_preferences->'organizations'->${o.id}::text AS c FROM profiles WHERE id = ${o.a}`)[0]!.c;

  const ask = await route.GET(new NextRequest(url(orgMuteToken(o.a, o.id)!)));
  assert.equal(ask.status, 200);
  assert.match(await ask.text(), /Mute emails from CSE-3A\?/);
  assert.equal(await choice(), null, "opening the link changes nothing");

  const forged = await route.POST(new NextRequest(url(`${Buffer.from(`${o.a}.${o.id}`).toString("base64url")}.bad`), { method: "POST" }));
  assert.equal(forged.status, 400);
  assert.equal(await choice(), null);

  const done = await route.POST(new NextRequest(url(orgMuteToken(o.a, o.id)!), { method: "POST", body: "List-Unsubscribe=One-Click" }));
  assert.equal(done.status, 200);
  assert.deepEqual(await choice(), { level: "all", email: false, includeChildren: true });
  delete process.env.EMAIL_LINK_SECRET;
});

test("§21 Work → Reminders: due-day only skips the day-before email; off sends neither; overdue still goes", async () => {
  const o = await org();
  const now = new Date();
  now.setUTCHours(9, 20, 0, 0);
  const m = await master(o.id, o.owner);
  await copy(o.id, m, o.a, new Date(now.getTime() + 24 * 3600 * 1000));
  await copy(o.id, m, o.b, new Date(now.getTime() + 3 * 3600 * 1000));
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || '{"assignmentReminders":"due_day"}'::jsonb WHERE id = ${o.id}`;
  await digests.runOrgDueSoon(now);
  assert.equal((await outbox(o.id, "org_due_soon")).length, 0, "no day-before email");
  assert.ok((await tray(o.id, o.b)).some((r) => r.title.startsWith("Lab 2 is due today")));

  const o2 = await org();
  const m2 = await master(o2.id, o2.owner);
  await copy(o2.id, m2, o2.b, new Date(now.getTime() + 3 * 3600 * 1000));
  await copy(o2.id, m2, o2.a, new Date(now.getTime() - 2 * 3600 * 1000));
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || '{"assignmentReminders":"off"}'::jsonb WHERE id = ${o2.id}`;
  await digests.runOrgDueSoon(now);
  assert.equal((await tray(o2.id, o2.b)).length, 0, "off: no due-today notice");
  assert.equal((await tray(o2.id, o2.a)).length, 1, "overdue is not a reminder");
});
