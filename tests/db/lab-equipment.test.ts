import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";
import { daySlots, DEFAULT_BOOKING } from "../../src/lib/organizations/lab-equipment";

// B6.2c (report 35.5 calls 6–8): untrained booking refused (server test); no overlapping bookings; the weekly cap;
// Report a problem → Out of order pauses booking, the caretaker gets a task; Fixed reopens it.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.250" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let eq: typeof import("../../src/app/actions/lab-equipment");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  eq = await loadAppModule(() => import("../../src/app/actions/lab-equipment"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.5: training gate, no overlaps, weekly cap, Out of order pauses booking", async () => {
  const [pi, caretaker, student, other, viewer] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "private" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active', time_zone = 'Asia/Calcutta',
    org_settings = ${sql.json({ lab: { booking: { ...DEFAULT_BOOKING, slotMinutes: 120, weeklyCapHours: 4 } } })} WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${caretaker!}, 'member'), (${org}, ${student!}, 'member'), (${org}, ${other!}, 'member'), (${org}, ${viewer!}, 'viewer')`;
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${org}, 'rig', 'Capture rig.md', ${sql.json({ kind: "protocol" })}) RETURNING id`;

  viewerId = student!;
  assert.equal((await eq.saveEquipmentAction(org, null, { name: "Rig", place: "", caretakerId: null, trainingDocId: null, bookable: true, notes: "" })).success, false, "members don't add equipment");
  viewerId = pi!;
  const made = await eq.saveEquipmentAction(org, null, { name: "Capture rig A", place: "Lab 2", caretakerId: caretaker!, trainingDocId: d!.id, bookable: true, notes: "" });
  assert.ok(made.success);
  const id = made.success ? made.id : "";
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Calcutta" }).format(new Date(Date.now() + 864e5));
  const rules = { ...DEFAULT_BOOKING, slotMinutes: 120 as const, weeklyCapHours: 4 };
  const slots = daySlots(tomorrow, rules, "Asia/Calcutta");

  viewerId = student!;
  assert.match(String((await eq.bookEquipmentAction(org, id, slots[0]!.start) as { error?: string }).error), /signs you off/, "untrained booking refused");
  await sql`INSERT INTO lab_trainings (doc_id, user_id, workspace_id, trainer_id) VALUES (${d!.id}, ${student!}, ${org}, ${pi!}), (${d!.id}, ${other!}, ${org}, ${pi!})`;
  assert.match(String((await eq.bookEquipmentAction(org, id, new Date(Date.parse(slots[0]!.start) + 30 * 60_000).toISOString()) as { error?: string }).error), /slots shown/, "off the grid");
  const b1 = await eq.bookEquipmentAction(org, id, slots[0]!.start);
  assert.ok(b1.success);
  viewerId = other!;
  assert.match(String((await eq.bookEquipmentAction(org, id, slots[0]!.start) as { error?: string }).error), /booked that slot/, "no overlapping bookings");
  viewerId = student!;
  assert.ok((await eq.bookEquipmentAction(org, id, slots[1]!.start)).success);
  assert.match(String((await eq.bookEquipmentAction(org, id, slots[2]!.start) as { error?: string }).error), /hours this week/, "the weekly cap");
  viewerId = viewer!;
  assert.equal((await eq.readEquipmentAction(org)).success, false, "viewers see nothing");

  viewerId = other!;
  assert.ok((await eq.reportEquipmentProblemAction(org, id, "Lens cracked")).success, "anyone can report a problem");
  const [task] = await sql`SELECT assignee_id, title FROM tasks WHERE workspace_id = ${org} AND title = 'Fix Capture rig A'`;
  assert.equal(task!.assignee_id, caretaker!, "the caretaker gets a task");
  assert.match(String((await eq.bookEquipmentAction(org, id, slots[3]!.start) as { error?: string }).error), /paused/, "booking pauses while Out of order");
  assert.ok((await eq.reportEquipmentProblemAction(org, id, "Still cracked")).success);
  const [tasks] = await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${org} AND title = 'Fix Capture rig A'`;
  assert.equal(tasks!.n, 1, "a second report joins the open one: no new task");
  assert.equal((await eq.setEquipmentStatusAction(org, id, "available")).success, false, "only the caretaker or the PI and Researchers");
  viewerId = caretaker!;
  assert.ok((await eq.setEquipmentStatusAction(org, id, "available")).success);
  viewerId = other!;
  assert.ok((await eq.bookEquipmentAction(org, id, slots[3]!.start)).success, "Fixed reopens booking");
  const view = await eq.readEquipmentAction(org);
  assert.ok(view.success && view.equipment[0]!.bookings.some((b) => b.mine) && view.equipment[0]!.bookings.some((b) => !b.mine && b.name === "Booked"), "others' names stay private");
  viewerId = student!;
  const mine = await eq.readEquipmentAction(org);
  const myBooking = mine.success ? mine.equipment[0]!.bookings.find((b) => b.mine)! : null;
  viewerId = other!;
  assert.equal((await eq.cancelBookingAction(org, myBooking!.id)).success, false, "only your own (or caretakers and leads)");
  viewerId = student!;
  assert.ok((await eq.cancelBookingAction(org, myBooking!.id)).success);
  // Review: a booking that has started can't be cancelled to win hours back.
  const [started] = await sql`INSERT INTO lab_bookings (equipment_id, user_id, starts_at, ends_at) VALUES (${id}, ${student!}, now() - interval '1 hour', now() + interval '1 hour') RETURNING id`;
  assert.equal((await eq.cancelBookingAction(org, started!.id)).success, false);
  // The training protocol page goes: booking stays closed to the untrained.
  await sql`DELETE FROM workspace_documents WHERE id = ${d!.id}`;
  const [newcomer] = [await sql.begin((tx) => createUser(tx))];
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${newcomer!}, 'member')`;
  viewerId = newcomer!;
  assert.match(String((await eq.bookEquipmentAction(org, id, slots[4]!.start) as { error?: string }).error), /signs you off/);
});
