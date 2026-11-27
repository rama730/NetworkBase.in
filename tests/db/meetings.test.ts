import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A4.1 (report 38.11 D1): meetings, series, Finish with carried action items, reminders, Open action items.


let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.174" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let docs: typeof import("../../src/app/actions/workspace/doc");
let feed: typeof import("../../src/app/actions/meeting-feed");
let meetingSettings: typeof import("../../src/app/actions/meeting-settings");
let feedRoute: typeof import("../../src/app/api/feeds/meetings/[token]/route");
let taskActions: typeof import("../../src/app/actions/task");
let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
let clubMeetings: typeof import("../../src/app/actions/club-meetings");
let constitution: typeof import("../../src/app/actions/club-constitution");
let motionVotes: typeof import("../../src/app/actions/club-motion-votes");
let clubServer: typeof import("../../src/lib/organizations/club-server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  feed = await loadAppModule(() => import("../../src/app/actions/meeting-feed"));
  meetingSettings = await loadAppModule(() => import("../../src/app/actions/meeting-settings"));
  feedRoute = await loadAppModule(() => import("../../src/app/api/feeds/meetings/[token]/route"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  clubMeetings = await loadAppModule(() => import("../../src/app/actions/club-meetings"));
  constitution = await loadAppModule(() => import("../../src/app/actions/club-constitution"));
  motionVotes = await loadAppModule(() => import("../../src/app/actions/club-motion-votes"));
  clubServer = await loadAppModule(() => import("../../src/lib/organizations/club-server"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true, time_zone = 'Asia/Kolkata' WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'meetings', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const doc = async (slug: string) => {
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', ${slug + ".md"}, ${"/" + slug + ".md"}, ${owner!}) RETURNING id`;
    const [row] = await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${ws}, ${node!.id}, ${slug}, ${slug + ".md"}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })}) RETURNING id`;
    return row!.id as string;
  };
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws, doc };
}
const settingsOf = async (id: string) => (await sql`SELECT settings FROM workspace_documents WHERE id = ${id}`)[0]!.settings;
const ist = (s: string) => new Date(`${s}+05:30`).toISOString();

test("W1, W3: a weekly meeting is filed with its time and attendees (members only), a series, reminders and invites", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("weekly-dec-3");
  const startsAt = ist("2027-01-07T10:00:00");
  const made = await docs.createMeetingAction(t.ws, { docSlug: "weekly-dec-3", type: "blank", title: "Weekly · Jan 7", startsAt, lengthMinutes: 30, attendeeIds: [t.member, t.outsider], repeat: "weekly" });
  assert.ok(made.success && made.seriesId, JSON.stringify(made));
  const s = await settingsOf(id);
  assert.deepEqual([s.section, s.kind, s.date, s.startsAt, s.lengthMinutes, s.attendeeIds], ["meetings", "blank", "2027-01-07", startsAt, 30, [t.member]], "an outsider isn't an attendee");
  const [series] = await sql`SELECT rule, starts_time, attendee_ids FROM workspace_meeting_series WHERE id = ${made.seriesId}`;
  assert.deepEqual([series!.rule, series!.starts_time, series!.attendee_ids], ["weekly", "10:00", [t.member]]);
  const rem = await sql`SELECT user_id, remind_at FROM workspace_document_reminders WHERE doc_id = ${id} AND sent_at IS NULL`;
  assert.deepEqual(rem.map((r) => [r.user_id, new Date(r.remind_at).toISOString()]), [[t.member, ist("2027-01-07T09:45:00")]]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'Invited: Weekly · Jan 7'`)[0]!.n, 1);
  // The reminder fires once, to the attendee.
  await sql`UPDATE workspace_document_reminders SET remind_at = now() - interval '1 minute' WHERE doc_id = ${id}`;
  const fire = await loadAppModule(() => import("../../src/lib/workflows/meeting-reminders"));
  await fire.fireDueDocumentReminders(); await fire.fireDueDocumentReminders();
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'Weekly · Jan 7 starts at 10:00 · Open notes'`)[0]!.n, 1);
  // W11: someone outside the workspace who can read the meeting never sees who attends.
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${t.ws}`;
  viewerId = t.outsider;
  const outside = await docs.readMeetingAction(t.ws, "weekly-dec-3");
  assert.ok(outside.success, JSON.stringify(outside));
  assert.deepEqual([outside.member, outside.attendees], [false, []]);
  // Viewers can't make meetings.
  viewerId = t.viewer;
  await t.doc("viewer-try");
  assert.equal((await docs.createMeetingAction(t.ws, { docSlug: "viewer-try", type: "blank", title: "X", startsAt, lengthMinutes: 30, attendeeIds: [], repeat: "none" }) as { error?: string }).error, "Only people who can edit documents make meetings.");
});

test("W5, W8, W9: Finish carries open action items into the next meeting (the same tasks), once; End the series stops it", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const first = await t.doc("standup-1");
  const startsAt = ist("2027-01-07T10:00:00");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "standup-1", type: "blank", title: "Standup", startsAt, lengthMinutes: 15, attendeeIds: [t.member], repeat: "weekdays" })).success);
  const a = await docs.addDocRowAction(t.ws, { docSlug: "standup-1", blockKey: "actions", title: "Fix the login typo" });
  const b = await docs.addDocRowAction(t.ws, { docSlug: "standup-1", blockKey: "actions", title: "Book the room" });
  assert.ok(a.success && b.success);
  await sql`UPDATE tasks SET status = 'done' WHERE id = ${(b as { id: string }).id}`;
  const list = await docs.readMeetingsAction(t.ws);
  assert.ok(list.success);
  assert.deepEqual(list.openActionItems.map((r) => [r.title, r.meeting?.slug]), [["Fix the login typo", "standup-1"]]);
  const second = await t.doc("standup-2");
  const fin = await docs.finishMeetingAction(t.ws, { docSlug: "standup-1", carryOver: true, nextDocSlug: "standup-2" });
  assert.ok(fin.success && fin.next, JSON.stringify(fin));
  assert.deepEqual([fin.next!.startsAt, fin.next!.carried], [ist("2027-01-08T10:00:00"), 1], "Thursday → Friday at 10:00");
  const s2 = await settingsOf(second);
  assert.deepEqual([s2.section, s2.startsAt, s2.attendeeIds, s2.carriedTaskIds], ["meetings", ist("2027-01-08T10:00:00"), [t.member], [(a as { id: string }).id]]);
  const rows = await docs.readDocRowsAction(t.ws, "standup-2", "actions");
  assert.ok(rows.success);
  assert.deepEqual(rows.rows.map((r) => [r.title, r.carried ?? false]), [["Fix the login typo", true]]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${t.ws} AND title = 'Fix the login typo'`)[0]!.n, 1, "the same task, not a copy");
  assert.ok((await settingsOf(first)).finishedAt);
  const again = await docs.finishMeetingAction(t.ws, { docSlug: "standup-1", carryOver: true, nextDocSlug: "standup-2" });
  assert.ok(again.success && again.alreadyFinished);
  // End the series: finishing the second one makes no third.
  assert.ok((await docs.endSeriesAction(t.ws, { docSlug: "standup-2" })).success);
  await t.doc("standup-3");
  const last = await docs.finishMeetingAction(t.ws, { docSlug: "standup-2", carryOver: true, nextDocSlug: "standup-3" });
  assert.ok(last.success && last.next === null);
});

test("W8: Edit this meeting moves its time and reminders; a finished meeting keeps its time", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("client-call");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "client-call", type: "blank", title: "Client call", startsAt: ist("2027-02-01T15:00:00"), lengthMinutes: 60, attendeeIds: [t.member], repeat: "none" })).success);
  assert.ok((await docs.moveMeetingAction(t.ws, { docSlug: "client-call", startsAt: ist("2027-02-02T11:00:00") })).success);
  assert.deepEqual((await sql`SELECT remind_at FROM workspace_document_reminders WHERE doc_id = ${id} AND sent_at IS NULL`).map((r) => new Date(r.remind_at).toISOString()), [ist("2027-02-02T10:45:00")]);
  assert.equal((await settingsOf(id)).date, "2027-02-02");
  assert.ok((await docs.finishMeetingAction(t.ws, { docSlug: "client-call", carryOver: false })).success);
  assert.equal((await docs.moveMeetingAction(t.ws, { docSlug: "client-call", startsAt: ist("2027-02-03T11:00:00") }) as { error?: string }).error, "A finished meeting keeps its time.");
});

test("security review: the meetings list shows only meetings this person may read", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("board-minutes");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "board-minutes", type: "blank", title: "Board", startsAt: ist("2027-03-01T10:00:00"), lengthMinutes: 60, attendeeIds: [], repeat: "none" })).success);
  assert.ok((await docs.addDocRowAction(t.ws, { docSlug: "board-minutes", blockKey: "actions", title: "Confidential follow-up" })).success);
  await sql`UPDATE workspace_documents SET settings = settings || '{"visibilityOverride":"leaders_only"}'::jsonb WHERE id = ${id}`;
  const own = await docs.readMeetingsAction(t.ws);
  assert.ok(own.success && own.meetings.length === 1 && own.openActionItems.length === 1);
  viewerId = t.member;
  const member = await docs.readMeetingsAction(t.ws);
  assert.ok(member.success);
  assert.deepEqual([member.meetings.length, member.openActionItems.length], [0, 0]);
});

test("A4.1b W10: the .ics feed holds my meetings only (times and titles), honours visibility, and stops", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await t.doc("mine");
  await t.doc("not-mine");
  await t.doc("secret");
  const at = ist("2027-04-05T10:00:00");
  for (const [slug, attendees] of [["mine", [t.member]], ["not-mine", [t.owner]], ["secret", [t.member]]] as const)
    assert.ok((await docs.createMeetingAction(t.ws, { docSlug: slug, type: "blank", title: `Meeting ${slug}`, startsAt: at, lengthMinutes: 45, attendeeIds: [...attendees], repeat: "none" })).success);
  await sql`UPDATE workspace_documents SET settings = settings || '{"visibilityOverride":"leaders_only"}'::jsonb WHERE workspace_id = ${t.ws} AND slug = 'secret'`;
  viewerId = t.member;
  assert.deepEqual(await feed.readMeetingFeedAction(), { success: true, hasLink: false, since: null });
  const made = await feed.newMeetingFeedAction();
  assert.ok(made.success);
  const token = made.path.split("/").pop()!;
  const get = (tok: string) => feedRoute.GET(new Request(`https://x.test/api/feeds/meetings/${tok}`), { params: Promise.resolve({ token: tok }) });
  const res = await get(token);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/calendar/);
  const body = await res.text();
  assert.match(body, /SUMMARY:Meeting mine\r\n/);
  assert.match(body, /DTSTART:20270405T043000Z\r\nDTEND:20270405T051500Z/);
  assert.doesNotMatch(body, /not-mine|secret/, "only meetings I attend, and no leaders-only ones for a member");
  assert.equal((await sql`SELECT count(*)::int AS n FROM meeting_feed_tokens WHERE token_hash = ${token}`)[0]!.n, 0, "only the hash is stored");
  assert.equal((await get("x".repeat(32))).status, 404);
  // A new link stops the old one; Stop ends it.
  const again = await feed.newMeetingFeedAction();
  assert.ok(again.success);
  assert.equal((await get(token)).status, 404);
  assert.ok((await feed.stopMeetingFeedAction()).success);
  assert.equal((await get(again.path.split("/").pop()!)).status, 404);
  // Someone who leaves the workspace gets nothing from it.
  const third = await feed.newMeetingFeedAction();
  assert.ok(third.success);
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${t.ws} AND user_id = ${t.member}`;
  assert.doesNotMatch(await (await get(third.path.split("/").pop()!)).text(), /Meeting mine/);
});

test("A4.1b part 8: My work's meetings today are mine, inside my day", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await t.doc("today-sync");
  await t.doc("tomorrow-sync");
  const now = Date.now();
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "today-sync", type: "blank", title: "Today sync", startsAt: new Date(now + 3_600_000).toISOString(), lengthMinutes: 30, attendeeIds: [t.member], repeat: "none" })).success);
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "tomorrow-sync", type: "blank", title: "Tomorrow sync", startsAt: new Date(now + 30 * 3_600_000).toISOString(), lengthMinutes: 30, attendeeIds: [t.member], repeat: "none" })).success);
  viewerId = t.member;
  const r = await feed.readMyMeetingsTodayAction({ from: new Date(now - 3_600_000).toISOString(), to: new Date(now + 20 * 3_600_000).toISOString() });
  assert.ok(r.success);
  assert.deepEqual(r.meetings.map((m) => m.title), ["Today sync"]);
  assert.equal((await feed.readMyMeetingsTodayAction({ from: "2027-01-01T00:00:00Z", to: "2027-02-01T00:00:00Z" }) as { error?: string }).error, "Pick a day");
});

// Plan A4.2 (report 38.11 W4, W7): status, Supersede (once), Reverse with a reason, and the attendees' notice.
test("W4, W7: a decision from a meeting tells its attendees; Proposed ↔ Decided; Supersede links both ways once; Reverse needs a reason", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await t.doc("weekly");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "weekly", type: "blank", title: "Weekly · Jan 7", startsAt: ist("2027-01-07T10:00:00"), lengthMinutes: 30, attendeeIds: [t.member], repeat: "none" })).success);
  const a = await t.doc("use-postgres");
  const first = await docs.recordDecisionAction(t.ws, { docSlug: "use-postgres", fromDocSlug: "weekly" });
  assert.deepEqual(first, { success: true, number: 1, label: "D-001" });
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'D-001 recorded in Weekly · Jan 7' AND importance = 'more'`)[0]!.n, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.owner} AND title LIKE 'D-001%'`)[0]!.n, 0, "not the person who recorded it");
  // Security review: a decision only leaders can read isn't announced to a member who can't open it.
  const hidden = await t.doc("leaders-only");
  await sql`UPDATE workspace_documents SET settings = settings || '{"visibilityOverride":"leaders_only"}'::jsonb WHERE id = ${hidden}`;
  assert.ok((await docs.recordDecisionAction(t.ws, { docSlug: "leaders-only", fromDocSlug: "weekly" })).success);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'D-002 recorded in Weekly · Jan 7'`)[0]!.n, 0);

  // Proposed ↔ Decided, editors only.
  assert.ok((await docs.setDecisionStatusAction(t.ws, { docSlug: "use-postgres", status: "proposed" })).success);
  assert.equal((await settingsOf(a)).decisionStatus, "proposed");
  viewerId = t.viewer;
  assert.equal((await docs.setDecisionStatusAction(t.ws, { docSlug: "use-postgres", status: "decided" }) as { error?: string }).error, "Only people who can edit this decision change its status.");
  assert.equal((await docs.reverseDecisionAction(t.ws, { docSlug: "use-postgres", reason: "x" }) as { error?: string }).error, "Only people who can edit this decision reverse it.");
  viewerId = t.owner;

  // Supersede: the new one says what it replaces, the old one says what replaced it.
  const b = await t.doc("use-sqlite");
  assert.deepEqual(await docs.recordDecisionAction(t.ws, { docSlug: "use-sqlite", supersedesSlug: "use-postgres" }), { success: true, number: 3, label: "D-003" });
  const [sa, sb] = [await settingsOf(a), await settingsOf(b)];
  assert.deepEqual([sa.decisionStatus, sa.supersededBy, sb.decisionStatus, sb.supersedes], ["superseded", b, "decided", a]);
  const listed = await docs.listWorkspaceDocsAction(t.ws);
  assert.ok(listed.success);
  assert.deepEqual(listed.docs.filter((d) => d.decisionNumber && d.decisionNumber !== 2).map((d) => [d.decisionNumber, d.decisionStatus, d.supersededBy ?? null, d.supersedes ?? null]).sort(), [[1, "superseded", b, null], [3, "decided", null, a]]);
  // Only once, and a superseded decision keeps its status.
  await t.doc("use-mysql");
  assert.equal((await docs.recordDecisionAction(t.ws, { docSlug: "use-mysql", supersedesSlug: "use-postgres" }) as { error?: string }).error, "That decision was already superseded or reversed.");
  assert.equal((await docs.setDecisionStatusAction(t.ws, { docSlug: "use-postgres", status: "decided" }) as { error?: string }).error, "A superseded or reversed decision keeps its status.");

  // Reverse asks a reason; then it's Reversed with it, once.
  assert.equal((await docs.reverseDecisionAction(t.ws, { docSlug: "use-sqlite", reason: "  " }) as { error?: string }).error, "Say why it's reversed.");
  assert.ok((await docs.reverseDecisionAction(t.ws, { docSlug: "use-sqlite", reason: "Too slow at 10k rows" })).success);
  const rb = await settingsOf(b);
  assert.deepEqual([rb.decisionStatus, rb.reverseReason, rb.decisionNumber], ["reversed", "Too slow at 10k rows", 3]);
  assert.equal((await docs.reverseDecisionAction(t.ws, { docSlug: "use-sqlite", reason: "again" }) as { error?: string }).error, "That decision was already superseded or reversed.");
  assert.equal((await docs.reverseDecisionAction(t.ws, { docSlug: "use-postgres", reason: "x" }) as { error?: string }).error, "That decision was already superseded or reversed.");
});

// Plan A4.9 (report 38.11 W6, call 6): motions, votes within those present, quorum, the decision, approved minutes lock.
test("W6: a board meeting's motion needs quorum and votes within those present; a pass records its decision once; approved minutes refuse changes and file edits", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await sql`UPDATE workspaces SET category = 'nonprofit' WHERE id = ${t.ws}`; // Board meeting is on by default here (A4.16)
  const first = await t.doc("board-1");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "board-1", type: "board", title: "Board · Jan 7", startsAt: ist("2027-01-07T10:00:00"), lengthMinutes: 60, attendeeIds: [t.owner, t.member, t.viewer], repeat: "monthly", boardSize: 3 })).success);
  assert.equal((await settingsOf(first)).boardSize, 3);

  assert.equal((await docs.addMotionAction(t.ws, { docSlug: "board-1", text: "Approve the budget", proposedBy: t.outsider }) as { error?: string }).error, "Pick people who attend this meeting.");
  const added = await docs.addMotionAction(t.ws, { docSlug: "board-1", text: "Approve the budget", proposedBy: t.owner, secondedBy: t.member });
  assert.ok(added.success);
  const motionId = added.motionId;
  const vote = (v: { for: number; against: number; abstain: number }) => docs.recordVoteAction(t.ws, { docSlug: "board-1", motionId, ...v }) as Promise<{ success: boolean; error?: string; result?: string }>;
  assert.equal((await vote({ for: 1, against: 0, abstain: 0 })).error, "Not quorate: 0 present, 2 needed.");
  assert.deepEqual(await docs.markPresentAction(t.ws, { docSlug: "board-1", present: [t.owner, t.member, t.outsider] }), { success: true, present: [t.owner, t.member] });
  assert.equal((await vote({ for: 2, against: 0, abstain: 1 })).error, "The votes add up to more than the 2 present.");
  assert.deepEqual(await vote({ for: 2, against: 0, abstain: 0 }), { success: true, result: "passed" });
  assert.equal((await vote({ for: 0, against: 2, abstain: 0 })).error, "This motion was already voted on.");

  // The passed motion records a Decided decision from this meeting, once.
  await t.doc("approve-the-budget");
  assert.deepEqual(await docs.recordDecisionAction(t.ws, { docSlug: "approve-the-budget", fromDocSlug: "board-1", motionId }), { success: true, number: 1, label: "D-001" });
  const read = await docs.readMeetingAction(t.ws, "board-1");
  assert.ok(read.success && "board" in read && read.board);
  assert.deepEqual(read.board.motions.map((m) => [m.result, m.votes, m.decision?.label]), [["passed", { for: 2, against: 0, abstain: 0 }, "D-001"]]);
  await t.doc("again");
  assert.equal((await docs.recordDecisionAction(t.ws, { docSlug: "again", fromDocSlug: "board-1", motionId }) as { error?: string }).error, "Only a passed motion without a decision gets one.");

  // Viewers can't record anything.
  viewerId = t.viewer;
  assert.equal((await docs.addMotionAction(t.ws, { docSlug: "board-1", text: "x" }) as { error?: string }).error, "Only people who can edit this meeting record motions and votes.");
  viewerId = t.owner;

  // The next meeting (Finish) keeps the board size; there it approves the last minutes, which then can't change.
  await t.doc("board-2");
  assert.ok((await docs.finishMeetingAction(t.ws, { docSlug: "board-1", carryOver: false, nextDocSlug: "board-2", nextTitle: "Board · Feb 7" })).success);
  const second = (await sql`SELECT id FROM workspace_documents WHERE workspace_id = ${t.ws} AND slug = 'board-2'`)[0]!.id as string;
  assert.equal((await settingsOf(second)).boardSize, 3);
  const nextRead = await docs.readMeetingAction(t.ws, "board-2");
  assert.ok(nextRead.success && "board" in nextRead && nextRead.board);
  assert.deepEqual(nextRead.board.toApprove, { slug: "board-1", title: "Board · Jan 7" });
  const approved = await docs.approveMinutesAction(t.ws, { docSlug: "board-2" });
  assert.ok(approved.success && approved.approvedSlug === "board-1");
  assert.ok((await settingsOf(first)).approvedAt);
  assert.equal((await docs.approveMinutesAction(t.ws, { docSlug: "board-2" }) as { error?: string }).error, "Those minutes are already approved.");
  assert.equal((await docs.addMotionAction(t.ws, { docSlug: "board-1", text: "Late change" }) as { error?: string }).error, "These minutes are approved and can't change.");
  // Security review: the approved minutes can't be unlinked (dropping the lock), moved or re-filed as a new meeting.
  assert.equal((await docs.unlinkWorkspaceDocAction(t.ws, "board-1") as { error?: string }).error, "Approved minutes stay in Documents.");
  assert.equal((await docs.moveMeetingAction(t.ws, { docSlug: "board-1", startsAt: ist("2027-01-09T10:00:00") })).success, false);
  assert.equal((await docs.createMeetingAction(t.ws, { docSlug: "board-1", type: "board", title: "Again", startsAt: ist("2027-01-09T10:00:00"), lengthMinutes: 60, attendeeIds: [], repeat: "none" }) as { error?: string }).error, "That document is already a meeting.");
  assert.ok((await settingsOf(first)).approvedAt);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'Minutes approved: Board · Jan 7'`)[0]!.n, 1);
  // File writes refuse the approved minutes' file (every client goes through these checks).
  const lock = await loadAppModule(() => import("../../src/lib/workspaces/minutes-lock"));
  const node = (await sql`SELECT linked_node_id FROM workspace_documents WHERE id = ${first}`)[0]!.linked_node_id as string;
  assert.match((await lock.approvedMinutesRefusal(t.ws, node))!, /^These minutes were approved on \d+ \w+ and can’t be edited\.$/);
  await assert.rejects(lock.assertMinutesEditable(t.ws, node), /approved/);
  // Live check (0117): the database refuses any new version or version switch, whichever path writes it.
  await assert.rejects(sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type) VALUES (${node}, 99, 'x', 1, 'text/markdown')`, /MINUTES_APPROVED/);
  await assert.rejects(sql`UPDATE workspace_nodes SET current_version = coalesce(current_version, 0) + 1 WHERE id = ${node}`, /MINUTES_APPROVED/);
  // Security review (0118): the document and file can't be unlinked, re-pointed, unapproved, trashed or deleted either.
  await assert.rejects(sql`UPDATE workspace_documents SET linked_node_id = NULL WHERE id = ${first}`, /MINUTES_APPROVED/);
  await assert.rejects(sql`UPDATE workspace_documents SET settings = settings - 'approvedAt' WHERE id = ${first}`, /MINUTES_APPROVED/);
  await assert.rejects(sql`DELETE FROM workspace_documents WHERE id = ${first}`, /MINUTES_APPROVED/);
  await assert.rejects(sql`UPDATE workspace_nodes SET deleted_at = now() WHERE id = ${node}`, /MINUTES_APPROVED/);
  await assert.rejects(sql`DELETE FROM workspace_nodes WHERE id = ${node}`, /MINUTES_APPROVED/);
  const otherNode = (await sql`SELECT linked_node_id FROM workspace_documents WHERE id = ${second}`)[0]!.linked_node_id as string;
  assert.equal(await lock.approvedMinutesRefusal(t.ws, otherNode), null);
  await sql`UPDATE workspace_nodes SET current_version = coalesce(current_version, 0) WHERE id = ${otherNode}`; // unapproved files still change
});

// Plan A4.16 (report 38.11 S8, call 5): Settings → Meetings.
test("S8: types follow the category until an owner or admin sets them; a switched-off type is refused; the reminder minutes apply", async () => {
  const t = await workspace();
  await sql`UPDATE workspaces SET category = 'game' WHERE id = ${t.ws}`;
  viewerId = t.member;
  const read = await meetingSettings.readMeetingSettingsAction(t.ws);
  assert.ok(read.success);
  assert.deepEqual([read.settings.types.includes("playtest"), read.settings.types.includes("board"), read.canManage], [true, false, false]);
  assert.equal((await meetingSettings.setMeetingSettingsAction(t.ws, { types: ["weekly"], lengthMinutes: 45, reminderMinutes: 30 }) as { error?: string }).error, "Only owners and admins change meeting settings.");
  viewerId = t.owner;
  assert.ok((await meetingSettings.setMeetingSettingsAction(t.ws, { types: ["weekly"], lengthMinutes: 45, reminderMinutes: 30 })).success);
  const list = await docs.readMeetingsAction(t.ws);
  assert.ok(list.success);
  assert.deepEqual(list.settings, { types: ["weekly", "blank"], lengthMinutes: 45, reminderMinutes: 30 });
  await t.doc("play-1");
  assert.equal((await docs.createMeetingAction(t.ws, { docSlug: "play-1", type: "playtest", title: "Playtest", startsAt: ist("2027-01-07T10:00:00"), lengthMinutes: 30, attendeeIds: [t.member], repeat: "none" }) as { error?: string }).error,
    "That meeting type is switched off in Settings → Meetings.");
  const id = await t.doc("weekly-1");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "weekly-1", type: "weekly", title: "Weekly", startsAt: ist("2027-01-07T10:00:00"), lengthMinutes: 45, attendeeIds: [t.member], repeat: "none" })).success);
  const rem = await sql`SELECT remind_at FROM workspace_document_reminders WHERE doc_id = ${id}`;
  assert.deepEqual(rem.map((r) => new Date(r.remind_at).toISOString()), [ist("2027-01-07T09:30:00")], "30 minutes before");
  // Reminders off: none scheduled.
  assert.ok((await meetingSettings.setMeetingSettingsAction(t.ws, { types: ["weekly"], lengthMinutes: 45, reminderMinutes: 0 })).success);
  const id2 = await t.doc("weekly-2");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "weekly-2", type: "weekly", title: "Weekly 2", startsAt: ist("2027-01-08T10:00:00"), lengthMinutes: 45, attendeeIds: [t.member], repeat: "none" })).success);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_document_reminders WHERE doc_id = ${id2}`)[0]!.n, 0);
});

test("review: finishing a series meeting without naming the next file never files the README as the next meeting", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const readme = await t.doc("readme");
  await t.doc("weekly-x");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "weekly-x", type: "blank", title: "Weekly", startsAt: ist("2027-01-07T10:00:00"), lengthMinutes: 30, attendeeIds: [], repeat: "weekly" })).success);
  assert.ok((await docs.finishMeetingAction(t.ws, { docSlug: "weekly-x", carryOver: false })).success);
  assert.equal((await settingsOf(readme)).section, undefined);
});

// Plan B7.3a (report 36.4 calls 1–3, 5): a club's general meetings.
test("36.4 (B7.3a): club minutes stay with officers until approved; quorum is the club's share of members staying; a motion needs a seconder; members add to the agenda until the deadline", async () => {
  const t = await workspace();
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active', org_settings = ${sql.json({ club: { meetings: { agendaDays: 3, propose: true, quorumShare: 1 } } })} WHERE id = ${t.ws}`;
  viewerId = t.owner;
  const first = await t.doc("general-1");
  await sql`DELETE FROM workspace_workflows WHERE workspace_id = ${t.ws}`; // a club holds its meetings without the workflow
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "general-1", type: "general", title: "General · Jan 7", startsAt: ist("2027-01-07T18:00:00"), lengthMinutes: 60, attendeeIds: [t.owner, t.member], repeat: "monthly" })).success);
  assert.equal((await settingsOf(first)).visibilityOverride, "leaders_only", "the draft minutes start with officers");
  viewerId = t.member;
  assert.equal((await docs.readMeetingAction(t.ws, "general-1")).success, false, "draft minutes never reach members");
  viewerId = t.owner;
  const read = await docs.readMeetingAction(t.ws, "general-1");
  assert.ok(read.success && "board" in read && read.board && read.board.needed === 2 && read.board.motionsOn, "quorum: all 2 members staying (share 100%)");

  const bare = await docs.addMotionAction(t.ws, { docSlug: "general-1", text: "Weekend lab hours", proposedBy: t.member });
  assert.ok(bare.success);
  await docs.markPresentAction(t.ws, { docSlug: "general-1", present: [t.owner] });
  assert.equal((await docs.recordVoteAction(t.ws, { docSlug: "general-1", motionId: bare.motionId, for: 1, against: 0, abstain: 0 }) as { error?: string }).error, "A motion needs a seconder before the vote.");
  const moved = await docs.addMotionAction(t.ws, { docSlug: "general-1", text: "Two competitions this year", proposedBy: t.member, secondedBy: t.owner });
  assert.ok(moved.success);
  assert.equal((await docs.recordVoteAction(t.ws, { docSlug: "general-1", motionId: moved.motionId, for: 1, against: 0, abstain: 0 }) as { error?: string }).error, "Not quorate: 1 present, 2 needed.", "not quorate: the motion can't pass");
  await docs.markPresentAction(t.ws, { docSlug: "general-1", present: [t.owner, t.member] });
  assert.deepEqual(await docs.recordVoteAction(t.ws, { docSlug: "general-1", motionId: moved.motionId, for: 2, against: 0, abstain: 0 }), { success: true, result: "passed" });

  // The next meeting approves the last minutes: they lock and open to members.
  const second = await t.doc("general-2");
  assert.ok((await docs.finishMeetingAction(t.ws, { docSlug: "general-1", carryOver: false, nextDocSlug: "general-2", nextTitle: "General · Feb 7" })).success);
  assert.equal((await settingsOf(second)).visibilityOverride, "leaders_only");
  assert.ok((await docs.approveMinutesAction(t.ws, { docSlug: "general-2" })).success);
  const approved = await settingsOf(first);
  assert.ok(approved.approvedAt && approved.visibilityOverride === "members_only");
  viewerId = t.member;
  assert.ok((await docs.readMeetingAction(t.ws, "general-1")).success, "approved minutes reach members");
  assert.equal((await docs.readMeetingAction(t.ws, "general-2")).success, false);

  // Agenda requests for the next general meeting (February).
  const m = await clubMeetings.readClubMeetingAction(t.ws);
  assert.ok(m.success && m.meeting && m.meeting.title === "General · Feb 7" && m.meeting.canPropose && m.quorum.needed === 2);
  for (const title of ["Weekend lab hours", "Robocon budget", "New logo"]) assert.ok((await clubMeetings.proposeAgendaItemAction(t.ws, m.meeting.id, title)).success);
  assert.match(String((await clubMeetings.proposeAgendaItemAction(t.ws, m.meeting.id, "One more") as { error?: string }).error), /3 items waiting/);
  assert.equal((await clubMeetings.decideAgendaItemAction(t.ws, (await sql`SELECT id FROM club_agenda_requests WHERE title = 'New logo' AND org_id = ${t.ws}`)[0]!.id as string, true)).success, false, "members don't decide");
  viewerId = t.viewer;
  assert.equal((await clubMeetings.proposeAgendaItemAction(t.ws, m.meeting.id, "Viewer item")).success, false, "Viewers don't propose");
  viewerId = t.owner;
  const officer = await clubMeetings.readClubMeetingAction(t.ws);
  assert.ok(officer.success && officer.requests.length === 3 && officer.requests.every((r) => r.state === "proposed"));
  assert.ok((await clubMeetings.decideAgendaItemAction(t.ws, officer.requests[0]!.id, true)).success);
  assert.ok((await clubMeetings.decideAgendaItemAction(t.ws, officer.requests[1]!.id, false)).success);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title LIKE 'Your agenda item was %'`)[0]!.n, 2);
  // The deadline: within 3 days of the meeting the agenda is closed.
  await sql`UPDATE workspace_documents SET settings = jsonb_set(settings, '{startsAt}', to_jsonb((now() + interval '2 days')::text)) WHERE id = ${second}`;
  viewerId = t.member;
  assert.match(String((await clubMeetings.proposeAgendaItemAction(t.ws, m.meeting.id, "Late item") as { error?: string }).error), /agenda for this meeting has closed/);
});

// Plan B7.3b (report 36.4 calls 7–8): the constitution changes only by a motion at the threshold; Decisions by Season.
test("36.4 (B7.3b): the constitution's first version by the President, then only by an amendment motion passed by two-thirds; Decisions by Season", async () => {
  const t = await workspace();
  await sql`DELETE FROM workspace_workflows WHERE workspace_id = ${t.ws}`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active', visibility = 'public', org_settings = ${sql.json({ club: { committee: { season: "2026–27", positions: [{ id: "president", label: "President", filled: "election", gives: "president", docId: null }] } } })} WHERE id = ${t.ws}`;
  const { STARTER_ARTICLES } = await import("../../src/lib/organizations/club");
  viewerId = t.member;
  assert.equal((await constitution.writeConstitutionAction(t.ws, STARTER_ARTICLES)).success, false, "the President writes the first version");
  viewerId = t.owner;
  assert.ok((await constitution.writeConstitutionAction(t.ws, STARTER_ARTICLES)).success);
  assert.match(String((await constitution.writeConstitutionAction(t.ws, STARTER_ARTICLES) as { error?: string }).error), /only by a motion/, "after that, only by a motion");
  viewerId = t.outsider;
  assert.equal((await constitution.readConstitutionAction(t.ws)).success, false, "visitors read it only when public");
  viewerId = t.owner;
  assert.ok((await constitution.setConstitutionPublicAction(t.ws, true)).success);
  viewerId = t.outsider;
  const pub = await constitution.readConstitutionAction(t.ws);
  assert.ok(pub.success && pub.version === 1 && pub.articles.length === 6 && pub.history[0]!.meeting === null);

  viewerId = t.owner;
  await t.doc("agm-1");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "agm-1", type: "agm", title: "AGM 2027", startsAt: ist("2027-03-01T18:00:00"), lengthMinutes: 90, attendeeIds: [t.owner, t.member], repeat: "none" })).success);
  const read = await docs.readMeetingAction(t.ws, "agm-1");
  assert.ok(read.success && "board" in read && read.board?.amendments?.version === 1 && Math.abs(read.board.amendments.threshold - 2 / 3) < 1e-9);
  assert.match(String((await docs.addMotionAction(t.ws, { docSlug: "agm-1", text: "Drop article 9", proposedBy: t.member, secondedBy: t.owner, amendment: { article: "9", text: null } }) as { error?: string }).error), /doesn't fit/);
  const close = await docs.addMotionAction(t.ws, { docSlug: "agm-1", text: "Add a Tech officer", proposedBy: t.member, secondedBy: t.owner, amendment: { article: "4.1", title: "Tech officer", text: "A Tech officer looks after the club's tools." } });
  const plain = await docs.addMotionAction(t.ws, { docSlug: "agm-1", text: "Add a Tech officer, again", proposedBy: t.member, secondedBy: t.owner, amendment: { article: "4.1", title: "Tech officer", text: "A Tech officer looks after the club's tools." } });
  assert.ok(close.success && plain.success);
  await docs.markPresentAction(t.ws, { docSlug: "agm-1", present: [t.owner, t.member] });
  assert.deepEqual(await docs.recordVoteAction(t.ws, { docSlug: "agm-1", motionId: close.motionId, for: 1, against: 1, abstain: 0 }), { success: true, result: "failed" }, "a majority isn't two-thirds");
  assert.equal((await constitution.readConstitutionAction(t.ws) as { version?: number }).version, 1, "a failed change keeps the current version");
  assert.deepEqual(await docs.recordVoteAction(t.ws, { docSlug: "agm-1", motionId: plain.motionId, for: 2, against: 0, abstain: 0 }), { success: true, result: "passed" });
  const after = await constitution.readConstitutionAction(t.ws);
  assert.ok(after.success && after.version === 2 && after.articles.map((a) => a.n).includes("4.1"));
  assert.deepEqual([after.history[0]!.changed, after.history[0]!.meeting], ["Article 4.1 added", "AGM 2027"]);
  const [v2] = await sql`SELECT doc_id, motion_id, season FROM club_constitution_versions WHERE org_id = ${t.ws} AND version = 2`;
  assert.equal(v2!.motion_id, plain.motionId);
  assert.equal(v2!.season, "2026–27");
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title LIKE '%constitution changed: Article 4.1 added (version 2)'`)[0]!.n, 1);

  // The passed motion's decision keeps the Season; Decisions by Season shows it, the new version and the failed attempt.
  await t.doc("tech-officer");
  assert.ok((await docs.recordDecisionAction(t.ws, { docSlug: "tech-officer", fromDocSlug: "agm-1", motionId: plain.motionId })).success);
  const dec = await constitution.readDecisionsAction(t.ws);
  assert.ok(dec.success);
  const season = dec.seasons.find((x) => x.season === "2026–27")!;
  assert.deepEqual(season.entries.map((e) => e.kind).sort(), ["constitution", "decision"]);
  assert.ok(dec.seasons.some((x) => x.entries.some((e) => e.kind === "attempt" && e.title.includes("Article 4.1"))), "officers see the failed attempt");
  viewerId = t.member;
  const mine = await constitution.readDecisionsAction(t.ws);
  assert.ok(mine.success && !mine.seasons.some((x) => x.entries.some((e) => e.kind === "attempt")), "members see attempts once the minutes are approved");
});

// Plan B7.3c (report 36.4 call 4): an online motion vote is a secret ballot that closes at its time.
test("36.4 (B7.3c): an online vote — ballots never name a voter, one vote, closes only at its time, quorum fixed at the start, a passed amendment publishes", async () => {
  const t = await workspace();
  const [third, fourth] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  await sql`DELETE FROM workspace_workflows WHERE workspace_id = ${t.ws}`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active', org_settings = ${sql.json({ club: { meetings: { agendaDays: 3, propose: true, quorumShare: 0.5 } } })} WHERE id = ${t.ws}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${t.ws}, ${third!}, 'member'), (${t.ws}, ${fourth!}, 'member')`;
  const cols = async (n: string) => (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${n}`).map((c) => String(c.column_name)).sort();
  assert.deepEqual(await cols("club_motion_ballots"), ["choice", "id", "vote_id"], "a ballot never names its voter");
  assert.deepEqual(await cols("club_motion_voted"), ["user_id", "vote_id"], "the voted record never holds a choice");

  viewerId = t.owner;
  const { STARTER_ARTICLES } = await import("../../src/lib/organizations/club");
  assert.ok((await constitution.writeConstitutionAction(t.ws, STARTER_ARTICLES)).success);
  await t.doc("general-x");
  assert.ok((await docs.createMeetingAction(t.ws, { docSlug: "general-x", type: "general", title: "General · Nov", startsAt: ist("2027-11-01T18:00:00"), lengthMinutes: 60, attendeeIds: [t.owner, t.member], repeat: "none" })).success);
  const bare = await docs.addMotionAction(t.ws, { docSlug: "general-x", text: "Unseconded", proposedBy: t.member });
  const amend = await docs.addMotionAction(t.ws, { docSlug: "general-x", text: "Weekend lab hours", proposedBy: t.member, secondedBy: t.owner, amendment: { article: "5.1", title: "Lab hours", text: "The lab opens on weekends." } });
  assert.ok(bare.success && amend.success);
  const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
  assert.match(String((await motionVotes.sendMotionToVoteAction(t.ws, "general-x", bare.motionId, soon) as { error?: string }).error), /seconder/);
  assert.match(String((await motionVotes.sendMotionToVoteAction(t.ws, "general-x", amend.motionId, new Date(Date.now() + 60_000).toISOString()) as { error?: string }).error), /between an hour and 30 days/);
  viewerId = t.member;
  assert.equal((await motionVotes.sendMotionToVoteAction(t.ws, "general-x", amend.motionId, soon)).success, false, "officers send motions to a vote");
  viewerId = t.owner;
  const sent = await motionVotes.sendMotionToVoteAction(t.ws, "general-x", amend.motionId, soon);
  assert.ok(sent.success);
  assert.equal((await docs.recordVoteAction(t.ws, { docSlug: "general-x", motionId: amend.motionId, for: 1, against: 0, abstain: 0 }) as { error?: string }).error, "This motion is being voted on online.");
  const [v] = await sql`SELECT needed, eligible, threshold::float AS threshold FROM club_motion_votes WHERE id = ${sent.id}`;
  assert.deepEqual({ ...v }, { needed: 2, eligible: 4, threshold: 2 / 3 }, "quorum fixed at the start: half of 4 staying");

  for (const [who, choice] of [[t.owner, "for"], [t.member, "for"], [third!, "against"]] as const) { viewerId = who; assert.ok((await motionVotes.castMotionVoteAction(t.ws, sent.id, choice)).success); }
  viewerId = t.member;
  assert.match(String((await motionVotes.castMotionVoteAction(t.ws, sent.id, "against") as { error?: string }).error), /voted on this motion/, "one vote");
  viewerId = t.viewer;
  assert.equal((await motionVotes.castMotionVoteAction(t.ws, sent.id, "for")).success, false, "Viewers don't vote");
  viewerId = fourth!;
  const open = await motionVotes.readMotionVotesAction(t.ws);
  assert.ok(open.success && open.votes[0]!.open && open.votes[0]!.turnout === 3 && !open.votes[0]!.voted && open.votes[0]!.result === null, "turnout as a count; no result before it closes");
  assert.equal((await clubServer.closeMotionVotes(new Date())).closed, 0, "it closes only at its time");
  await sql`UPDATE club_motion_votes SET closes_at = now() - interval '1 minute' WHERE id = ${sent.id}`;
  assert.match(String((await motionVotes.castMotionVoteAction(t.ws, sent.id, "for") as { error?: string }).error), /closed/, "late ballots aren't counted");
  const closed = await motionVotes.readMotionVotesAction(t.ws);
  assert.ok(closed.success && !closed.votes[0]!.open);
  assert.deepEqual(closed.votes[0]!.result, { for: 2, against: 1, abstain: 0, result: "passed" }, "two-thirds of those voting");
  const c = await constitution.readConstitutionAction(t.ws);
  assert.ok(c.success && c.version === 2 && c.articles.some((a) => a.n === "5.1"), "the passed amendment publishes the next version");
  const [counts] = await sql`SELECT (SELECT count(*)::int FROM club_motion_ballots WHERE vote_id = ${sent.id}) AS ballots, (SELECT count(*)::int FROM club_motion_voted WHERE vote_id = ${sent.id}) AS voted`;
  assert.deepEqual({ ...counts }, { ballots: 3, voted: 3 });
  viewerId = t.owner;
  const panel = await docs.readMeetingAction(t.ws, "general-x");
  assert.ok(panel.success && "board" in panel && panel.board?.motions.find((m) => m.id === amend.motionId)?.online?.result?.result === "passed");
});

