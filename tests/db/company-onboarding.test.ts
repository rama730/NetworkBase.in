import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B4.4 (report 33.5): onboarding — only people who join after the plan is on; steps for the person, their line
// manager and their buddy, due from the start date; seen only by the person, line manager, buddy and admins.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.237" }) });

let onb: typeof import("../../src/app/actions/company-onboarding");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  onb = await loadAppModule(() => import("../../src/app/actions/company-onboarding"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("33.5: existing members never get steps; a new person's steps go to them, their line manager and buddy; start date moves open steps", async () => {
  const [owner, manager, oldTimer, newbie, buddy, other] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${owner!}, 'owner', now() - interval '1 year'), (${id}, ${manager!}, 'member', now() - interval '1 year'),
    (${id}, ${oldTimer!}, 'member', now() - interval '30 days'), (${id}, ${buddy!}, 'member', now() - interval '1 year'), (${id}, ${other!}, 'member', now() - interval '1 year')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()}, org_settings = ${sql.json({ staffGrowth: { reportsTo: { [newbie!]: manager! } } })} WHERE id = ${id}`;
  viewerId = manager!;
  assert.equal((await onb.readOnboardingPlanAction(id)).success, false, "admins edit the plan");
  viewerId = owner!;
  const plan = await onb.readOnboardingPlanAction(id);
  assert.ok(plan.success && !plan.on && plan.plan.length === 5, "the starter plan, off");
  assert.equal((await onb.saveOnboardingPlanAction(id, { plan: plan.plan, on: true })).success, true);

  viewerId = oldTimer!;
  const old = await onb.readStartHereAction(id);
  assert.ok(old.success && old.onboarding === null, "people already here never get steps");
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${newbie!}, 'member', now())`;
  viewerId = newbie!;
  const start = await onb.readStartHereAction(id);
  assert.ok(start.success && start.onboarding);
  assert.equal(start.onboarding.day, "Day 1");
  const tasks = await sql`SELECT title, assignee_id FROM tasks WHERE workspace_id = ${id} ORDER BY due_date, title`;
  assert.equal(tasks.length, 4, "the buddy's step waits for a buddy");
  assert.ok(tasks.some((t) => t.assignee_id === manager! && /First check-in with/.test(String(t.title))), "the line manager's step names the new person");
  const again = await onb.readStartHereAction(id);
  assert.ok(again.success);
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${id}`)[0]!.n, 4, "never made twice");

  viewerId = other!;
  assert.equal((await onb.readOnboardingBoardAction(id)).success, false, "other members don't see it");
  assert.equal((await onb.setBuddyAction(id, newbie!, buddy!)).success, false);
  viewerId = manager!;
  assert.equal((await onb.setBuddyAction(id, newbie!, buddy!)).success, true, "the line manager picks the buddy");
  const lunch = await sql`SELECT assignee_id FROM tasks WHERE workspace_id = ${id} AND title LIKE 'Lunch with %'`;
  assert.equal(lunch[0]?.assignee_id, buddy!);
  viewerId = newbie!;
  assert.equal((await onb.answerHowsItGoingAction(id, "Good so far, the team is kind")).success, true);
  viewerId = buddy!;
  const asBuddy = await onb.readOnboardingBoardAction(id);
  assert.ok(asBuddy.success);
  assert.equal(asBuddy.people[0]?.answer, null, "How's it going? is for the line manager and admins");
  viewerId = manager!;
  const asManager = await onb.readOnboardingBoardAction(id);
  assert.ok(asManager.success);
  assert.equal(asManager.people[0]?.answer, "Good so far, the team is kind");
  viewerId = owner!;
  const plus7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await onb.setOnboardingStartAction(id, newbie!, plus7)).success, true);
  const moved = await sql`SELECT due_date::date::text AS due, status FROM tasks WHERE workspace_id = ${id} AND title = 'Read the Handbook: Overview'`;
  assert.equal(moved[0]?.due, plus7, "open steps move with the start date");
  const answered = await sql`SELECT status FROM tasks WHERE workspace_id = ${id} AND title = 'How’s it going?'`;
  assert.equal(answered[0]?.status, "done", "answering ticks the step");
});
