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
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active' WHERE id = ${id}`;
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
  assert.deepEqual(coordView.people.find((p) => p.id === ann!), { id: ann!, name: coordView.people.find((p) => p.id === ann!)!.name, trained: ["delivery"], attended: 1, missed: 0 });
  viewerId = outsider!;
  const pub = await v.readVolunteerWithUsAction(id);
  assert.ok(pub.success && pub.member === false && pub.shifts.length >= 1 && pub.shifts.some((s) => s.training === false && s.left === 0), "Volunteer with us shows places left");
  assert.equal((await v.readVolunteersAction(id)).success, false, "visitors don't read volunteers");
});
