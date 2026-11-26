import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.1a (report 35.2 calls 1, 2, 7): People by position, Reach the PI and Settings → Lab. Positions never change permissions.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.247" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let lab: typeof import("../../src/app/actions/lab");
let access: typeof import("../../src/lib/data/workspace-access");
let onb: typeof import("../../src/app/actions/company-onboarding");
let docs: typeof import("../../src/app/actions/org-docs");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  lab = await loadAppModule(() => import("../../src/app/actions/lab"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  onb = await loadAppModule(() => import("../../src/app/actions/company-onboarding"));
  docs = await loadAppModule(() => import("../../src/app/actions/org-docs"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.2: People by position for members (never viewers); the PI sets positions; a position is never a permission", async () => {
  const [pi, researcher, student, viewer] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "private" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${researcher!}, 'admin'), (${org}, ${student!}, 'member'), (${org}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active' WHERE id = ${org}`;
  const thesis = await sql.begin((tx) => createProject(tx, student!, { visibility: "private" }));
  await sql`UPDATE workspaces SET parent_id = ${org}, title = 'Thesis' WHERE id = ${thesis}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${thesis}, ${student!}, 'owner') ON CONFLICT DO NOTHING`;

  viewerId = viewer!;
  assert.equal((await lab.readLabPeopleAction(org)).success, false, "viewers don't read People");
  viewerId = student!;
  assert.equal((await lab.setLabPositionAction(org, student!, { position: "pi", startYear: 2024 })).success, false, "members don't set positions, not even their own");
  viewerId = researcher!;
  assert.equal((await lab.setLabPositionAction(org, student!, { position: "boss", startYear: 2024 })).success, false, "one of the lab's positions");
  assert.ok((await lab.setLabPositionAction(org, student!, { position: "pi", startYear: 2024 })).success);
  const before = await access.getWorkspaceAccessById(org, student!);
  assert.equal(before.memberRole, "member", "the label 'PI' never makes someone an admin");
  assert.ok(!before.isOwner);

  viewerId = student!;
  const people = await lab.readLabPeopleAction(org);
  assert.ok(people.success && !people.admin);
  const me = people.success ? people.people.find((p) => p.id === student!) : null;
  assert.deepEqual([me?.position, me?.startYear, me?.role, me?.workspaces.map((w) => w.title)], ["pi", 2024, "member", ["Thesis"]]);
  assert.ok(people.success && !people.people.some((p) => p.id === viewer!), "viewers aren't listed");

  const home = await lab.readLabHomeAction(org);
  assert.ok(home.success && home.contact?.id === pi! && home.people === 3 && home.projects === 1);
  viewerId = pi!;
  const base = await lab.readLabSettingsAction(org);
  assert.ok(base.success);
  const s = base.success ? base.settings : null;
  assert.equal((await lab.saveLabSettingsAction(org, { ...s, officeHours: "write to pi@lab.edu" })).success, false, "no email in office hours");
  assert.equal((await lab.saveLabSettingsAction(org, { ...s, contactId: student! })).success, false, "Reach the PI goes to the PI or a Researcher");
  assert.ok((await lab.saveLabSettingsAction(org, { ...s, contactId: researcher!, officeHours: "Thu 15:00, room 204" })).success);
  viewerId = student!;
  const home2 = await lab.readLabHomeAction(org);
  assert.ok(home2.success && home2.contact?.id === researcher! && home2.officeHours === "Thu 15:00, room 204");
  assert.equal((await lab.readLabSettingsAction(org)).success, false, "Settings → Lab is for the PI and Researchers");

  // Review: a private workspace shows only to the PI, Researchers and its own members.
  await sql`UPDATE workspaces SET visibility = 'private' WHERE id = ${thesis}`;
  viewerId = viewer!;
  await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${org} AND user_id = ${viewer!}`;
  let p2 = await lab.readLabPeopleAction(org);
  assert.ok(p2.success && p2.people.find((p) => p.id === student!)!.workspaces.length === 0, "a member doesn't see someone's private workspace");
  viewerId = researcher!;
  p2 = await lab.readLabPeopleAction(org);
  assert.ok(p2.success && p2.people.find((p) => p.id === student!)!.workspaces.length === 1);
  // Review: the chosen contact stops being a Researcher → Reach the PI falls back to the PI, and settings still save.
  await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${org} AND user_id = ${researcher!}`;
  viewerId = student!;
  const home3 = await lab.readLabHomeAction(org);
  assert.ok(home3.success && home3.contact?.id === pi! && home3.people === 4);
  viewerId = pi!;
  const s2 = await lab.readLabSettingsAction(org);
  assert.ok(s2.success && s2.settings.contactId === null);
  assert.ok((await lab.saveLabSettingsAction(org, s2.success ? s2.settings : null)).success);
});

test("B6.1b: a lab's New people plan is on by default with the Supervisor; Safety pages are Required reading", async () => {
  const [pi, researcher, student, early] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "private" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active', created_at = now() - interval '1 day' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${org}, ${pi!}, 'owner', now() - interval '1 day'), (${org}, ${researcher!}, 'admin', now()),
    (${org}, ${student!}, 'member', now()), (${org}, ${early!}, 'member', now() - interval '2 days')`;
  viewerId = researcher!;
  assert.ok((await lab.setLabSupervisorAction(org, student!, researcher!)).success);
  assert.equal((await lab.setLabSupervisorAction(org, student!, early!)).success, false, "a supervisor is the PI or a Researcher");
  viewerId = student!;
  const start = await onb.readStartHereAction(org);
  assert.ok(start.success && start.lab && start.onboarding, "on by default for a lab");
  const steps = start.success ? start.onboarding!.steps : [];
  assert.ok(steps.some((s) => s.stepId === "safety" && s.mine));
  const [sup] = await sql`SELECT assignee_id FROM tasks WHERE workspace_id = ${org} AND title LIKE 'First supervision meeting with%'`;
  assert.equal(sup!.assignee_id, researcher!, "the supervisor gets the supervision step");
  viewerId = early!;
  const before = await onb.readStartHereAction(org);
  assert.ok(before.success && before.onboarding === null, "never for people who were there before the lab began");
  viewerId = pi!;
  const plan = await onb.readOnboardingPlanAction(org);
  assert.ok(plan.success && plan.on && plan.plan.some((s) => s.id === "first-supervision"));
  assert.ok((await onb.saveOnboardingPlanAction(org, { plan: plan.success ? plan.plan : [], on: false })).success);
  const off = await onb.readOnboardingPlanAction(org);
  assert.ok(off.success && !off.on, "the PI can switch it off");

  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${org}, 'lab-safety', 'Lab safety.md', '{}'::jsonb) RETURNING id`;
  assert.ok((await docs.updateOrgDocOptionsAction(org, d!.id, { group: "safety" })).success);
  const [st] = await sql`SELECT settings->'org'->>'required' AS required, settings->'org'->>'group' AS grp FROM workspace_documents WHERE id = ${d!.id}`;
  assert.deepEqual([st!.grp, st!.required], ["safety", "true"]);
});
