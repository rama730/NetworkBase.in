import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { ORG_ACTIONS, orgGrant } from "../../src/lib/organizations/permissions";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §33.7 "Every scenario", and the rows of §16.12 the first walk (organizations-scenarios) leaves out: each row
// walked through the real actions on the disposable database. Elsewhere already: Deleted's profile line keeps the
// name with no link (organizations-profile), Account deleted (organizations-lifecycle), Created's Get started
// (organizations-overview). The signed-in browser walk of the same rows needs a disposable Supabase project.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.144" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/lib/security/step-up", { resolveSecurityStepUp: async () => ({ ok: true, payload: { method: "test" } }) });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let orgs: typeof import("../../src/app/actions/organizations");
let members: typeof import("../../src/app/actions/org-members");
let lifecycle: typeof import("../../src/app/actions/org-lifecycle");
let assignments: typeof import("../../src/app/actions/assignments");
let dash: typeof import("../../src/app/actions/org-dashboard");
let sprints: typeof import("../../src/lib/workspaces/server/sprints");
// "Student never opened anything" counts from when Last active here shipped (41.4); this file moves that date back
// 30 days so the rule is visible, and puts it back afterwards. DB test files run one at a time.
let journalAt: string | null = null;
before(async () => {
  [{ at: journalAt }] = await sql`SELECT min(applied_at)::text AS at FROM app_migration_journal WHERE tag = '0043_member_last_active_here'`;
  await sql`UPDATE app_migration_journal SET applied_at = applied_at - interval '30 days' WHERE tag = '0043_member_last_active_here'`;
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: { fullName: "Tester", username: "tester", avatarUrl: null } }),
  });
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  lifecycle = await loadAppModule(() => import("../../src/app/actions/org-lifecycle"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
});

const created: string[] = [];
after(async () => {
  if (journalAt) await sql`UPDATE app_migration_journal SET applied_at = ${journalAt}::timestamptz WHERE tag = '0043_member_last_active_here'`;
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const inDays = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

/** A class: the teacher (owner), a TA (admin), and three students, active here today. */
async function org(type = "education") {
  const tag = Math.random().toString(36).slice(2, 8);
  const [teacher, ta, s1, s2, s3] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, teacher!));
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, last_active_here_at) VALUES (${id}, ${teacher!}, 'owner', now()), (${id}, ${ta!}, 'admin', now()),
    (${id}, ${s1!}, 'member', now()), (${id}, ${s2!}, 'member', now()), (${id}, ${s3!}, 'member', now())`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = ${type}, status = 'active', join_code = ${code}, join_code_enabled = true,
    title = ${`Class ${tag}`}, slug = ${`class-${tag}`}, org_settings = '{"joinMode":"instant"}'::jsonb WHERE id = ${id}`;
  created.push(id);
  return { id, tag, code, teacher: teacher!, ta: ta!, s1: s1!, s2: s2!, s3: s3!, students: [s1!, s2!, s3!] };
}
type Org = Awaited<ReturnType<typeof org>>;

/** A published assignment to everyone, through the real action; its copies by student. */
async function assign(o: Org, title: string, dueDate: string, extra: Record<string, unknown> = {}) {
  viewerId = o.teacher;
  const made = await assignments.createAssignmentAction({ projectId: o.id, title, dueDate, publish: true, submissionType: "text", lateRule: "always",
    target: { mode: "everyone" }, steps: [], ...extra });
  assert.ok(made.success, JSON.stringify(made));
  const copies = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${made.masterId} AND deleted_at IS NULL`;
  return { masterId: made.masterId, copyOf: (userId: string) => copies.find((c) => c.assignee_id === userId)!.id as string };
}

async function board(o: Org, as: string) {
  viewerId = as;
  const data = await dash.readOrgDashboardAction(o.id);
  assert.ok(data.success, JSON.stringify(data));
  return data;
}

test("33.7 Teacher away for a week: the TA does everything except ownership", async () => {
  // The permissions table: an admin differs from the owner only on the organization itself, never on the class.
  const ownerOnly = ORG_ACTIONS.filter((a) => orgGrant("owner", a) === "yes" && orgGrant("admin", a) !== "yes");
  assert.deepEqual(ownerOnly.sort(), ["appeal", "change_org_type", "edit_identity", "manage_admins", "org_lifecycle", "request_verified"]);
  const o = await org();
  viewerId = o.ta;
  const made = await assignments.createAssignmentAction({ projectId: o.id, title: `Lab ${o.tag}`, dueDate: inDays(3), publish: true, submissionType: "text", lateRule: "always", target: { mode: "everyone" }, steps: [], reviewRequired: true });
  assert.ok(made.success, "the TA sets work");
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""} AND assignee_id = ${o.s1}`;
  viewerId = o.s1;
  assert.ok((await assignments.submitAssignmentAction(copy!.id, { text: "Done" })).success);
  viewerId = o.ta;
  assert.ok((await assignments.reviewAssignmentCopyAction(copy!.id, "approve")).success, "the TA reviews");
  assert.ok((await members.remindMembersAction(o.id, [o.s2])).success, "the TA reminds");
  assert.equal((await lifecycle.archiveOrgAction(o.id)).success, false, "ownership stays with the teacher");
});

test("33.7 Student ill for two weeks: marked away, their work in those days is excused, and they're back after", async () => {
  const o = await org();
  const lab = await assign(o, `Lab ${o.tag}`, inDays(4));
  viewerId = o.ta;
  const away = await members.markAwayAction(o.id, o.s1, { from: day(0), to: day(14), reason: "Ill" });
  assert.deepEqual(away, { success: true, excused: 1 });
  const later = await assign(o, `Essay ${o.tag}`, inDays(10));
  const after = await assign(o, `Quiz ${o.tag}`, inDays(20));
  const excused = async (copy: string) => (await sql`SELECT excused_reason FROM tasks WHERE id = ${copy}`)[0]!.excused_reason;
  assert.equal(await excused(lab.copyOf(o.s1)), "Away: Ill");
  assert.equal(await excused(later.copyOf(o.s1)), "Away: Ill", "work set while away is excused too");
  assert.equal(await excused(after.copyOf(o.s1)), null, "work due after they're back is theirs");
  assert.equal(await excused(lab.copyOf(o.s2)), null);
});

test("33.7 Holiday moves the schedule: Move later sprints and Move due dates shift everything by the same days", async () => {
  const o = await org();
  viewerId = o.teacher;
  assert.ok((await sprints.planSprintSeriesAction({ projectId: o.id, prefix: "CO", count: 3, lengthDays: 7, startDate: day(2) })).success);
  const series = await sql`SELECT id, name, start_date::date::text AS start FROM workspace_sprints WHERE workspace_id = ${o.id} ORDER BY start_date`;
  const lab = await assign(o, `Lab ${o.tag}`, `${day(8)}T18:00:00.000Z`, { sprintId: series[0]!.id });
  viewerId = o.teacher;
  const moved = await sprints.updateSprintAction({ projectId: o.id, sprintId: series[0]!.id, name: "CO1", startDate: day(9), endDate: day(15), moveLaterSprints: true, moveDueDates: true });
  assert.equal(moved.success, true, JSON.stringify(moved));
  const after = await sql`SELECT name, start_date::date::text AS start FROM workspace_sprints WHERE workspace_id = ${o.id} ORDER BY start_date`;
  assert.deepEqual(after.map((s) => [s.name, s.start]), [["CO1", day(9)], ["CO2", day(16)], ["CO3", day(23)]]);
  const [copy] = await sql`SELECT due_date FROM tasks WHERE id = ${lab.copyOf(o.s1)}`;
  assert.equal(new Date(copy!.due_date).toISOString().slice(0, 10), day(15), "a week later, like its sprint");
});

test("33.7 Exam week: a gap between sprints keeps Today calm", async () => {
  const o = await org();
  await sql`INSERT INTO workspace_sprints (workspace_id, name, sprint_number, start_date, end_date, status) VALUES
    (${o.id}, 'CO3', 3, ${day(-10)}, ${day(-3)}, 'completed'), (${o.id}, 'CO4', 4, ${day(5)}, ${day(12)}, 'planning')`;
  const today = (await board(o, o.teacher)).today;
  assert.deepEqual(today.filter((r) => r.kind === "due_today" || r.kind === "sprint_ending"), [], "nothing is due and no sprint is ending");
});

test("33.7 Deadline extended for everyone: Edit for everyone moves every copy, and the people it moves are told", async () => {
  const o = await org();
  const lab = await assign(o, `Lab ${o.tag}`, inDays(2));
  viewerId = o.teacher;
  const later = inDays(5);
  assert.ok((await assignments.updateAssignmentAction(lab.masterId, { dueDate: later, tellEveryone: true })).success);
  for (const s of o.students) assert.equal(new Date((await sql`SELECT due_date FROM tasks WHERE id = ${lab.copyOf(s)}`)[0]!.due_date).toISOString(), later);
  const told = (await sql`SELECT DISTINCT user_id FROM user_notifications WHERE user_id IN ${sql(o.students)} AND title LIKE ${`%Lab ${o.tag}%`} AND created_at > now() - interval '1 minute'`).map((r) => r.user_id);
  assert.deepEqual(told.sort(), [...o.students].sort());
});

test("33.7 Whole class misses a deadline: the roster shows it; Extend for all reopens it, or Remind them", async () => {
  const o = await org();
  const lab = await assign(o, `Lab ${o.tag}`, inDays(1));
  await sql`UPDATE tasks SET due_date = now() - interval '1 day' WHERE assignment_id = ${lab.masterId} OR id = ${lab.masterId}`;
  viewerId = o.teacher;
  const roster = await assignments.readAssignmentRosterAction(lab.masterId);
  assert.ok(roster.success);
  assert.ok(roster.success && roster.rows.every((r) => r.state === "missing" || r.state === "late"), JSON.stringify(roster.success && roster.rows.map((r) => r.state)));
  const reminded = await assignments.remindCopiesAction(lab.masterId);
  assert.ok(reminded.success && reminded.reminded === 3, JSON.stringify(reminded));
  const extended = await assignments.extendCopiesAction(o.students.map((s) => lab.copyOf(s)), inDays(3), { reopen: true });
  assert.ok(extended.success, JSON.stringify(extended));
  const states = await assignments.readAssignmentRosterAction(lab.masterId);
  assert.ok(states.success && states.rows.every((r) => r.state === "not_started" || r.state === "open" || r.state === "to_do"), JSON.stringify(states.success && states.rows.map((r) => r.state)));
});

test("33.7 Nobody reviews for a week: the review row turns amber, '3 waiting, oldest 8 days'", async () => {
  const o = await org();
  const lab = await assign(o, `Lab ${o.tag}`, inDays(-9), { reviewRequired: true });
  await sql`UPDATE tasks SET status = 'done', review_status = 'pending', review_submitted_at = now() - interval '8 days', submission = '{"version":1}'::jsonb WHERE assignment_id = ${lab.masterId}`;
  const row = (await board(o, o.ta)).today.find((r) => r.kind === "review");
  assert.deepEqual(row && { label: row.label, tone: row.tone }, { label: `3 waiting, oldest 8 days · Lab ${o.tag}`, tone: "amber" });
});

test("33.7 Student never opened anything: Inactive, counted from joining", async () => {
  const o = await org();
  await sql`UPDATE workspace_members SET joined_at = now() - interval '20 days', last_active_here_at = NULL WHERE workspace_id = ${o.id} AND user_id = ${o.s1}`;
  await sql`UPDATE workspace_members SET joined_at = now() - interval '3 days', last_active_here_at = NULL WHERE workspace_id = ${o.id} AND user_id = ${o.s2}`;
  viewerId = o.teacher;
  const roster = await members.readOrgMembersAction(o.id);
  assert.ok(roster.success);
  assert.equal(roster.success && roster.summary.inactive, 1, "20 days since joining is inactive; 3 days isn't yet");
});

test("33.7 Workspace goes silent: its row says 'Quiet 7 days'; a busy one doesn't", async () => {
  const o = await org();
  const quiet = await sql.begin((tx) => createProject(tx, o.s1, { visibility: "org" }));
  const busy = await sql.begin((tx) => createProject(tx, o.s2, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Osprey', updated_at = now() - interval '9 days' WHERE id = ${quiet}`;
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon', updated_at = now() WHERE id = ${busy}`;
  viewerId = o.teacher;
  const rows = await dash.readOrgWorkspacesAction(o.id);
  assert.ok(rows.success);
  const reasons = Object.fromEntries(rows.success ? rows.rows.map((r) => [r.title, r.reasons]) : []);
  assert.ok(reasons["Team Osprey"]!.includes("quiet 7 days"));
  assert.ok(!reasons["Team Falcon"]!.includes("quiet 7 days"));
});

test("33.7 Team lead quits: they hand it over before leaving; if their account goes, Today says the team needs a new owner", async () => {
  const o = await org();
  const team = await sql.begin((tx) => createProject(tx, o.s1, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = ${`Team Osprey ${o.tag}`} WHERE id = ${team}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${team}, ${o.s1}, 'owner'), (${team}, ${o.s2}, 'member')`;
  viewerId = o.s1;
  const left = await orgs.leaveOrgAction(o.id);
  assert.deepEqual(left, { success: false, error: "You own 1 workspace here. Transfer or detach it first." });
  const succession = await loadAppModule(() => import("../../src/lib/organizations/succession"));
  const appDb = await loadAppModule(() => import("../../src/lib/db"));
  await appDb.db.transaction((tx) => succession.handOverLedChildWorkspaces(tx, o.s1));
  const today = (await board(o, o.teacher)).today.map((r) => r.label);
  assert.ok(today.includes(`Team Osprey ${o.tag} needs a new owner`), JSON.stringify(today));
});

test("33.7 Two sections in one class: Selected people gets only that section", async () => {
  const o = await org();
  viewerId = o.teacher;
  const made = await assignments.createAssignmentAction({ projectId: o.id, title: `Section A ${o.tag}`, dueDate: inDays(3), publish: true, submissionType: "none", lateRule: "none",
    target: { mode: "people", userIds: [o.s1, o.s2] }, steps: [] });
  assert.ok(made.success);
  const holders = (await sql`SELECT assignee_id FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""} AND deleted_at IS NULL`).map((r) => r.assignee_id);
  assert.deepEqual(holders.sort(), [o.s1, o.s2].sort());
});

test("33.7 Student transfers classes: removed from one and joined to another; their handed-in work stays with the first", async () => {
  const first = await org();
  const second = await org();
  const lab = await assign(first, `Lab ${first.tag}`, inDays(3));
  const open = await assign(second, `Lab ${second.tag}`, inDays(3));
  viewerId = first.s1;
  assert.ok((await assignments.submitAssignmentAction(lab.copyOf(first.s1), { text: "My answer" })).success);
  viewerId = first.teacher;
  assert.ok((await members.removeMembersAction(first.id, [first.s1], { block: false, reason: "Moved to the other section" })).success);
  const [kept] = await sql`SELECT assignee_id, deleted_at FROM tasks WHERE id = ${lab.copyOf(first.s1)}`;
  assert.deepEqual([kept!.assignee_id, kept!.deleted_at], [first.s1, null], "handed-in work stays on the first class's record");
  viewerId = first.s1;
  assert.ok((await orgs.joinOrganizationAction(second.code)).success);
  const got = await sql`SELECT 1 FROM tasks WHERE assignment_id = ${open.masterId} AND assignee_id = ${first.s1} AND deleted_at IS NULL`;
  assert.equal(got.length, 1, "they get the second class's open work");
});

test("33.7 Company with no term: no week line and no term-end prompt; sprints are the rhythm", async () => {
  const o = await org("company");
  await sql`UPDATE workspaces SET term_start = ${day(-30)}, term_end = ${day(5)} WHERE id = ${o.id}`;
  const data = await board(o, o.teacher);
  assert.equal(data.weekLine, null);
  assert.ok(!data.today.some((r) => r.kind === "term_end"));
});

test("33.7 Club meeting monthly: Today is quiet; This week fills up near the event", async () => {
  const o = await org("club");
  const quiet = await board(o, o.teacher);
  assert.deepEqual(quiet.today, []);
  assert.deepEqual(quiet.thisWeek, []);
  await assign(o, `Meetup ${o.tag}`, inDays(3));
  const near = await board(o, o.teacher);
  assert.deepEqual(near.thisWeek.map((r) => r.label), [`Meetup ${o.tag} due`]);
});

test("33.7 Large class, 500 submissions: one grouped row and one queue, not 500 rows", async () => {
  const o = await org();
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date, assignment_settings)
    VALUES (${o.id}, ${`Final ${o.tag}`}, 'assignment', ${o.teacher}, now() - interval '1 day', ${sql.json({ publishedAt: new Date().toISOString(), submissionType: "text", reviewRequired: true, target: { mode: "everyone" } })}) RETURNING id`;
  const people = await sql`WITH u AS (INSERT INTO auth.users (id, email) SELECT gen_random_uuid(), ${`big-${o.tag}-`} || g || '@test.local' FROM generate_series(1, 500) g RETURNING id, email),
    p AS (INSERT INTO profiles (id, email, username, full_name) SELECT id, email, 'b' || substr(replace(id::text, '-', ''), 1, 12), 'Student' FROM u RETURNING id)
    INSERT INTO workspace_members (workspace_id, user_id, role) SELECT ${o.id}, id, 'member' FROM p RETURNING user_id`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id, status, review_status, review_submitted_at, submission)
    SELECT ${o.id}, ${`Final ${o.tag}`}, ${o.teacher}, user_id, ${master!.id}, 'done', 'pending', now() - interval '1 hour', '{"version":1}'::jsonb FROM workspace_members WHERE workspace_id = ${o.id} AND user_id IN ${sql(people.map((p) => p.user_id))}`;
  const reviews = (await board(o, o.ta)).today.filter((r) => r.kind === "review");
  assert.deepEqual(reviews.map((r) => r.label), [`500 submissions to review · Final ${o.tag}`]);
  viewerId = o.ta;
  const queue = await assignments.readReviewQueueAction(o.id);
  // The queue loads the oldest 200 and says how many wait in all, so 500 never arrive at once.
  assert.deepEqual(queue.success ? [queue.rows.filter((r) => r.kind === "copy").length, queue.total] : null, [200, 500]);
});

test("33.7 Owner disappears mid-term: admins keep running it, and after 30 days one can Ask to take over", async () => {
  const o = await org();
  await sql`UPDATE workspace_members SET last_active_here_at = now() - interval '35 days' WHERE workspace_id = ${o.id} AND user_id = ${o.teacher}`;
  await assign(o, `Lab ${o.tag}`, inDays(3));
  viewerId = o.ta;
  assert.ok((await assignments.listAssignmentsAction(o.id)).success, "the TA keeps running the class");
  assert.equal((await lifecycle.askToTakeOverAction(o.id)).success, true);
  assert.equal((await sql`SELECT owner_id FROM workspaces WHERE id = ${o.id}`)[0]!.owner_id, o.teacher, "asking doesn't hand anything over by itself");
});

test("16.12 and 33.7 Term ends with nothing archived: the prompt comes 14 days before and stays after; nothing happens by itself", async () => {
  const o = await org();
  await sql`UPDATE workspaces SET term_start = ${day(-90)}, term_end = ${day(10)} WHERE id = ${o.id}`;
  assert.ok((await board(o, o.teacher)).today.some((r) => r.kind === "term_end" && r.label.startsWith("Term ends")));
  await sql`UPDATE workspaces SET term_end = ${day(-5)} WHERE id = ${o.id}`;
  const after = await board(o, o.teacher);
  assert.ok(after.today.some((r) => r.kind === "term_end" && r.label.startsWith("Term ended")), JSON.stringify(after.today));
  assert.equal((await sql`SELECT status FROM workspaces WHERE id = ${o.id}`)[0]!.status, "active");
});

test("33.7 Teacher wants a final record: Export progress (statuses and dates only), then Archive", async () => {
  const o = await org();
  const lab = await assign(o, `Lab ${o.tag}`, inDays(3));
  viewerId = o.s1;
  assert.ok((await assignments.submitAssignmentAction(lab.copyOf(o.s1), { text: "SECRET ANSWER" })).success);
  viewerId = o.teacher;
  const exported = await members.readProgressExportAction(o.id);
  assert.ok(exported.success, JSON.stringify(exported));
  const csv = exported.success ? exported.rows.map((r) => r.join(",")).join("\n") : "";
  assert.match(csv, new RegExp(`Lab ${o.tag}`));
  assert.doesNotMatch(csv, /SECRET ANSWER/, "never submission content");
  assert.ok((await lifecycle.archiveOrgAction(o.id)).success);
  assert.equal((await sql`SELECT status FROM workspaces WHERE id = ${o.id}`)[0]!.status, "archived");
});

test("16.12 Deleted: removed everywhere; a member's profile keeps the name with no link", async () => {
  const o = await org();
  viewerId = o.teacher;
  const deleted = await lifecycle.deleteOrgAction(o.id, { confirmHandle: `class-${o.tag}`, choices: {} });
  assert.ok(deleted.success, JSON.stringify(deleted));
  viewerId = o.s1;
  assert.equal((await dash.readOrgDashboardAction(o.id)).success, false, "members lose it");
});
