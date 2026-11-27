import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Plan B8.1a (report 37.3): volunteers and shifts in an Other organization.
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

let v: typeof import("../../src/app/actions/volunteers");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  v = await loadAppModule(() => import("../../src/app/actions/volunteers"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("37.3 (B8.1a): agree, sign up, the waitlist moves up, training gates a role, check in inside the window, my hours only", async () => {
  const [coord, ann, bob, cat, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, coord!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active', org_settings = '{"parts":{"on":["volunteers","fixedTime","programs"]}}'::jsonb WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${coord!}, 'owner'), (${id}, ${ann!}, 'member'), (${id}, ${bob!}, 'member'), (${id}, ${cat!}, 'member')`;
  viewerId = ann!;
  assert.equal((await v.saveVolunteerSettingsAction(id, { on: true, roles: [], agreement: { text: "", version: 0 } })).success, false, "coordinators set it up");
  viewerId = coord!;
  assert.ok((await v.saveVolunteerSettingsAction(id, { on: true, agreement: { text: "Be kind; tell us if you can't come.", version: 0 },
    roles: [{ id: "sorting", name: "Sorting", line: "Sort donations", training: false }, { id: "delivery", name: "Delivery", line: "Drive", training: true }] })).success);
  const soon = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const s1 = await v.saveShiftAction(id, { roleId: "sorting", place: "Food bank", start: soon(48), end: soon(51), places: 1, note: "" });
  const s2 = await v.saveShiftAction(id, { roleId: "delivery", place: "Food bank", start: soon(52), end: soon(55), places: 4, note: "" });
  assert.ok(s1.success && s2.success);

  viewerId = ann!;
  assert.match(String((await v.shiftSignUpAction(id, s1.id, "going") as { error?: string }).error), /agreement first/);
  assert.ok((await v.agreeVolunteerAction(id, 1)).success);
  assert.deepEqual(await v.shiftSignUpAction(id, s1.id, "going"), { success: true, state: "going" });
  assert.match(String((await v.shiftSignUpAction(id, s2.id, "going") as { error?: string }).error), /training sign-off/, "untrained can't sign up");
  viewerId = bob!;
  assert.ok((await v.agreeVolunteerAction(id, 1)).success);
  assert.deepEqual(await v.shiftSignUpAction(id, s1.id, "going"), { success: true, state: "waitlisted" }, "a full shift puts you on the waitlist");
  viewerId = ann!;
  assert.ok((await v.shiftSignUpAction(id, s1.id, "cant_go")).success);
  const [moved] = await sql`SELECT state FROM community_rsvps WHERE task_id = ${s1.id} AND user_id = ${bob!}`;
  assert.equal(moved!.state, "going", "the waitlist moves up");
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${bob!} AND title LIKE 'A place opened:%'`)[0]!.n, 1);

  viewerId = coord!;
  assert.ok((await v.signOffTrainingAction(id, ann!, "delivery", true)).success);
  viewerId = ann!;
  assert.ok((await v.shiftSignUpAction(id, s2.id, "going")).success, "trained now");
  assert.match(String((await v.checkInShiftAction(id, s2.id, null) as { error?: string }).error), /isn’t open/, "check-in opens 15 minutes before");
  // The shift is moved into its window, then hours count from checked-in shifts.
  await sql`UPDATE tasks SET type_fields = type_fields || ${sql.json({ start: new Date(Date.now() - 5 * 60_000).toISOString(), end: new Date(Date.now() + 3 * 3_600_000 - 5 * 60_000).toISOString() })} WHERE id = ${s2.id}`;
  assert.ok((await v.checkInShiftAction(id, s2.id, null)).success);
  viewerId = cat!;
  assert.equal((await v.checkInShiftAction(id, s2.id, ann!)).success, false, "only coordinators tick other people");
  const catView = await v.readVolunteersAction(id);
  assert.ok(catView.success && "hours" in catView && catView.hours.year === 0 && catView.people.length === 0, "a volunteer sees only their own hours, never others'");
  viewerId = ann!;
  const annView = await v.readVolunteersAction(id);
  assert.ok(annView.success && "hours" in annView && annView.hours.year === 3 && annView.hours.shifts === 1);
  viewerId = coord!;
  const coordView = await v.readVolunteersAction(id);
  assert.ok(coordView.success && "people" in coordView);
  const annRow = coordView.people.find((p) => p.id === ann!)!;
  assert.deepEqual([annRow.trained, annRow.attended, annRow.missed], [["delivery"], 1, 0]);
  viewerId = outsider!;
  const pub = await v.readVolunteerWithUsAction(id);
  assert.ok(pub.success && pub.member === false && pub.shifts.length >= 1 && pub.shifts.some((s) => s.training === false && s.left === 0), "Volunteer with us shows places left");
  assert.equal((await v.readVolunteersAction(id)).success, false, "visitors don't read volunteers");
});

test("37.3 (B8.1b): Regulars on a weekly series, swaps a named volunteer accepts, hand-added hours count once confirmed, profile entry, reminders and short notices", async () => {
  const [coord, ann, bob] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, coord!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active', org_settings = '{"parts":{"on":["volunteers","fixedTime","programs"]}}'::jsonb, title = 'WT Food bank' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${coord!}, 'owner', now() - interval '1 year'), (${id}, ${ann!}, 'member', now() - interval '1 year'), (${id}, ${bob!}, 'member', now() - interval '1 year')`;
  viewerId = coord!;
  assert.ok((await v.saveVolunteerSettingsAction(id, { on: true, agreement: { text: "", version: 0 }, roles: [{ id: "sorting", name: "Sorting", line: "", training: false }] })).success);
  const start = new Date(Date.now() + 48 * 3_600_000);
  const s = await v.saveShiftAction(id, { roleId: "sorting", place: "Hall", start: start.toISOString(), end: new Date(start.getTime() + 3 * 3_600_000).toISOString(), places: 2, note: "" }, 2);
  assert.ok(s.success);
  const series = await sql`SELECT id, type_fields->>'series' AS series FROM tasks WHERE workspace_id = ${id} AND type_fields->>'kind' = 'shift' ORDER BY type_fields->>'start'`;
  assert.equal(series.length, 3, "this week and 2 repeats");
  assert.equal(new Set(series.map((x) => x.series)).size, 1);
  viewerId = ann!;
  const reg = await v.setRegularAction(id, String(series[0]!.series), true);
  assert.ok(reg.success && reg.placed === 3, "a Regular has a place on every coming shift of the series");
  const mine = await v.readVolunteersAction(id);
  assert.ok(mine.success && "regular" in mine && mine.regular.includes(String(series[0]!.series)));

  // A swap: Ann asks Bob, Bob says yes and takes the place straight over.
  assert.ok((await v.askSwapAction(id, String(series[0]!.id), bob!)).success);
  assert.match(String((await v.askSwapAction(id, String(series[0]!.id), bob!) as { error?: string }).error), /already asked/);
  viewerId = coord!;
  assert.equal((await v.answerSwapAction(id, (await sql`SELECT id FROM volunteer_swaps WHERE from_user = ${ann!}`)[0]!.id as string, true)).success, false, "only the person asked answers");
  viewerId = bob!;
  assert.ok((await v.answerSwapAction(id, (await sql`SELECT id FROM volunteer_swaps WHERE from_user = ${ann!}`)[0]!.id as string, true)).success);
  const states = Object.fromEntries((await sql`SELECT user_id, state FROM community_rsvps WHERE task_id = ${series[0]!.id}`).map((r) => [String(r.user_id), String(r.state)]));
  assert.deepEqual([states[ann!], states[bob!]], ["cant_go", "going"]);
  viewerId = ann!;
  assert.ok((await v.setRegularAction(id, String(series[0]!.series), false)).success, "stopping frees the coming places");
  assert.equal((await sql`SELECT count(*)::int AS n FROM community_rsvps r JOIN tasks t ON t.id = r.task_id WHERE t.workspace_id = ${id} AND r.user_id = ${ann!} AND r.state = 'going'`)[0]!.n, 0);

  // Hours: added by hand they count only once a coordinator confirms them; a volunteer can't confirm.
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  assert.ok((await v.addHoursAction(id, { day, hours: 2.5, roleId: "sorting", note: "Weekend drive" })).success);
  assert.match(String((await v.addHoursAction(id, { day: "2999-01-01", hours: 2, roleId: null, note: "" }) as { error?: string }).error), /has passed/);
  const waiting = await v.readVolunteersAction(id);
  assert.ok(waiting.success && "hours" in waiting && waiting.hours.year === 0 && waiting.hours.waiting === 2.5);
  const hid = (await sql`SELECT id FROM volunteer_hours WHERE user_id = ${ann!}`)[0]!.id as string;
  assert.equal((await v.confirmHoursAction(id, hid, true)).success, false);
  assert.match(String((await v.addHoursToProfileAction(id) as { error?: string }).error), /no confirmed hours/);
  viewerId = coord!;
  const coordView = await v.readVolunteersAction(id);
  assert.ok(coordView.success && "waitingHours" in coordView && coordView.waitingHours.length === 1 && coordView.people.find((p) => p.id === ann!)?.involvement);
  assert.ok((await v.confirmHoursAction(id, hid, true)).success);
  viewerId = ann!;
  const after = await v.readVolunteersAction(id);
  assert.ok(after.success && "hours" in after && after.hours.year === 2.5 && after.hours.waiting === 0, "hours = checked-in shift time + confirmed additions");
  const prof = await v.addHoursToProfileAction(id);
  assert.ok(prof.success && prof.hours === 2.5);
  const [entry] = await sql`SELECT project_title, role_title FROM profile_contributions WHERE profile_id = ${ann!} AND external_key = ${`volunteer-hours:${id}:${new Date().getUTCFullYear()}`}`;
  assert.deepEqual({ ...entry }, { project_title: `2.5 hours volunteering with WT Food bank, ${new Date().getUTCFullYear()}`, role_title: "Volunteer" });

  // Notices: the day-before reminder to people going; still short 2 days before tells coordinators (once each).
  const notices = await loadAppModule(() => import("../../src/lib/organizations/volunteers-server"));
  await notices.volunteerNotices(new Date(start.getTime() - 24 * 3_600_000));
  await notices.volunteerNotices(new Date(start.getTime() - 48 * 3_600_000));
  await notices.volunteerNotices(new Date(start.getTime() - 48 * 3_600_000));
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${bob!} AND title LIKE 'Reminder: Sorting tomorrow%'`)[0]!.n, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${coord!} AND title = 'Short: Sorting in 2 days needs 1 more'`)[0]!.n, 1);
});
