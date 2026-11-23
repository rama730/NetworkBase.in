import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { actAs, actAsOwner, addMember, closeAppDb, createProject, createUser, inRollback, loadAppModule, moduleStubs, sql } from "./_helpers";

// Member settings (docs/superpowers/plans/2026-11-12-member-settings-concept.md, 0114): completing your part, reopening
// it, leaving with Undo, the owner's answer, completing the workspace, and read-only in the app and in SQL alike.
const broadcasts: unknown[] = [];
moduleStubs.set("@/lib/realtime/server-broadcast", { broadcast: async (messages: unknown[]) => { broadcasts.push(...messages); return true; } });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.16" }), cookies: async () => ({ get: () => undefined, getAll: () => [] }) });

let journey: typeof import("../../src/lib/workspaces/member-journey");
let access: typeof import("../../src/lib/data/workspace-access");
let profile: typeof import("../../src/lib/profile/collaboration");
before(async () => {
  profile = await loadAppModule(() => import("../../src/lib/profile/collaboration"));
  journey = await loadAppModule(() => import("../../src/lib/workspaces/member-journey"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function setup() {
  const [owner, member, other] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql.begin(async (tx) => {
    await addMember(tx, ws, owner!, "owner");
    await addMember(tx, ws, member!, "member");
    await addMember(tx, ws, other!, "member");
  });
  // A profile entry with its open stage, as joining makes one.
  const [entry] = await sql`INSERT INTO profile_contributions (profile_id, workspace_id, source, role_kind, started_at)
    VALUES (${member!}, ${ws}, 'membership', 'member', now() - interval '60 days') RETURNING id`;
  await sql`INSERT INTO profile_contribution_stages (contribution_id, profile_id, workspace_id, source, role_kind, started_at)
    VALUES (${entry!.id}, ${member!}, ${ws}, 'membership', 'member', now() - interval '60 days')`;
  const [t1] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, creator_id) VALUES (${ws}, 'Open one', 'todo', ${member!}, ${owner!}) RETURNING id`;
  return { owner: owner!, member: member!, other: other!, ws, entryId: entry!.id as string, taskId: t1!.id as string };
}

test("completing your part: read-only in the app and in SQL, a period, the profile entry Completed, mentions only, an undo", async () => {
  const s = await setup();
  const done = await journey.completePart(s.member, s.ws, s.member, { note: "Built the sign-in", tasks: "keep" });
  assert.equal(done.already, false);
  assert.ok(done.undoId, "an undo record");
  const [m] = await sql`SELECT completed_at, completed_by, completion_note, notification_preferences FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.ok(m!.completed_at);
  assert.equal(m!.completed_by, s.member);
  assert.equal(m!.completion_note, "Built the sign-in");
  assert.equal((m!.notification_preferences as { mode: string }).mode, "custom", "notifications: mentions only");
  const [p] = await sql`SELECT end_reason, note FROM workspace_member_periods WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.equal(p!.end_reason, "completed");
  const [c] = await sql`SELECT ended_at, end_reason, end_note FROM profile_contributions WHERE id = ${s.entryId}`;
  assert.ok(c!.ended_at);
  assert.equal(c!.end_reason, "completed");
  assert.equal(c!.end_note, "Built the sign-in");
  const [{ n: openStages }] = await sql`SELECT count(*)::int AS n FROM profile_contribution_stages WHERE contribution_id = ${s.entryId} AND ended_at IS NULL`;
  assert.equal(openStages, 0, "the open stage closed");
  // The task stays assigned (Keep), but nobody can give them a new one: the app and the database both refuse.
  const [t] = await sql`SELECT assignee_id FROM tasks WHERE id = ${s.taskId}`;
  assert.equal(t!.assignee_id, s.member);
  await assert.rejects(sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, creator_id) VALUES (${s.ws}, 'New', 'todo', ${s.member}, ${s.owner})`, /MEMBER_COMPLETED/);
  // Read-only, with its own reason, in the app's resolver and in SQL.
  const a = await access.getWorkspaceAccessById(s.ws, s.member);
  assert.equal(a.canWrite, false);
  assert.equal(a.writeBlocked, "completed");
  assert.equal(a.memberRole, "viewer", "role checks see a viewer");
  assert.equal(a.member?.actualRole, "member", "the real role is kept");
  const sqlWrite = await inRollback(async (tx) => { await actAs(tx, s.member); const [r] = await tx`SELECT app_private.nb_workspace_can_write(${s.ws}) AS ok`; await actAsOwner(tx); return r!.ok; });
  assert.equal(sqlWrite, false, "SQL agrees: read-only");
  const otherWrite = await inRollback(async (tx) => { await actAs(tx, s.other); const [r] = await tx`SELECT app_private.nb_workspace_can_write(${s.ws}) AS ok`; await actAsOwner(tx); return r!.ok; });
  assert.equal(otherWrite, true, "an active member still writes");
  assert.equal((await access.getWorkspaceAccessById(s.ws, s.other)).canWrite, true, "and the app agrees");
  // Completing again is idempotent.
  assert.equal((await journey.completePart(s.member, s.ws, s.member, {})).already, true);
  // A role change waits until the part is reopened.
  const part = await journey.getMyPart(s.ws, s.member);
  assert.equal(part.status, "completed");
  assert.equal(part.canReopen, true);
  assert.match(part.canDo, /completed/);
});

test("reopening restores write access and starts a new profile stage; the first period stays", async () => {
  const s = await setup();
  await journey.completePart(s.member, s.ws, s.member, { tasks: "keep" });
  await journey.reopenPart(s.member, s.ws);
  const [m] = await sql`SELECT completed_at FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.equal(m!.completed_at, null);
  assert.equal((await access.getWorkspaceAccessById(s.ws, s.member)).canWrite, true);
  const [c] = await sql`SELECT ended_at, end_reason FROM profile_contributions WHERE id = ${s.entryId}`;
  assert.equal(c!.ended_at, null);
  const stages = await sql`SELECT source, ended_at FROM profile_contribution_stages WHERE contribution_id = ${s.entryId} ORDER BY started_at`;
  assert.equal(stages.length, 2, "the first stage closed, a new one opened");
  assert.ok(stages[0]!.ended_at);
  assert.equal(stages[1]!.source, "reopen");
  assert.equal(stages[1]!.ended_at, null);
  const periods = await sql`SELECT end_reason FROM workspace_member_periods WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.equal(periods.length, 1, "the completed period is kept");
  await assert.rejects(journey.reopenPart(s.member, s.ws), /isn't completed/);
});

test("Undo of a completion leaves no trace: no period, the stage open again, tasks and notifications back", async () => {
  const s = await setup();
  const done = await journey.completePart(s.member, s.ws, s.member, { tasks: "give", giveTo: s.other });
  assert.equal((await sql`SELECT assignee_id FROM tasks WHERE id = ${s.taskId}`)[0]!.assignee_id, s.other, "given away");
  const [op] = await sql`SELECT inverse FROM undo_operations WHERE id = ${done.undoId}`;
  await journey.undoMemberJourney(op!.inverse as never, (op!.inverse as { userId: string }).userId);
  const [m] = await sql`SELECT completed_at, notification_preferences FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.equal(m!.completed_at, null);
  assert.equal((m!.notification_preferences as { mode: string }).mode, "inherit");
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_member_periods WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`)[0]!.n, 0);
  assert.equal((await sql`SELECT assignee_id FROM tasks WHERE id = ${s.taskId}`)[0]!.assignee_id, s.member, "moved back");
  const stages = await sql`SELECT ended_at FROM profile_contribution_stages WHERE contribution_id = ${s.entryId}`;
  assert.equal(stages.length, 1, "no new stage");
  assert.equal(stages[0]!.ended_at, null);
});

test("leaving: a snapshot for Undo, a Left period and profile ending; Undo brings the membership and tasks back", async () => {
  const s = await setup();
  const left = await journey.leaveWorkspace(s.member, s.ws, { tasks: "unassign" });
  assert.ok(left.undoId);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`)[0]!.n, 0);
  assert.equal((await sql`SELECT assignee_id FROM tasks WHERE id = ${s.taskId}`)[0]!.assignee_id, null);
  assert.equal((await sql`SELECT end_reason FROM workspace_member_periods WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`)[0]!.end_reason, "left");
  assert.equal((await sql`SELECT end_reason FROM profile_contributions WHERE id = ${s.entryId}`)[0]!.end_reason, "left");
  const [op] = await sql`SELECT inverse FROM undo_operations WHERE id = ${left.undoId}`;
  await journey.undoMemberJourney(op!.inverse as never, (op!.inverse as { userId: string }).userId);
  const [back] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.equal(back!.role, "member");
  assert.equal((await sql`SELECT assignee_id FROM tasks WHERE id = ${s.taskId}`)[0]!.assignee_id, s.member);
  assert.equal((await sql`SELECT ended_at FROM profile_contributions WHERE id = ${s.entryId}`)[0]!.ended_at, null);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_member_periods WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`)[0]!.n, 0);
});

test("leaving after completing keeps Completed on the profile, with its date", async () => {
  const s = await setup();
  await journey.completePart(s.member, s.ws, s.member, { tasks: "keep" });
  const [before] = await sql`SELECT ended_at FROM profile_contributions WHERE id = ${s.entryId}`;
  await journey.leaveWorkspace(s.member, s.ws, { tasks: "unassign" });
  const [after] = await sql`SELECT ended_at, end_reason FROM profile_contributions WHERE id = ${s.entryId}`;
  assert.equal(after!.end_reason, "completed");
  assert.equal(new Date(after!.ended_at).getTime(), new Date(before!.ended_at).getTime(), "the date isn't moved");
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_member_periods WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`)[0]!.n, 1, "no second period");
});

test("the owner completes someone's part, confirms it; admins can't do it to admins; the owner can't complete or leave", async () => {
  const s = await setup();
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${s.ws} AND user_id = ${s.other}`;
  await assert.rejects(journey.completePart(s.other, s.ws, s.owner, {}), /own this workspace/);
  await assert.rejects(journey.leaveWorkspace(s.owner, s.ws, {}), /Transfer ownership first/);
  await journey.completePart(s.owner, s.ws, s.member, { note: "Wrapped up", tasks: "keep" });
  const [m] = await sql`SELECT completed_by FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.equal(m!.completed_by, s.owner);
  await journey.decideCompletion(s.owner, s.ws, s.member, "confirm", null);
  const [c] = await sql`SELECT completion_confirmed_by FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`;
  assert.equal(c!.completion_confirmed_by, s.owner);
  assert.equal((await sql`SELECT confirmed_by FROM workspace_member_periods WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`)[0]!.confirmed_by, s.owner);
  const admin2 = await sql.begin((tx) => createUser(tx));
  await sql.begin((tx) => addMember(tx, s.ws, admin2, "admin"));
  await assert.rejects(journey.completePart(s.other, s.ws, admin2, {}), /Admins can't complete another admin/);
  await assert.rejects(journey.decideCompletion(s.member, s.ws, s.member, "confirm", null), /Only the owner or an admin/);
});

test("completing the workspace completes every active part and the owner's entry; setting it active reopens nobody", async () => {
  const s = await setup();
  const tx = { select: undefined };
  void tx;
  await sql.begin(async () => undefined);
  const { db } = await loadAppModule(() => import("../../src/lib/db"));
  await db.transaction(async (t) => { await journey.completeAllParts(t, s.ws, s.owner); });
  const rows = await sql`SELECT user_id, completed_at, completion_note FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id <> ${s.owner}`;
  assert.ok(rows.every((r) => r.completed_at && r.completion_note === "Workspace completed"));
  assert.equal((await sql`SELECT end_reason FROM profile_contributions WHERE id = ${s.entryId}`)[0]!.end_reason, "workspace_completed");
  const periods = await sql`SELECT end_reason FROM workspace_member_periods WHERE workspace_id = ${s.ws}`;
  assert.equal(periods.length, 2);
  assert.ok(periods.every((p) => p.end_reason === "workspace_completed"));
});

test("your settings: stricter only, agents kept out per request, mute for a while, unknown or locked rules ignored", async () => {
  const s = await setup();
  await assert.rejects(journey.updateMySettings(s.member, s.ws, { hideAgentLabel: true }), /hasn't let members choose/);
  await sql`UPDATE workspaces SET members_choose_labels = true WHERE id = ${s.ws}`;
  const until = new Date(Date.now() + 86_400_000).toISOString();
  const part = await journey.updateMySettings(s.member, s.ws, {
    hideAgentLabel: true, agentsBlocked: true, muteUntil: until,
    notifications: { mode: "custom", rules: { "members.joined": false, "members.role_changed": false, "nope.key": true } },
    viewPrefs: { defaultTab: "tasks", density: "compact" },
  });
  assert.equal(part.settings.hideAgentLabel, true);
  assert.equal(part.settings.agentsBlocked, true);
  assert.equal(part.settings.muteUntil, until);
  assert.deepEqual(part.settings.notifications.rules, { "members.joined": false }, "mandatory and unknown keys are ignored");
  assert.deepEqual(part.settings.viewPrefs, { defaultTab: "tasks", density: "compact" });
  const { workspaceAgentPolicy } = await loadAppModule(() => import("../../src/lib/agents/policy"));
  assert.equal((await workspaceAgentPolicy(s.ws, s.member)).blockedByMember, true);
  assert.equal((await workspaceAgentPolicy(s.ws, s.other)).blockedByMember, false, "only this person's agents");
  await assert.rejects(journey.updateMySettings(s.member, s.ws, { viewPrefs: { defaultTab: "nowhere" } }), /Unknown tab/);
});

test("the wrap-up preview counts open tasks and open work, and changes nothing", async () => {
  const s = await setup();
  const w = await journey.previewWrapUp(s.ws, s.member);
  assert.equal(w.openTasks.count, 1);
  assert.equal(w.openTasks.items[0]!.title, "Open one");
  assert.equal((await sql`SELECT completed_at FROM workspace_members WHERE workspace_id = ${s.ws} AND user_id = ${s.member}`)[0]!.completed_at, null);
});

test("security: only the person, or the owner or admin who did it while still allowed, can undo; reviews only go to someone who can review", async () => {
  const s = await setup();
  // Someone else can't undo your completion or your leave.
  const done = await journey.completePart(s.member, s.ws, s.member, { tasks: "keep" });
  const [op] = await sql`SELECT inverse FROM undo_operations WHERE id = ${done.undoId}`;
  await assert.rejects(journey.undoMemberJourney(op!.inverse as never, s.other), /Only the person/);
  await journey.reopenPart(s.member, s.ws);
  // An admin who completed someone, then lost admin, can't undo it any more.
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${s.ws} AND user_id = ${s.other}`;
  const byAdmin = await journey.completePart(s.other, s.ws, s.member, { tasks: "keep" });
  await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${s.ws} AND user_id = ${s.other}`;
  const [op2] = await sql`SELECT inverse FROM undo_operations WHERE id = ${byAdmin.undoId}`;
  await assert.rejects(journey.undoMemberJourney(op2!.inverse as never, s.other), /Only the owner or an admin/);
  await journey.reopenPart(s.member, s.ws);
  // Reviews can't be handed to a viewer.
  const [viewer] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  await sql.begin((tx) => addMember(tx, s.ws, viewer!, "viewer"));
  await sql`DELETE FROM undo_operations WHERE workspace_id = ${s.ws}`;
  await assert.rejects(journey.completePart(s.member, s.ws, s.member, { tasks: "keep", reviewsTo: viewer! }), /Hand your reviews/);
});

test("profile: the closing note, marked completed by, confirmed by, and the earlier period after a reopen", async () => {
  const s = await setup();
  await journey.completePart(s.owner, s.ws, s.member, { note: "Built the sign-in", tasks: "keep" });
  await journey.decideCompletion(s.owner, s.ws, s.member, "confirm");
  const own = async () => (await profile.getProfileContributions(s.member, { includePrivate: true })).contributions.find((c) => c.projectId === s.ws)!;
  const done = await own();
  assert.equal(done.endReason, "completed");
  assert.equal(done.endNote, "Built the sign-in");
  assert.ok(done.endedByName, "marked completed by the owner");
  assert.ok(done.confirmedByName, "confirmed by");
  assert.deepEqual(done.earlierPeriods, [], "the completed period is the entry itself");
  await journey.reopenPart(s.member, s.ws);
  const back = await own();
  assert.equal(back.currentlyActive, true);
  assert.equal(back.endNote, null);
  assert.equal(back.earlierPeriods?.length, 1);
  assert.equal(back.earlierPeriods?.[0]?.reason, "completed");
  assert.ok(back.currentSince, "the current period's start");
});
