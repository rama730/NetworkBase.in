import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.5c (report 32.6 calls 6–8): observations are feedback (Strengths and One next step), booked with notice;
// the observed teacher reads first, then their line manager (never "just between us"); leaders see counts.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.204" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let growth: typeof import("../../src/app/actions/staff-growth");
let obs: typeof import("../../src/app/actions/staff-observations");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  growth = await loadAppModule(() => import("../../src/app/actions/staff-growth"));
  obs = await loadAppModule(() => import("../../src/app/actions/staff-observations"));
});


const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("book with notice; the observer writes after the lesson; the observed reads first, then the line manager; stale Reports to opens nothing", async () => {
  const [head, asha, ravi, guest] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const school = await sql.begin((tx) => createProject(tx, head!));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${head!}, 'owner'), (${school}, ${asha!}, 'member'), (${school}, ${ravi!}, 'member'), (${school}, ${guest!}, 'viewer')`;
  viewerId = head!;
  assert.equal((await growth.saveStaffGrowthSettingsAction(school, { reportsTo: { [asha!]: head! }, headings: ["Teaching"] })).success, true);

  viewerId = ravi!;
  assert.match((await obs.bookObservationAction(school, { observedId: ravi!, day: day(7), focus: "Questioning" }) as { error: string }).error, /colleague/);
  assert.match((await obs.bookObservationAction(school, { observedId: guest!, day: day(7), focus: "Questioning" }) as { error: string }).error, /staff/);
  assert.match((await obs.bookObservationAction(school, { observedId: asha!, day: day(0), focus: "Questioning" }) as { error: string }).error, /2 school days/);
  const booked = await obs.bookObservationAction(school, { observedId: asha!, day: day(7), focus: "Questioning" });
  assert.ok(booked.success);
  const peer = await obs.bookObservationAction(school, { observedId: asha!, day: day(8), focus: "Starters", justBetweenUs: true });
  assert.ok(peer.success);
  viewerId = guest!;
  assert.equal((await obs.readObservationsAction(school)).success, false, "Viewers aren't staff");

  viewerId = ravi!;
  assert.equal((await obs.writeObservationAction(school, booked.id, { strengths: "Wait time", nextStep: "Cold call" })).success, false, "after the lesson only");
  await sql`UPDATE staff_observations SET day = ${day(-1)}::date WHERE workspace_id = ${school}`;
  viewerId = head!;
  assert.equal((await obs.writeObservationAction(school, booked.id, { strengths: "x", nextStep: "y" })).success, false, "only the observer writes it");
  viewerId = ravi!;
  for (const id of [booked.id, peer.id]) assert.equal((await obs.writeObservationAction(school, id, { strengths: "Wait time", nextStep: "Cold call" })).success, true);

  viewerId = head!;
  let mgr = await obs.readObservationsAction(school);
  assert.ok(mgr.success);
  assert.equal(mgr.myReports.length, 0, "the observed teacher reads it first");
  assert.deepEqual(mgr.counts, { booked: 2, written: 2, read: 0 });
  viewerId = asha!;
  const mine = await obs.readObservationsAction(school);
  assert.ok(mine.success);
  assert.deepEqual(mine.ofMe.map((o) => o.strengths), [null, null].map(() => "Wait time"));
  assert.equal(mine.counts, null, "counts are for leaders");
  for (const id of [booked.id, peer.id]) assert.equal((await obs.readObservationAction(school, id)).success, true);
  assert.equal((await obs.writeObservationAction(school, booked.id, { strengths: "x", nextStep: "y" })).success, false);
  const g = await growth.readGrowthAction(school, null, day(-1).slice(0, 4));
  assert.ok(g.success);
  assert.deepEqual(g.log.map((l) => l.title).sort(), ["Observed: Questioning", "Observed: Starters"]);

  viewerId = head!;
  mgr = await obs.readObservationsAction(school);
  assert.ok(mgr.success);
  assert.deepEqual(mgr.myReports.map((o) => o.focus), ["Questioning"], "never a just-between-us one");
  viewerId = ravi!;
  const colleague = await obs.readObservationsAction(school);
  assert.ok(colleague.success);
  assert.equal(colleague.ofMe.length + colleague.myReports.length, 0);

  // Asha leaves the staff: the old Reports to opens neither her growth record nor her observations.
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${school} AND user_id = ${asha!}`;
  viewerId = head!;
  assert.equal((await growth.readGrowthAction(school, asha!, day(-1).slice(0, 4))).success, false);
  mgr = await obs.readObservationsAction(school);
  assert.ok(mgr.success);
  assert.equal(mgr.myReports.length, 0);
});
