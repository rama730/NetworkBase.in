import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.3a (report 34.4, M3): events with Going · Can't go, a place limit and a first-come waitlist; links only for Going;
// visitors join first; private RSVPs never named to members.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.241" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let ev: typeof import("../../src/app/actions/community-events");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  ev = await loadAppModule(() => import("../../src/app/actions/community-events"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const soon = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const fields = (over: Record<string, unknown> = {}) => ({ kind: "community", start: soon(48), end: soon(50), format: "hybrid", place: "HSR Layout", who: "public", hosts: [], runOfShow: [{ time: "19:00", title: "Hello" }], ...over });

test("34.4 calls 1–4: Going until full, then the waitlist moves up in order; links only for Going; visitors join first; private RSVPs unnamed", async () => {
  const [owner, a, b, c, d, viewer, visitor] = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${a!}, 'member'), (${org}, ${b!}, 'member'), (${org}, ${c!}, 'member'), (${org}, ${d!}, 'member'), (${org}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;

  viewerId = a!;
  assert.equal((await ev.saveCommunityEventAction(org, null, { title: "Hack night", description: null, fields: fields(), link: "https://meet.example/x", placeLimit: 2 })).success, false, "members without the Host label don't create");
  viewerId = owner!;
  const made = await ev.saveCommunityEventAction(org, null, { title: "Hack night", description: "Bring a laptop", fields: fields(), link: "https://meet.example/x", placeLimit: 2 });
  assert.ok(made.success, JSON.stringify(made));
  const id = made.id;
  const [item] = await sql`SELECT item_type, on_board, type_fields FROM tasks WHERE id = ${id}`;
  assert.equal(item!.item_type, "event");
  assert.equal(JSON.stringify(item!.type_fields).includes("meet.example"), false, "the link never sits on the item");

  for (const [who, priv] of [[a, true], [b, false], [c, false], [d, false]] as const) { viewerId = who!; await ev.rsvpCommunityEventAction(org, id, { choice: "going", private: priv }); }
  const states = Object.fromEntries((await sql`SELECT user_id, state FROM community_rsvps WHERE task_id = ${id}`).map((r) => [r.user_id, r.state]));
  assert.deepEqual([states[a!], states[b!], states[c!], states[d!]], ["going", "going", "waitlisted", "waitlisted"]);

  viewerId = c!;
  let page = await ev.readCommunityEventAction(org, id);
  assert.ok(page.success);
  assert.equal(page.event.link, null, "waitlisted: no link");
  assert.equal(page.event.position, 1);
  assert.deepEqual(page.people.map((p) => p.id), [b!], "the private RSVP is counted, not named");
  assert.equal(page.event.going, 2);
  viewerId = b!;
  page = await ev.readCommunityEventAction(org, id);
  assert.ok(page.success && page.event.link === "https://meet.example/x", "Going: the link");

  // Can't go frees the place: the first on the waitlist moves up.
  await ev.rsvpCommunityEventAction(org, id, { choice: "cant_go", private: false });
  const after1 = Object.fromEntries((await sql`SELECT user_id, state FROM community_rsvps WHERE task_id = ${id}`).map((r) => [r.user_id, r.state]));
  assert.deepEqual([after1[b!], after1[c!], after1[d!]], ["cant_go", "going", "waitlisted"]);

  // Hosts (organisers) see private RSVPs and the waitlist to check people in.
  viewerId = owner!;
  page = await ev.readCommunityEventAction(org, id);
  assert.ok(page.success && page.hostView && page.people.some((p) => p.id === a! && p.private) && page.waitlist.length === 1);

  // Visitors and viewers: the public page without names or link, and no RSVP.
  for (const who of [visitor!, viewer!]) {
    viewerId = who;
    page = await ev.readCommunityEventAction(org, id);
    assert.ok(page.success && page.people.length === 0 && page.event.link === null);
    assert.equal((await ev.rsvpCommunityEventAction(org, id, { choice: "going", private: false })).success, false);
  }

  // A paused member can't RSVP; a cancelled event tells people and takes no RSVPs.
  await sql`UPDATE workspaces SET org_settings = jsonb_build_object('community', jsonb_build_object('pauses', jsonb_build_object(${d!}::text, jsonb_build_object('until', ${soon(5)}::text)))) WHERE id = ${org}`;
  viewerId = d!;
  assert.match(String((await ev.rsvpCommunityEventAction(org, id, { choice: "going", private: false }) as { error?: string }).error), /pause/);
  viewerId = owner!;
  assert.equal((await ev.cancelCommunityEventAction(org, id)).success, true);
  viewerId = a!;
  assert.equal((await ev.rsvpCommunityEventAction(org, id, { choice: "cant_go", private: false })).success, false);
  const [told] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${a!} AND title LIKE '%cancelled%'`;
  assert.equal(told!.n, 1);
});

test("34.4: raising the limit moves the waitlist up; a host edits only events they host", async () => {
  const [owner, host, m1, m2] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, view_prefs) VALUES (${org}, ${owner!}, 'owner', '{}'), (${org}, ${host!}, 'member', ${sql.json({ community: { labels: ["host"] } })}), (${org}, ${m1!}, 'member', '{}'), (${org}, ${m2!}, 'member', '{}')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  viewerId = host!;
  const made = await ev.saveCommunityEventAction(org, null, { title: "Rust 101", description: null, fields: fields({ format: "online", place: null, who: "members" }), link: null, placeLimit: 1 });
  assert.ok(made.success);
  for (const who of [m1!, m2!]) { viewerId = who; await ev.rsvpCommunityEventAction(org, made.id, { choice: "going", private: false }); }
  viewerId = host!;
  const [t] = await sql`SELECT type_fields FROM tasks WHERE id = ${made.id}`;
  assert.deepEqual((t!.type_fields as { hosts: string[] }).hosts, [host!], "the creator hosts");
  assert.ok((await ev.saveCommunityEventAction(org, made.id, { title: "Rust 101", description: null, fields: fields({ format: "online", place: null, who: "members", hosts: [host!] }), link: null, placeLimit: 2 })).success);
  const [m2s] = await sql`SELECT state FROM community_rsvps WHERE task_id = ${made.id} AND user_id = ${m2!}`;
  assert.equal(m2s!.state, "going", "a raised limit moves the waitlist up");
  viewerId = owner!;
  const other = await ev.saveCommunityEventAction(org, null, { title: "Other", description: null, fields: fields({ who: "members" }), link: null, placeLimit: null });
  viewerId = host!;
  assert.ok(other.success);
  assert.equal((await ev.saveCommunityEventAction(org, other.id, { title: "Mine now", description: null, fields: fields({ who: "members" }), link: null, placeLimit: null })).success, false);
});

test("34.4 security review: a newcomer never jumps the waitlist; bad times are refused; community events only come from Events", async () => {
  const [owner, m1, m2, m3] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, view_prefs) VALUES (${org}, ${owner!}, 'owner', '{}'), (${org}, ${m1!}, 'member', ${sql.json({ community: { labels: ["host"] } })}), (${org}, ${m2!}, 'member', '{}'), (${org}, ${m3!}, 'member', '{}')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  viewerId = owner!;
  assert.equal((await ev.saveCommunityEventAction(org, null, { title: "Bad", description: null, fields: fields({ end: "3000" }), link: null, placeLimit: null })).success, false, "a time the database can't read");
  const made = await ev.saveCommunityEventAction(org, null, { title: "Small", description: null, fields: fields(), link: null, placeLimit: 1 });
  assert.ok(made.success);
  for (const who of [m1!, m2!]) { viewerId = who; await ev.rsvpCommunityEventAction(org, made.id, { choice: "going", private: false }); }
  // m2 waits; the limit rises by one place while m2 is waiting, then m3 arrives: m2 had the place, m3 waits.
  await sql`UPDATE community_events SET place_limit = 2 WHERE task_id = ${made.id}`;
  viewerId = m3!;
  const r = await ev.rsvpCommunityEventAction(org, made.id, { choice: "going", private: false });
  assert.ok(r.success && r.state === "waitlisted", "someone is already waiting");
  // The generic New module can't make a community event, even for a Host.
  const { createTaskAction } = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  viewerId = m1!;
  const generic = await createTaskAction({ projectId: org, title: "Sneaky", status: "todo", priority: "medium", itemType: "event", stage: "planned", typeFields: fields() } as Parameters<typeof createTaskAction>[0]);
  assert.equal(generic.success, false);
  viewerId = owner!;
  const generic2 = await createTaskAction({ projectId: org, title: "Sneaky", status: "todo", priority: "medium", itemType: "event", stage: "planned", typeFields: fields() } as Parameters<typeof createTaskAction>[0]);
  assert.equal(generic2.success, false, "organisers too: events come from Events");
});

test("B5.3b: hosts check people in around the event; reminders go once to people Going, the day before and an hour before", async () => {
  const [owner, m1, m2] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${m1!}, 'member'), (${org}, ${m2!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  viewerId = owner!;
  const soonEv = await ev.saveCommunityEventAction(org, null, { title: "Soon", description: null, fields: fields({ start: soon(0.5), end: soon(2) }), link: null, placeLimit: null });
  const tomorrow = await ev.saveCommunityEventAction(org, null, { title: "Tomorrow", description: null, fields: fields({ start: soon(24), end: soon(26) }), link: null, placeLimit: null });
  assert.ok(soonEv.success && tomorrow.success);
  for (const id of [soonEv.id, tomorrow.id]) { viewerId = m1!; await ev.rsvpCommunityEventAction(org, id, { choice: "going", private: false }); }
  viewerId = m2!;
  await ev.rsvpCommunityEventAction(org, soonEv.id, { choice: "cant_go", private: false });

  viewerId = m1!;
  assert.equal((await ev.checkInCommunityAction(org, soonEv.id, m1!, true)).success, false, "members don't check people in");
  viewerId = owner!;
  assert.equal((await ev.checkInCommunityAction(org, soonEv.id, m2!, true)).success, false, "only people going");
  assert.equal((await ev.checkInCommunityAction(org, tomorrow.id, m1!, true)).success, false, "not a day early");
  assert.equal((await ev.checkInCommunityAction(org, soonEv.id, m1!, true)).success, true);
  const [ci] = await sql`SELECT checked_in_at IS NOT NULL AS ok FROM community_rsvps WHERE task_id = ${soonEv.id} AND user_id = ${m1!}`;
  assert.equal(ci!.ok, true);

  const { notifyCommunityEventReminders } = await loadAppModule(() => import("../../src/lib/organizations/community-server"));
  await notifyCommunityEventReminders();
  await notifyCommunityEventReminders();
  const sent = await sql`SELECT title FROM user_notifications WHERE user_id = ${m1!} AND (title LIKE 'Tomorrow:%' OR title LIKE '%starts soon%') ORDER BY title`;
  assert.equal(sent.length, 2, "one of each, once");
  const [none] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${m2!} AND title LIKE '%starts soon%'`;
  assert.equal(none!.n, 0, "Can't go gets no reminder");
});

test("B5.3c: My events lists what you're going to or waiting for in the next 14 days, nothing cancelled or past", async () => {
  const [owner, m1] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${m1!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  viewerId = owner!;
  const near = await ev.saveCommunityEventAction(org, null, { title: "Near", description: null, fields: fields({ start: soon(30), end: soon(32) }), link: null, placeLimit: null });
  const far = await ev.saveCommunityEventAction(org, null, { title: "Far", description: null, fields: fields({ start: soon(24 * 20), end: soon(24 * 20 + 2) }), link: null, placeLimit: null });
  const gone = await ev.saveCommunityEventAction(org, null, { title: "Gone", description: null, fields: fields({ start: soon(40), end: soon(42) }), link: null, placeLimit: null });
  assert.ok(near.success && far.success && gone.success);
  viewerId = m1!;
  for (const id of [near.id, far.id, gone.id]) await ev.rsvpCommunityEventAction(org, id, { choice: "going", private: false });
  viewerId = owner!;
  await ev.cancelCommunityEventAction(org, gone.id);
  viewerId = m1!;
  const mine = await ev.readMyCommunityEventsAction();
  assert.ok(mine.success);
  assert.deepEqual(mine.events.map((e) => e.title), ["Near"]);
});
