import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.5c (report 35.6): the annual review (no rating field; committee access ends when agreed), the development plan (the
// person and their supervisors), concerns (never to the person they're about), the PI's counts.
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
let rv: typeof import("../../src/app/actions/lab-reviews");
let pg: typeof import("../../src/app/actions/lab-progress");
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
  pg = await loadAppModule(() => import("../../src/app/actions/lab-progress"));
  rv = await loadAppModule(() => import("../../src/app/actions/lab-reviews"));
  lab = await loadAppModule(() => import("../../src/app/actions/lab"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.6 annual review, plan, concerns, counts", async () => {
  const [pi, rao, mei, ext, other] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "public" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, view_prefs) VALUES (${org}, ${pi!}, 'owner', '{}'::jsonb), (${org}, ${rao!}, 'admin', '{}'::jsonb),
    (${org}, ${mei!}, 'member', ${sql.json({ lab: { position: "phd", startYear: 2024 } })}), (${org}, ${ext!}, 'viewer', '{}'::jsonb), (${org}, ${other!}, 'member', '{}'::jsonb)`;
  await sql`UPDATE workspaces SET org_settings = ${sql.json({ staffGrowth: { reportsTo: { [mei!]: rao! } } })} WHERE id = ${org}`;
  viewerId = rao!;
  assert.ok((await pg.setProgressAction(org, mei!, { startDate: "2024-09-01", partTime: false, coSupervisorId: null, weeks: 2 })).success);

  // The annual review: Mei writes and hands in; Rao sends it to a committee (ext is a Viewer); ext comments; Rao agrees.
  viewerId = mei!;
  assert.match(String((await rv.saveProgressReportAction(org, "annual-review-1", { did: "", outputs: "", trainings: "", plan: "", worries: "" }, true) as { error?: string }).error), /what you did/);
  assert.ok((await rv.saveProgressReportAction(org, "annual-review-1", { did: "Ran 7 experiments", outputs: "", trainings: "", plan: "Write chapter 3", worries: "GPU time" }, true)).success);
  assert.match(String((await rv.saveProgressReportAction(org, "annual-review-1", { did: "edit", outputs: "", trainings: "", plan: "", worries: "" }, false) as { error?: string }).error), /with your supervisor/);
  viewerId = other!;
  assert.equal((await rv.readReviewAction(org, mei!, "annual-review-1")).success, false, "other members never read it");
  viewerId = ext!;
  assert.equal((await rv.readReviewAction(org, mei!, "annual-review-1")).success, false, "the committee only once it's with them");
  viewerId = rao!;
  assert.ok((await rv.decideReviewAction(org, mei!, "annual-review-1", { feedback: "Strong year", committeeIds: [ext!], nextSteps: "" })).success);
  viewerId = ext!;
  const asCommittee = await rv.readReviewAction(org, mei!, "annual-review-1");
  assert.ok(asCommittee.success && asCommittee.committee && asCommittee.review?.report.did === "Ran 7 experiments");
  assert.ok((await rv.commentReviewAction(org, mei!, "annual-review-1", "Agree; add a timeline")).success);
  viewerId = rao!;
  assert.ok((await rv.decideReviewAction(org, mei!, "annual-review-1", { feedback: "Strong year", committeeIds: [], nextSteps: "Chapter 3 by June" })).success);
  viewerId = ext!;
  assert.equal((await rv.readReviewAction(org, mei!, "annual-review-1")).success, false, "committee access ends when the review is agreed");
  assert.equal((await rv.commentReviewAction(org, mei!, "annual-review-1", "late")).success, false);
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'lab_reviews'`;
  assert.ok(!cols.some((c) => /rating|score|rank|grade/.test(String(c.column_name))), "no rating or score field exists on reviews");
  const [ms] = await sql`SELECT state FROM lab_milestones WHERE org_id = ${org} AND user_id = ${mei!} AND key = 'annual-review-1'`;
  assert.equal(ms!.state, "done");

  // The plan: Mei writes it; Rao reads it; others can't.
  viewerId = mei!;
  assert.equal((await rv.savePlanAction(org, { year: 2026, goals: ["a", "b", "c", "d"], careerAims: "", aboutMe: "" })).success, false, "up to 3 goals");
  assert.ok((await rv.savePlanAction(org, { year: 2026, goals: ["Publish at CVPR"], careerAims: "Faculty", aboutMe: "" })).success);
  viewerId = rao!;
  const plan = await rv.readPlanAction(org, mei!, 2026);
  assert.ok(plan.success && plan.plan?.careerAims === "Faculty");
  viewerId = other!;
  assert.equal((await rv.readPlanAction(org, mei!, 2026)).success, false);

  // Concerns: about the PI never to the PI; private to the receiver.
  viewerId = mei!;
  const box = await rv.readConcernsAction(org);
  assert.ok(box.success && box.receivers.some((r) => r.id === pi!) && box.receivers.some((r) => r.id === rao!));
  assert.match(String((await rv.raiseConcernAction(org, { to: pi!, about: pi!, body: "x" }) as { error?: string }).error), /never goes to the person/);
  assert.equal((await rv.raiseConcernAction(org, { to: other!, about: null, body: "x" })).success, false, "only to a supervisor, the PI or the institution");
  assert.ok((await rv.raiseConcernAction(org, { to: rao!, about: pi!, body: "The PI asks for weekend work" })).success);
  viewerId = pi!;
  const piBox = await rv.readConcernsAction(org);
  assert.ok(piBox.success && piBox.received.length === 0, "the PI never sees a concern about them");
  viewerId = rao!;
  const raoBox = await rv.readConcernsAction(org);
  assert.ok(raoBox.success && raoBox.received.length === 1 && raoBox.received[0]!.about !== null);

  // The PI's counts: numbers; lists open on click; only for the PI.
  viewerId = pi!;
  const counts = await rv.readLabCountsAction(org);
  assert.ok(counts.success && counts.list === null && counts.counts.gaps === 1, "Mei has had no supervision note in 4 weeks");
  const opened = await rv.readLabCountsAction(org, "gaps");
  assert.ok(opened.success && opened.list?.[0]?.line === "no supervision yet");
  viewerId = rao!;
  assert.equal((await rv.readLabCountsAction(org)).success, false);
});
