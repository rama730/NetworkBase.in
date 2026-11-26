import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.5a (report 35.6): the lab meeting — its own rotation beside the reading group's; the updates round is optional, opens 2
// days before, shows Away as a word, never takes attendance; Coming up pulls paper deadlines; notices once.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.251" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let mt: typeof import("../../src/app/actions/lab-meeting");
let rg: typeof import("../../src/app/actions/lab-reading-group");
let li: typeof import("../../src/app/actions/lab-library");
let lab: typeof import("../../src/app/actions/lab");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  li = await loadAppModule(() => import("../../src/app/actions/lab-library"));
  rg = await loadAppModule(() => import("../../src/app/actions/lab-reading-group"));
  mt = await loadAppModule(() => import("../../src/app/actions/lab-meeting"));
  lab = await loadAppModule(() => import("../../src/app/actions/lab"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.6 lab meeting: own rotation; optional updates from 2 days before; Away as a word; Coming up; notices once", async () => {
  const [pi, ravi, meera, arjun, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "public" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active', time_zone = 'Asia/Kolkata' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${ravi!}, 'member'), (${org}, ${meera!}, 'member'), (${org}, ${arjun!}, 'member')`;
  await sql`INSERT INTO org_member_away (org_id, user_id, starts_at, ends_at) VALUES (${org}, ${meera!}, now(), now() + interval '9 days')`;
  const ws = await sql.begin((tx) => createProject(tx, ravi!, { visibility: "private" }));
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${ws}`;
  await sql`INSERT INTO tasks (workspace_id, title, item_type, stage, status, type_fields, creator_id, task_number) VALUES
    (${ws}, 'WT ICCV paper', 'paper', 'drafting', 'todo', ${sql.json({ deadline: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), private: false })}, ${ravi!}, 9001),
    (${ws}, 'WT Secret paper', 'paper', 'drafting', 'todo', ${sql.json({ deadline: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), private: true })}, ${ravi!}, 9002)`;

  viewerId = pi!;
  assert.ok((await rg.saveReadingGroupAction(org, { on: true, weekday: 2, time: "16:00", order: [arjun!, ravi!], pickDays: 3 })).success);
  assert.ok((await mt.saveLabMeetingAction(org, { on: true, weekday: 4, time: "11:00", order: [ravi!, meera!, arjun!] })).success);
  const read = await mt.readLabMeetingAction(org);
  assert.ok(read.success && read.upcoming.length === 4);
  assert.equal(read.success ? read.upcoming[0]!.presenter?.id : null, ravi!, "the meeting's own rotation, not the reading group's");
  const rgRead = await rg.readReadingGroupAction(org);
  assert.ok(rgRead.success && rgRead.upcoming.every((s) => !read.success || !read.upcoming.some((m) => m.id === s.id)), "the two never mix");
  assert.ok(read.success && read.comingUp!.papers.some((p) => p.title === "WT ICCV paper") && !read.comingUp!.papers.some((p) => p.title === "WT Secret paper"), "Coming up skips private papers");
  assert.ok(read.success && read.comingUp!.readingGroup, "and shows the next reading group");
  viewerId = outsider!;
  assert.equal((await mt.readLabMeetingAction(org)).success, false);

  // The updates box: opens 2 days before; optional; Away people show as Away.
  const next = read.success ? read.next! : null;
  await sql`UPDATE lab_reading_sessions SET starts_at = now() + interval '3 days' WHERE id = ${next!.id}`;
  viewerId = arjun!;
  assert.match(String((await mt.saveMyUpdateAction(org, next!.id, { sinceLast: "run 7", next: "eval", stuckOn: "" }) as { error?: string }).error), /2 days before/);
  await sql`UPDATE lab_reading_sessions SET starts_at = now() + interval '1 day' WHERE id = ${next!.id}`;
  assert.ok((await mt.saveMyUpdateAction(org, next!.id, { sinceLast: "run 7", next: "eval", stuckOn: "GPU queue" })).success);
  const round = await mt.readLabMeetingAction(org);
  const states = round.success ? Object.fromEntries(round.round.map((r) => [r.id, r.state])) : {};
  assert.equal(states[arjun!], "filled");
  assert.equal(states[meera!], "away");
  assert.equal(states[ravi!], "not_filled");
  assert.ok((await mt.saveMyUpdateAction(org, next!.id, { sinceLast: "", next: "", stuckOn: "" })).success, "an empty block clears it");

  // The talk: its presenter titles it; others can't.
  assert.equal((await mt.saveTalkAction(org, next!.id, { talk: "Not mine", announcements: "" })).success, false);
  viewerId = ravi!;
  assert.ok((await mt.saveTalkAction(org, next!.id, { talk: "Calibrating in the dark", announcements: "ignored for members" })).success);
  const [talk] = await sql`SELECT talk_title, announcements FROM lab_reading_sessions WHERE id = ${next!.id}`;
  assert.equal(talk!.talk_title, "Calibrating in the dark");
  assert.equal(talk!.announcements, "", "announcements are a lead's");

  // Notices: the presenter 7 days ahead and the updates box to members, each once.
  const server = await loadAppModule(() => import("../../src/lib/organizations/lab-reading-group-server"));
  const first = await server.readingGroupNotices(new Date());
  const second = await server.readingGroupNotices(new Date());
  const [box] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE dedupe_key LIKE ${`lab-mtg-updates:${next!.id}:%`}`;
  assert.equal(box!.n, 4, "the updates box notice goes to each member once");
  assert.ok(first.sent >= 2);
  assert.equal(second.sent, 0);
  // No attendance anywhere: the round has no present/absent field.
  assert.ok(round.success && round.round.every((r) => !("present" in r)));
});
