import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Plan B8.1a (report 37.3): fixed-time and shifts in an Other organization.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.242" }) });

let ft: typeof import("../../src/app/actions/fixed-time");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  ft = await loadAppModule(() => import("../../src/app/actions/fixed-time"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("37.4 (B8.2a): a plan worked back from the key date; moving it moves plan dates, never hand-set ones; a passed key date needs a reason", async () => {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, {}));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active', org_settings = '{"parts":{"on":["volunteers","fixedTime","programs"]}}'::jsonb, title = 'WT Book Fest' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  const key = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  viewerId = member!;
  assert.equal((await ft.setFixedTimeAction(id, { keyDate: key })).success, false, "organisers set the dates");
  viewerId = owner!;
  assert.match(String((await ft.applyStarterAction(id, "event") as { error?: string }).error), /key date first/);
  assert.ok((await ft.setFixedTimeAction(id, { keyDate: key })).success);
  const read = await ft.readFixedTimeAction(id);
  assert.ok(read.success && read.fixed && read.fixed.state === "planning" && read.fixed.line === "60 days to go");
  const plan = await ft.applyStarterAction(id, "event");
  assert.ok(plan.success && plan.tasks === 14);
  assert.match(String((await ft.applyStarterAction(id, "campaign") as { error?: string }).error), /already has a plan/);
  const rows = await sql`SELECT id, title, (due_date AT TIME ZONE 'UTC')::date::text AS due, (type_fields->'plan'->>'offset')::int AS offset FROM tasks WHERE workspace_id = ${id} ORDER BY due_date`;
  const venue = rows.find((r) => r.title === "Book the venue")!;
  const { addDays } = await import("../../src/lib/organizations/fixed-time");
  assert.equal(venue.due, addDays(key, -42), "dates worked out backwards");
  // Someone sets the briefing's date by hand.
  const briefing = rows.find((r) => r.title === "Volunteer briefing")!;
  await sql`UPDATE tasks SET due_date = ${new Date(`${addDays(key, -20)}T09:00:00Z`)} WHERE id = ${briefing.id}`;
  const newKey = addDays(key, 7);
  const preview = await ft.previewMoveAction(id, newKey);
  assert.ok(preview.success && preview.stays.length === 1 && preview.stays[0]!.title === "Volunteer briefing" && preview.moves.length === 13);
  const moved = await ft.moveKeyDateAction(id, newKey);
  assert.ok(moved.success && moved.moved === 13);
  const after = await sql`SELECT title, (due_date AT TIME ZONE 'UTC')::date::text AS due FROM tasks WHERE workspace_id = ${id}`;
  assert.equal(after.find((r) => r.title === "Book the venue")!.due, addDays(newKey, -42), "plan dates move with the key date");
  assert.equal(after.find((r) => r.title === "Volunteer briefing")!.due, addDays(key, -20), "a date set by hand stays");
  const [w] = await sql`SELECT org_settings->'fixedTime' AS f FROM workspaces WHERE id = ${id}`;
  assert.deepEqual([w!.f.keyDate, w!.f.endDate], [newKey, addDays(newKey, 30)], "the end date keeps its distance");
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${member!} AND title LIKE 'WT Book Fest: the key date moved to%'`)[0]!.n, 1, "the team is told");
  // A key date that has passed: moving it needs a reason, kept for the debrief.
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime,keyDate}', to_jsonb(${addDays(new Date().toISOString().slice(0, 10), -3)}::text)) WHERE id = ${id}`;
  assert.match(String((await ft.moveKeyDateAction(id, newKey) as { error?: string }).error), /say why/);
  assert.ok((await ft.moveKeyDateAction(id, newKey, "Rain")).success);
  const [w2] = await sql`SELECT org_settings->'fixedTime'->'moves' AS moves FROM workspaces WHERE id = ${id}`;
  assert.equal(w2!.moves.at(-1).reason, "Rain");
});

test("37.4 (B8.2b): workstreams with owners, bookings with typed references (confirmed needs one), the unconfirmed-booking notice, Issues today only on the day", async () => {
  const [owner, asha, dev] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, {}));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active', org_settings = '{"parts":{"on":["volunteers","fixedTime","programs"]}}'::jsonb, title = 'WT Fest' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${asha!}, 'member'), (${id}, ${dev!}, 'member')`;
  const { addDays } = await import("../../src/lib/organizations/fixed-time");
  const today = new Date().toISOString().slice(0, 10);
  viewerId = owner!;
  assert.ok((await ft.setFixedTimeAction(id, { keyDate: addDays(today, 10) })).success);
  assert.ok((await ft.saveWorkstreamsAction(id, [{ id: "venue", name: "Venue", owner: asha! }, { id: "comms", name: "Comms", owner: null }])).success);
  viewerId = dev!;
  assert.equal((await ft.addBookingAction(id, { title: "Venue", supplier: "MG Hall", workstream: "venue" })).success, false, "only organisers and the workstream's owner add its bookings");
  viewerId = asha!;
  const b = await ft.addBookingAction(id, { title: "Venue", supplier: "MG Hall", workstream: "venue" });
  assert.ok(b.success);
  assert.match(String((await ft.updateBookingAction(id, b.id, { supplier: "MG Hall", ref: "", state: "confirmed", workstream: "venue" }) as { error?: string }).error), /reference/);
  // Within 14 days of the key date and not confirmed: its owner is told once.
  const notices = await loadAppModule(() => import("../../src/lib/organizations/fixed-time-server"));
  await notices.fixedTimeNotices(); await notices.fixedTimeNotices();
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${asha!} AND title = 'Booking not confirmed yet: Venue'`)[0]!.n, 1);
  assert.ok((await ft.updateBookingAction(id, b.id, { supplier: "MG Hall", ref: "MG-2231", state: "confirmed", workstream: "venue" })).success);
  const read = await ft.readFixedTimeAction(id);
  assert.ok(read.success && "bookings" in read && read.bookings[0]!.ref === "MG-2231" && read.bookings[0]!.state === "confirmed" && read.workstreams[0]!.ownerName);
  assert.equal((await sql`SELECT status FROM tasks WHERE id = ${b.id}`)[0]!.status, "done");
  assert.match(String((await ft.raiseIssueAction(id, "Lost keys") as { error?: string }).error), /day itself/);
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime,keyDate}', to_jsonb(${today}::text)) WHERE id = ${id}`;
  viewerId = dev!;
  assert.ok((await ft.raiseIssueAction(id, "Lost keys")).success);
  const day = await ft.readFixedTimeAction(id);
  assert.ok(day.success && "issues" in day && day.issues.length === 1 && day.issues[0]!.title === "Lost keys");
  assert.ok((await ft.solveIssueAction(id, day.issues[0]!.id, true)).success);
});

test("37.4 (B8.2c): wrap-up, the debrief keeps a late move's reason, Close is asked weekly and never automatic, Run it again pins the debrief and copies no people", async () => {
  const [owner, mei] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, {}));
  created.push(id);
  const { addDays } = await import("../../src/lib/organizations/fixed-time");
  const today = new Date().toISOString().slice(0, 10);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active', org_settings = '{"parts":{"on":["volunteers","fixedTime","programs"]}}'::jsonb, title = 'WT Book Fest 2027', slug = ${`wt-bf-${id.slice(0, 8)}`} WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${mei!}, 'member')`;
  viewerId = owner!;
  assert.ok((await ft.setFixedTimeAction(id, { keyDate: addDays(today, -20), endDate: addDays(today, -1) })).success);
  assert.ok((await ft.saveWorkstreamsAction(id, [{ id: "venue", name: "Venue", owner: mei! }])).success);
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime,moves}', ${sql.json([{ from: addDays(today, -25), to: addDays(today, -20), reason: "Rain", at: new Date().toISOString() }])}) WHERE id = ${id}`;
  assert.ok((await ft.saveWrapAction(id, "thank", true)).success);
  assert.ok((await ft.saveFixedDebriefAction(id, { summary: "A good year", well: "Volunteers", wrong: "Permit late", next: "- Apply for the permit in December\n- Book two sound techs" })).success);
  const [d] = await sql`SELECT org_settings->'fixedTime'->'debrief' AS d FROM workspaces WHERE id = ${id}`;
  assert.match(d!.d.wrong, /Key date moved from .* Rain/, "a move after the date passed keeps its reason in the debrief");
  const read = await ft.readFixedTimeAction(id);
  assert.ok(read.success && read.fixed && read.fixed.state === "ended" && "wrap" in read.fixed && read.fixed.wrap.thank && read.fixed.wrap.debrief && !read.fixed.wrap.photos);
  // From the end date the owner is asked once a week; it never closes on its own.
  const notices = await loadAppModule(() => import("../../src/lib/organizations/fixed-time-server"));
  await notices.fixedTimeNotices(); await notices.fixedTimeNotices();
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${owner!} AND title = 'WT Book Fest 2027 has ended. Close the team?'`)[0]!.n, 1);
  assert.equal((await sql`SELECT status FROM workspaces WHERE id = ${id}`)[0]!.status, "active", "never closes on its own");
  viewerId = mei!;
  assert.ok((await ft.addTeamToProfileAction(id)).success);
  assert.equal((await sql`SELECT project_title FROM profile_contributions WHERE profile_id = ${mei!} AND external_key = ${`fixed-team:${id}`}`)[0]!.project_title, "Organising team, WT Book Fest 2027");
  // Run it again (the built duplicate, run here directly): dates move to the new key date, the debrief is pinned, Next time lines become tasks, no people.
  const { duplicateOrg } = await loadAppModule(() => import("../../src/lib/organizations/lifecycle"));
  const newKey = addDays(today, 345);
  const copy = await duplicateOrg(id, owner!, { title: "WT Book Fest 2028", handle: `wt-bf28-${id.slice(0, 8)}`, termStart: newKey,
    copy: { about: true, docs: true, files: false, sprints: false, assignments: false, channels: false, admins: false } } as never);
  const newId = typeof copy === "string" ? copy : (copy as { id?: string } | null)?.id ?? (await sql`SELECT id FROM workspaces WHERE slug = ${`wt-bf28-${id.slice(0, 8)}`}`)[0]!.id as string;
  created.push(newId);
  const [n] = await sql`SELECT org_settings->'fixedTime' AS f FROM workspaces WHERE id = ${newId}`;
  assert.deepEqual([n!.f.keyDate, n!.f.endDate, n!.f.workstreams[0].owner, n!.f.pinned.from, n!.f.pinned.summary], [newKey, addDays(newKey, 19), null, "WT Book Fest 2027", "A good year"]);
  assert.equal(n!.f.starter ?? null, null, "no plan, moves or wrap-up are copied");
  assert.deepEqual((await sql`SELECT title FROM tasks WHERE workspace_id = ${newId} ORDER BY title`).map((t) => t.title), ["Apply for the permit in December", "Book two sound techs"]);
  assert.deepEqual((await sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${newId}`).map((m) => m.user_id), [owner!], "no members copied");
});
