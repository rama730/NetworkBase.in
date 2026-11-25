import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.3b (report 31.5 C5): objectives (3 open, the pair only), booking a mentor's free time (once, with a .ics),
// concerns (private, to the Teacher), the mentor's note (shown after the learner approves), and the hourly reminders.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.189" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let plan: typeof import("../../src/app/actions/mentoring-plan");
let mentoring: typeof import("../../src/app/actions/mentoring");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  plan = await loadAppModule(() => import("../../src/app/actions/mentoring-plan"));
  mentoring = await loadAppModule(() => import("../../src/app/actions/mentoring"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const err = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("objectives, booking, concerns and the mentor's note", async () => {
  const [teacher, mentor, learner, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, time_zone = 'UTC',
    org_settings = ${sql.json({ mentoring: { on: true, everyWeeks: 2, minutes: 30, checkins: 6, rhythmDays: 21, useful: true } } as never)} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${mentor!}, 'admin'), (${klass}, ${learner!}, 'member'), (${klass}, ${other!}, 'member')`;
  const [group] = await sql`INSERT INTO class_sections (workspace_id, name, kind) VALUES (${klass}, 'Group', 'mentor') RETURNING id`;
  await sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind) VALUES (${group!.id}, ${klass}, ${mentor!}, 'ta', 'mentor'), (${group!.id}, ${klass}, ${learner!}, 'student', 'mentor')`;

  // Objectives: the pair only; three open at a time.
  viewerId = learner!;
  for (const t of ["Ship the portfolio", "Pass Mock 5", "Learn React"]) assert.equal((await plan.saveObjectiveAction(klass, null, { title: t })).success, true);
  assert.match(err(await plan.saveObjectiveAction(klass, null, { title: "One more" })), /Up to 3/);
  const mine = await plan.readObjectivesAction(klass, null);
  assert.ok(mine.success && !mine.canAdd);
  viewerId = mentor!;
  assert.equal((await plan.saveObjectiveAction(klass, learner!, { id: mine.objectives[1]!.id, status: "at_risk" })).success, true);
  viewerId = other!;
  assert.equal((await plan.readObjectivesAction(klass, learner!)).success, false, "outside the pair");
  viewerId = teacher!;
  assert.equal((await plan.readObjectivesAction(klass, learner!)).success, false, "the Teacher sees counts, not objectives");
  const cards = await mentoring.readMentoringAction(klass);
  assert.ok(cards.success && cards.on && cards.staff);
  assert.deepEqual(cards.staff.cards[0]!.objectives, { onTrack: 2, atRisk: 1 });

  // Booking: the mentor's free times; one learner per time; a .ics comes back.
  viewerId = mentor!;
  const weekday = (new Date().getUTCDay() + 2) % 7;
  assert.equal((await plan.saveMySlotsAction(klass, [{ weekday, start: "18:00" }])).success, true);
  viewerId = learner!;
  const booking = await plan.readBookingAction(klass);
  assert.ok(booking.success);
  const at = booking.mentors[0]!.free[0]!;
  const booked = await plan.bookCheckinAction(klass, mentor!, at);
  assert.ok(booked.success);
  assert.match(booked.ics, /BEGIN:VEVENT[\s\S]*SUMMARY:Check-in with/);
  assert.match(err(await plan.bookCheckinAction(klass, mentor!, at)), /just taken/, "a booked time is gone");
  const [entry] = await sql`SELECT on_date::text AS d, starts_at FROM mentor_checkins WHERE workspace_id = ${klass} AND learner_id = ${learner!}`;
  assert.equal(new Date(entry!.starts_at as string).toISOString(), at);
  viewerId = other!;
  assert.equal((await plan.bookCheckinAction(klass, mentor!, at)).success, false, "not their mentor");

  // Concerns: privately to the Teacher, kept.
  viewerId = mentor!;
  assert.equal((await plan.raiseConcernAction(klass, { aboutId: learner!, body: "Missed two check-ins" })).success, true);
  assert.equal((await plan.raiseConcernAction(klass, { aboutId: other!, body: "Not mine" })).success, false, "only about a mentee");
  assert.equal((await plan.readConcernsAction(klass)).success, false, "TAs don't read concerns");
  viewerId = teacher!;
  const concerns = await plan.readConcernsAction(klass);
  assert.ok(concerns.success);
  assert.deepEqual(concerns.concerns.map((c) => c.body), ["Missed two check-ins"]);

  // The mentor's note waits for the learner's approval, and goes on the completion entry once approved.
  viewerId = mentor!;
  assert.equal((await plan.saveMentorNoteAction(klass, learner!, "Shipped a real portfolio")).success, true);
  viewerId = learner!;
  const note = await plan.readMentorNoteAction(klass, null);
  assert.ok(note.success && note.note && !note.note.approved);
  await sql`INSERT INTO profile_contributions (profile_id, workspace_id, source, visibility, end_reason, ended_at) VALUES (${learner!}, ${klass}, 'membership', 'public', 'completed', now())`;
  assert.equal((await plan.approveMentorNoteAction(klass, true)).success, true);
  const [pc] = await sql`SELECT end_note FROM profile_contributions WHERE profile_id = ${learner!} AND workspace_id = ${klass}`;
  assert.equal(pc!.end_note, "Mentor: Shipped a real portfolio");

  // The hourly reminders: Prep for tomorrow, once.
  const server = await loadAppModule(() => import("../../src/lib/organizations/mentoring-server"));
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await sql`INSERT INTO mentor_checkins (workspace_id, learner_id, on_date) VALUES (${klass}, ${learner!}, ${tomorrow}) ON CONFLICT DO NOTHING`;
  await server.notifyMentoring();
  await server.notifyMentoring();
  const notices = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${learner!} AND dedupe_key LIKE 'mentor-prep:%'`;
  assert.equal(notices[0]!.n, 1, "one Prep reminder, however often the job runs");
});
