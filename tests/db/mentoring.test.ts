import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.3a (report 31.5 C5): mentor groups, matching, the pair's private check-ins (staff see only what the learner
// shares), Prep is the learner's, Was this useful? once per past check-in and shown only from 5, tokens never write.
let viewerId = "";
let token: string | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.188" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/mentoring");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/mentoring"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const err = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("mentoring: match, private check-ins, sharing, Prep and Was this useful?", async () => {
  const [teacher, mentor, learner, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${mentor!}, 'admin'), (${klass}, ${learner!}, 'member'), (${klass}, ${other!}, 'member')`;

  viewerId = teacher!;
  const off = await act.readMentoringAction(klass);
  assert.ok(off.success && !off.on);
  viewerId = mentor!;
  assert.equal((await act.saveMentoringSettingsAction(klass, { on: true })).success, false, "the Teacher sets mentoring");
  viewerId = teacher!;
  assert.equal((await act.saveMentoringSettingsAction(klass, { on: true, everyWeeks: 2, minutes: 30, checkins: 6, rhythmDays: 21, useful: true })).success, true);
  const [group] = await sql`INSERT INTO class_sections (workspace_id, name, kind) VALUES (${klass}, 'Arjun''s group', 'mentor') RETURNING id`;
  await sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind) VALUES (${group!.id}, ${klass}, ${mentor!}, 'ta', 'mentor')`;

  const before = await act.readMentoringAction(klass);
  assert.ok(before.success && before.on && before.staff);
  assert.deepEqual(before.staff.unmatched.map((u) => u.id).sort(), [learner!, other!].sort());
  assert.equal(before.staff.suggestions.length, 2);
  viewerId = learner!;
  assert.equal((await act.matchMentorsAction(klass, [{ userId: learner!, groupId: group!.id }])).success, false, "learners don't match");
  viewerId = teacher!;
  assert.deepEqual(await act.matchMentorsAction(klass, [{ userId: learner!, groupId: group!.id }]), { success: true, matched: 1 });

  viewerId = learner!;
  const mine = await act.readMentoringAction(klass);
  assert.ok(mine.success && mine.on && mine.myMentor);
  assert.deepEqual(mine.myMentor.mentors.map((m) => m.id), [mentor!]);
  assert.match(mine.myMentor.plan ?? "", /every 2 weeks · 30 min · 0 of 6/);
  viewerId = mentor!;
  const mentees = await act.readMentoringAction(klass);
  assert.ok(mentees.success && mentees.on);
  assert.deepEqual(mentees.mentees.map((m) => m.id), [learner!]);

  // Check-ins: the pair writes; Prep is the learner's; staff and other learners read nothing until shared.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const entry = await act.saveCheckinAction(klass, learner!, { date: yesterday, notes: "Portfolio: rewrite About" });
  assert.ok(entry.success);
  assert.match(err(await act.saveCheckinAction(klass, learner!, { date: yesterday, prep: { since: "x", stuck: "", asks: "" } })), /learner’s/);
  viewerId = learner!;
  assert.equal((await act.saveCheckinAction(klass, learner!, { date: yesterday, prep: { since: "Shipped the home page", stuck: "CSS grid", asks: "" } })).success, true);
  viewerId = other!;
  assert.equal((await act.readCheckinsAction(klass, learner!)).success, false, "another learner reads nothing");
  assert.equal((await act.saveCheckinAction(klass, learner!, { date: yesterday, notes: "hi" })).success, false);
  viewerId = teacher!;
  const hidden = await act.readCheckinsAction(klass, learner!);
  assert.ok(hidden.success);
  assert.equal(hidden.entries.length, 0, "notes never reach staff unless shared");
  viewerId = learner!;
  const own = await act.readCheckinsAction(klass, null);
  assert.ok(own.success && own.learnerId === learner!);
  assert.deepEqual(own.entries.map((e) => [e.notes, e.prepDone, e.prep?.stuck]), [["Portfolio: rewrite About", true, "CSS grid"]]);
  assert.equal((await act.shareCheckinAction(klass, entry.id, true)).success, true);
  viewerId = mentor!;
  assert.equal((await act.shareCheckinAction(klass, entry.id, false)).success, false, "only the learner shares");
  viewerId = teacher!;
  const shared = await act.readCheckinsAction(klass, learner!);
  assert.ok(shared.success);
  assert.deepEqual(shared.entries.map((e) => e.notes), ["Portfolio: rewrite About"]);

  // Was this useful?: the learner, once, after the check-in; tokens never answer; totals hidden under 5.
  viewerId = learner!;
  token = "agent";
  assert.equal((await act.answerUsefulAction(klass, entry.id, "very")).success, false, "agents never answer Useful");
  token = null;
  assert.equal((await act.answerUsefulAction(klass, entry.id, "very")).success, true);
  assert.match(err(await act.answerUsefulAction(klass, entry.id, "somewhat")), /answered/);
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  viewerId = mentor!;
  const next = await act.saveCheckinAction(klass, learner!, { date: tomorrow, notes: "" });
  assert.ok(next.success);
  viewerId = learner!;
  assert.match(err(await act.answerUsefulAction(klass, next.id, "very")), /after the check-in/);
  viewerId = teacher!;
  const cards = await act.readMentoringAction(klass);
  assert.ok(cards.success && cards.on && cards.staff);
  assert.deepEqual(cards.staff.cards[0]!.useful, { shown: false, answers: 1 });

  // Security review: learners never pick a mentor group; a new match opens nothing from before it; a mentor who is no
  // longer a TA reads nothing.
  const sections = await loadAppModule(() => import("../../src/app/actions/sections"));
  await sql`UPDATE workspaces SET org_settings = org_settings || '{"sections": {"word": "Section", "taOnlyOwn": false, "selfPick": true}}'::jsonb WHERE id = ${klass}`;
  viewerId = other!;
  assert.equal((await sections.pickSectionAction(klass, group!.id)).success, false, "no self-pick into a mentor group");
  viewerId = teacher!;
  const [group2] = await sql`INSERT INTO class_sections (workspace_id, name, kind) VALUES (${klass}, 'Teacher''s group', 'mentor') RETURNING id`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${other!}, 'admin') ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin'`;
  await sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind) VALUES (${group2!.id}, ${klass}, ${other!}, 'ta', 'mentor')`;
  await sql`UPDATE class_section_members SET created_at = now() - interval '1 minute' WHERE section_id = ${group!.id}`;
  assert.equal((await act.matchMentorsAction(klass, [{ userId: learner!, groupId: group2!.id }])).success, true);
  viewerId = other!;
  const fresh = await act.readCheckinsAction(klass, learner!);
  assert.ok(fresh.success);
  assert.equal(fresh.entries.length, 0, "the new mentor sees nothing from before the match");
  assert.equal((await act.saveCheckinAction(klass, learner!, { date: yesterday, notes: "overwrite" })).success, false, "nor edits it");
  viewerId = mentor!;
  assert.equal((await act.readCheckinsAction(klass, learner!)).success, false, "the old mentor is out of the pair");
  // A TA added to the learner's group after the match starts from when they joined.
  const [late] = await Promise.all([1].map(() => sql.begin((tx) => createUser(tx))));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${late!}, 'admin')`;
  viewerId = other!;
  const now1 = await act.saveCheckinAction(klass, learner!, { date: new Date().toISOString().slice(0, 10), notes: "Today with the new mentor" });
  assert.ok(now1.success);
  await new Promise((r) => setTimeout(r, 20));
  await sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind) VALUES (${group2!.id}, ${klass}, ${late!}, 'ta', 'mentor')`;
  viewerId = late!;
  const lateView = await act.readCheckinsAction(klass, learner!);
  assert.ok(lateView.success);
  assert.equal(lateView.entries.length, 0, "a mentor added later sees nothing from before they joined");
  await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${klass} AND user_id = ${other!}`;
  viewerId = other!;
  assert.equal((await act.readCheckinsAction(klass, learner!)).success, false, "no longer a TA, no longer a mentor");
});
