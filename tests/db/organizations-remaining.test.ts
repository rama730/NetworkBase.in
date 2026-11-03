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
let assignments: typeof import("../../src/app/actions/assignments");
let comments: typeof import("../../src/app/actions/task-comment");
let dashboard: typeof import("../../src/app/actions/org-dashboard");
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
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  comments = await loadAppModule(() => import("../../src/app/actions/task-comment"));
  dashboard = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
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

async function published(o: Awaited<ReturnType<typeof org>>, title: string) {
  const [m] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_settings, creator_id)
    VALUES (${o.id}, ${title}, 'assignment', ${sql.json({ publishedAt: new Date().toISOString(), submissionType: "none", reviewRequired: true, target: { mode: "everyone" } })}, ${o.owner}) RETURNING id`;
  for (const person of [o.a, o.b]) await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id) VALUES (${o.id}, ${title}, 'task', ${m!.id}, ${person}, ${o.owner})`;
  return m!.id as string;
}

test("problem 33: the review queue holds ordinary board tasks waiting for review, not only copies", async () => {
  const o = await org();
  const [t] = await sql`INSERT INTO tasks (workspace_id, title, assignee_id, creator_id, status, review_status, review_submitted_at) VALUES (${o.id}, 'Book the lab', ${o.a}, ${o.owner}, 'done', 'pending', now()) RETURNING id`;
  viewerId = o.admin;
  const queue = await assignments.readReviewQueueAction(o.id);
  assert.ok(queue.success);
  assert.deepEqual(queue.success ? queue.rows.filter((r) => r.kind === "task").map((r) => r.copyId) : [], [t!.id]);
});

test("23.5: a new class question tells the admins; Tell everyone tells everyone on the assignment", async () => {
  const o = await org();
  const master = await published(o, `Lab ${o.tag}`);
  viewerId = o.a;
  const asked = await comments.createTaskCommentAction(master, o.id, "Can we use Python?");
  assert.equal(asked.success, true, JSON.stringify(asked));
  const admins = (await sql`SELECT user_id FROM user_notifications WHERE title LIKE ${`%asked about Lab ${o.tag}`}`).map((r) => r.user_id).sort();
  assert.deepEqual(admins, [o.owner, o.admin].sort());
  viewerId = o.admin;
  const question = asked.success ? asked.data.comment!.id : "";
  const answered = await comments.createTaskCommentAction(master, o.id, "Yes, 3.11 or later.", question);
  assert.ok(answered.success);
  viewerId = o.b;
  assert.equal((await comments.shareClassAnswerAction(master, answered.success ? answered.data.comment!.id : "")).success, false, "members can't");
  viewerId = o.admin;
  const shared = await comments.shareClassAnswerAction(master, answered.success ? answered.data.comment!.id : "");
  assert.deepEqual(shared, { success: true, told: 2 });
  const told = (await sql`SELECT user_id FROM user_notifications WHERE title = ${`New answer on Lab ${o.tag}`}`).map((r) => r.user_id).sort();
  assert.deepEqual(told, [o.a, o.b].sort());
});

test("30.4: a team lead who moves away leaves the team without one, and the workspace lead hears it", async () => {
  const o = await org();
  const lead = await sql.begin((tx) => createUser(tx));
  const child = await sql.begin((tx) => createProject(tx, lead, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon' WHERE id = ${child}`;
  const [front] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled, team_lead_user_id) VALUES (${child}, 'Frontend', 'Frontend', 3, 1, ${o.a}) RETURNING id`;
  const [back] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled) VALUES (${child}, 'Backend', 'Backend', 3, 0) RETURNING id`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, unit_id) VALUES (${child}, ${lead}, 'owner', NULL), (${child}, ${o.a}, 'member', ${front!.id})`;
  viewerId = o.admin;
  const moved = await units.moveMemberToUnitAction(child, o.a, back!.id, false);
  assert.equal(moved.success, true, JSON.stringify(moved));
  assert.equal((await sql`SELECT team_lead_user_id FROM workspace_open_roles WHERE id = ${front!.id}`)[0]!.team_lead_user_id, null);
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${lead} AND title = 'Frontend has no team lead'`).length);
});

test("30.4: a removed team lead's notice goes out only after the removal commits; a rollback tells no one", async () => {
  const o = await org();
  const lead = await sql.begin((tx) => createUser(tx));
  const child = await sql.begin((tx) => createProject(tx, lead, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${child}`;
  const [front] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled, team_lead_user_id) VALUES (${child}, 'Frontend', ${`Front ${o.tag}`}, 3, 1, ${o.a}) RETURNING id`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, unit_id) VALUES (${child}, ${lead}, 'owner', NULL), (${child}, ${o.a}, 'member', ${front!.id})`;
  const { transactionThen } = await loadAppModule(() => import("../../src/lib/db/after-commit"));
  const { removeWorkspaceMemberInternal } = await loadAppModule(() => import("../../src/lib/workspaces/collaborator-lifecycle"));
  const told = async () => (await sql`SELECT 1 FROM user_notifications WHERE user_id = ${lead} AND title = ${`Front ${o.tag} has no team lead`}`).length;
  await assert.rejects(transactionThen(async (tx) => {
    await removeWorkspaceMemberInternal(tx, { projectId: child, actorId: lead, realActorId: o.admin, targetUserId: o.a, mode: "unassign_active_tasks" });
    throw new Error("rolled back");
  }), /rolled back/);
  assert.equal(await told(), 0, "a rolled-back removal tells no one");
  assert.equal((await sql`SELECT team_lead_user_id FROM workspace_open_roles WHERE id = ${front!.id}`)[0]!.team_lead_user_id, o.a);
  // An organization admin acts with the lead's powers, so the lead hears it even though the removal runs as them.
  await transactionThen((tx) => removeWorkspaceMemberInternal(tx, { projectId: child, actorId: lead, realActorId: o.admin, targetUserId: o.a, mode: "unassign_active_tasks" }));
  assert.equal(await told(), 1, "told once it has committed");
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("33.5 Away: work due in the dates is excused at once, work published then starts excused; only admins mark it", async () => {
  const o = await org();
  const [m1] = await sql`INSERT INTO tasks (workspace_id, title, kind, due_date, assignment_settings, creator_id)
    VALUES (${o.id}, 'Lab A', 'assignment', now() + interval '2 days', ${sql.json({ publishedAt: new Date().toISOString(), submissionType: "none", target: { mode: "everyone" } })}, ${o.owner}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, due_date) VALUES (${o.id}, 'Lab A', 'task', ${m1!.id}, ${o.a}, ${o.owner}, now() + interval '2 days') RETURNING id`;
  viewerId = o.b;
  assert.equal((await members.markAwayAction(o.id, o.a, { from: day(0), to: day(5) })).success, false);
  viewerId = o.admin;
  const away = await members.markAwayAction(o.id, o.a, { from: day(0), to: day(5), reason: "Ill" });
  assert.deepEqual(away, { success: true, excused: 1 });
  assert.equal((await sql`SELECT excused_reason FROM tasks WHERE id = ${copy!.id}`)[0]!.excused_reason, "Away: Ill");
  const { createCopies } = await loadAppModule(() => import("../../src/lib/organizations/assignments"));
  const [m2] = await sql`INSERT INTO tasks (workspace_id, title, kind, due_date, assignment_settings, creator_id)
    VALUES (${o.id}, 'Lab B', 'assignment', now() + interval '3 days', ${sql.json({ publishedAt: new Date().toISOString(), submissionType: "none", target: { mode: "everyone" } })}, ${o.owner}) RETURNING id`;
  const appDb = await loadAppModule(() => import("../../src/lib/db"));
  await createCopies(appDb.db, m2!.id, [{ projectId: o.id, assigneeId: o.a }, { projectId: o.id, assigneeId: o.b }], o.owner);
  const rows = Object.fromEntries((await sql`SELECT assignee_id, excused_reason FROM tasks WHERE assignment_id = ${m2!.id}`).map((r) => [r.assignee_id, r.excused_reason]));
  assert.deepEqual([rows[o.a], rows[o.b]], ["Away: Ill", null]);
});

test("33.5 Catch up: a member who joined after sprints began sees the earlier ones; an admin doesn't", async () => {
  const o = await org();
  await sql`INSERT INTO workspace_sprints (workspace_id, name, sprint_number, start_date, end_date, status) VALUES (${o.id}, 'CO1', 1, now() - interval '20 days', now() - interval '13 days', 'completed')`;
  await sql`UPDATE workspace_members SET joined_at = now() - interval '2 days' WHERE workspace_id = ${o.id} AND user_id = ${o.a}`;
  viewerId = o.a;
  const mine = await dashboard.readOrgDashboardAction(o.id);
  assert.ok(mine.success);
  assert.deepEqual(mine.success ? mine.catchUp?.sprints.map((s) => s.name) : null, ["CO1"]);
  viewerId = o.admin;
  const theirs = await dashboard.readOrgDashboardAction(o.id);
  assert.equal(theirs.success ? theirs.catchUp : "x", null);
});

test("33.5 Reviewers: only the organization's admins can be picked; the queue marks each row Mine or not", async () => {
  const o = await org();
  const master = await published(o, `Lab ${o.tag}`);
  await sql`UPDATE tasks SET review_status = 'pending', review_submitted_at = now() WHERE assignment_id = ${master} AND assignee_id = ${o.a}`;
  viewerId = o.owner;
  assert.equal((await assignments.updateAssignmentAction(master, { reviewers: [o.a] })).success, false, "a member can't review");
  assert.equal((await assignments.updateAssignmentAction(master, { reviewers: [o.admin] })).success, true);
  const ownerQueue = await assignments.readReviewQueueAction(o.id);
  assert.deepEqual(ownerQueue.success ? ownerQueue.rows.filter((r) => r.kind === "copy").map((r) => r.mine) : null, [false]);
  viewerId = o.admin;
  const adminQueue = await assignments.readReviewQueueAction(o.id);
  assert.deepEqual(adminQueue.success ? adminQueue.rows.filter((r) => r.kind === "copy").map((r) => r.mine) : null, [true]);
});

test("33.5 Reviewers can be picked when the assignment is made, admins only", async () => {
  const o = await org();
  viewerId = o.owner;
  const base = { projectId: o.id, dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString(), publish: false, submissionType: "none" as const, reviewRequired: true, lateRule: "none" as const, target: { mode: "everyone" as const }, steps: [] };
  const refused = await assignments.createAssignmentAction({ ...base, title: `Essay ${o.tag} A`, reviewers: [o.a] });
  assert.deepEqual(refused, { success: false, error: "Reviewers are the organization’s admins." });
  const made = await assignments.createAssignmentAction({ ...base, title: `Essay ${o.tag} B`, reviewers: [o.admin, o.admin] });
  assert.ok(made.success, JSON.stringify(made));
  const [row] = await sql`SELECT assignment_settings->'reviewers' AS reviewers FROM tasks WHERE id = ${made.success ? made.masterId : ""}`;
  assert.deepEqual(row!.reviewers, [o.admin]);
});

test("33.5 Repeat: later weeks are made as drafts with their own due dates", async () => {
  const o = await org();
  viewerId = o.owner;
  const due = new Date(Date.now() + 3 * 86_400_000);
  const made = await assignments.createAssignmentAction({ projectId: o.id, title: `Quiz ${o.tag} 1`, dueDate: due.toISOString(), publish: true, submissionType: "none",
    lateRule: "none", target: { mode: "everyone" }, steps: [], repeatWeeklyUntil: new Date(due.getTime() + 15 * 86_400_000).toISOString() });
  assert.equal(made.success, true, JSON.stringify(made));
  assert.equal(made.success ? made.drafts : 0, 2);
  const drafts = await sql`SELECT title, assignment_settings->>'publishedAt' AS published FROM tasks WHERE workspace_id = ${o.id} AND kind = 'assignment' AND title LIKE ${`Quiz ${o.tag} %`} ORDER BY title`;
  assert.deepEqual(drafts.map((d) => [d.title, d.published]), [[`Quiz ${o.tag} 1`, drafts[0]!.published], [`Quiz ${o.tag} 2`, null], [`Quiz ${o.tag} 3`, null]]);
  assert.ok(drafts[0]!.published, "the first week is published");
});

test("33.5 Calendar: the private link's feed holds only the person's own due work and their sprints; a wrong token finds no one", async () => {
  const o = await org();
  const master = await published(o, `Essay ${o.tag}`);
  await sql`UPDATE tasks SET due_date = now() + interval '5 days' WHERE assignment_id = ${master}`;
  await sql`INSERT INTO workspace_sprints (workspace_id, name, sprint_number, start_date, end_date, status) VALUES (${o.id}, ${`CO-${o.tag}`}, 1, now(), now() + interval '7 days', 'active')`;
  const feed = await loadAppModule(() => import("../../src/lib/calendar/feed"));
  const token = (await feed.calendarToken(o.a))!;
  assert.equal(await feed.userForCalendarToken(token), o.a);
  // Only the hash is stored, and an existing link isn't handed out again.
  const [stored] = await sql`SELECT token_hash FROM calendar_feed_tokens WHERE user_id = ${o.a}`;
  assert.match(stored!.token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored!.token_hash, token);
  assert.equal(await feed.calendarToken(o.a), null, "the link is shown once");
  assert.equal(await feed.userForCalendarToken(token), o.a, "asking again keeps the link working");
  assert.equal(await feed.userForCalendarToken("x".repeat(43)), null);
  const entries = await feed.readCalendarEntries(o.a);
  assert.equal(entries.filter((e) => e.kind === "due" && e.title === `Essay ${o.tag}`).length, 1, "their own copy only, not b's");
  assert.ok(entries.some((e) => e.kind === "sprint" && e.title === `CO-${o.tag}`));
  const ics = feed.toIcs(entries, "https://networkbase.test");
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, new RegExp(`SUMMARY:Due: Essay ${o.tag}`));
  // A hostile title can't start a property or an event of its own (RFC 5545 §3.3.11).
  const hostile = feed.toIcs([{ id: "1", kind: "due", title: "A;B,C\\D\r\nBEGIN:VEVENT\rX\u0001", start: new Date().toISOString(), end: null, place: "P", href: "/x" }], "https://networkbase.test");
  assert.equal(hostile.split("\r\n").find((l) => l.startsWith("SUMMARY")), "SUMMARY:Due: A\\;B\\,C\\\\D\\nBEGIN:VEVENT\\nX");
  assert.equal(hostile.split("\r\n").filter((l) => l === "BEGIN:VEVENT").length, 1);
  const fresh = (await feed.calendarToken(o.a, true))!;
  assert.notEqual(fresh, token);
  assert.equal(await feed.userForCalendarToken(token), null, "a reset link stops the old one");
  assert.equal(await feed.userForCalendarToken(fresh), o.a);
});
