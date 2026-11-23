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
let taskActions: typeof import("../../src/app/actions/task");
let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
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
