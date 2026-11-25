import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.5b (report 31.6 calls 4, 7–9): demo day — staff set it up and run it; chosen judges give feedback (never
// marks) and pick per award; a mentor never judges their mentees' team; staff announce; the team reads its feedback.
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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.193" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/demo-day");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/demo-day"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const err = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("demo day: setup, run of show, judging with the mentor rule, picks, announcing, and the team's feedback", async () => {
  const [teacher, mentor, judge, learnerA, learnerB] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${mentor!}, 'admin'), (${klass}, ${judge!}, 'viewer'), (${klass}, ${learnerA!}, 'member'), (${klass}, ${learnerB!}, 'member')`;
  const team = async (owner: string, title: string) => {
    const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "org" }));
    created.push(id);
    await sql`UPDATE workspaces SET parent_id = ${klass}, title = ${title} WHERE id = ${id}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    await sql`INSERT INTO workspace_workflows (workspace_id, workflow) VALUES (${id}, 'capstone')`;
    return id;
  };
  const kite = await team(learnerA!, "Team Kite");
  const lumen = await team(learnerB!, "Team Lumen");
  // The mentor mentors learnerA (Team Kite).
  const [group] = await sql`INSERT INTO class_sections (workspace_id, name, kind) VALUES (${klass}, 'G', 'mentor') RETURNING id`;
  await sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind) VALUES (${group!.id}, ${klass}, ${mentor!}, 'ta', 'mentor'), (${group!.id}, ${klass}, ${learnerA!}, 'student', 'mentor')`;

  viewerId = learnerA!;
  assert.equal((await act.saveDemoDayAction(klass, { date: "2027-02-12" })).success, false, "staff set it up");
  viewerId = teacher!;
  const outsider = (await Promise.all([1].map(() => sql.begin((tx) => createUser(tx)))))[0]!;
  assert.match(err(await act.saveDemoDayAction(klass, { judges: [outsider] })), /join the class first/);
  assert.equal((await act.saveDemoDayAction(klass, { date: "2027-02-12", start: "15:00", place: "Hall B", judges: [judge!, mentor!], order: [lumen, kite] })).success, true);
  const d = await act.readDemoDayAction(klass);
  assert.ok(d.success);
  assert.deepEqual(d.show.map((s) => [s.title, s.at]), [["Team Lumen", "15:10"], ["Team Kite", "15:18"]]);
  assert.deepEqual(await act.advanceRunAction(klass), { success: true, current: 0 });

  // Judging: the mentor can't judge their mentee's team; feedback is 1–5 with a note; tokens never judge.
  viewerId = mentor!;
  assert.match(err(await act.saveFeedbackAction(klass, kite, { scores: { problem: 4 } })), /own teams/);
  assert.match(err(await act.pickAwardAction(klass, "Best project", kite)), /own teams/);
  assert.equal((await act.saveFeedbackAction(klass, lumen, { scores: { problem: 4, build: 3 }, note: "Tighten the demo" })).success, true);
  viewerId = judge!;
  token = "agent";
  assert.equal((await act.saveFeedbackAction(klass, kite, { scores: { demo: 5 } })).success, false);
  token = null;
  assert.match(err(await act.saveFeedbackAction(klass, kite, { scores: { demo: 9 } })), /1 to 5/);
  assert.equal((await act.saveFeedbackAction(klass, kite, { scores: { problem: 5, build: 4, demo: 5 }, note: "Great live demo" })).success, true);
  assert.equal((await act.pickAwardAction(klass, "Best project", kite)).success, true);
  viewerId = learnerB!;
  assert.equal((await act.saveFeedbackAction(klass, kite, { scores: { demo: 1 } })).success, false, "only judges judge");
  const learnerView = await act.readDemoDayAction(klass);
  assert.ok(learnerView.success && learnerView.judging === null && learnerView.setup === null);

  // Staff see the picks and announce; everyone sees the announced award.
  viewerId = teacher!;
  const staff = await act.readDemoDayAction(klass);
  assert.ok(staff.success && staff.setup);
  assert.deepEqual(staff.setup.picks.find((p) => p.award === "Best project")?.picks.map((p) => [p.team, p.n]), [["Team Kite", 1]]);
  assert.equal((await act.announceAwardAction(klass, "Best project", kite)).success, true);
  viewerId = learnerB!;
  const after1 = await act.readDemoDayAction(klass);
  assert.ok(after1.success);
  assert.deepEqual(after1.announced, [{ award: "Best project", team: "Team Kite" }]);

  // The team reads its feedback; another team can't.
  viewerId = learnerA!;
  const fb = await act.readTeamFeedbackAction(kite);
  assert.ok(fb.success);
  assert.deepEqual(fb.feedback.map((f) => f.note), ["Great live demo"]);
  viewerId = learnerB!;
  assert.equal((await act.readTeamFeedbackAction(kite)).success, false);
});
