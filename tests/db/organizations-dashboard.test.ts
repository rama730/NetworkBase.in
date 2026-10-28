import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.18" }) });

let dash: typeof import("../../src/app/actions/org-dashboard");
let recent: typeof import("../../src/app/actions/project/recent-activity");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  const viewer = () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true });
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => viewer(),
    getViewerIdentityContext: async () => ({ ...viewer(), profile: null }),
  });
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  recent = await loadAppModule(() => import("../../src/app/actions/project/recent-activity"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) {
    await sql`DELETE FROM role_applications WHERE project_id = ${id}`;
    await sql`DELETE FROM projects WHERE id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const orgId = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public", publicTabVisibility: { sprints: false } }));
  await sql`INSERT INTO project_members (project_id, user_id, role, title, show_on_profile) VALUES (${orgId}, ${owner!}, 'owner', 'Teacher', true), (${orgId}, ${admin!}, 'admin', 'TA', false), (${orgId}, ${a!}, 'member', null, true), (${orgId}, ${b!}, 'member', null, true)`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3A' WHERE id = ${orgId}`;
  const child = await sql.begin((tx) => createProject(tx, a!, { visibility: "public" }));
  const secret = await sql.begin((tx) => createProject(tx, b!, { visibility: "private" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${a!}, 'owner'), (${secret}, ${b!}, 'owner')`;
  await sql`UPDATE projects SET parent_id = ${orgId}, title = 'Compiler Lab' WHERE id = ${child}`;
  await sql`UPDATE projects SET parent_id = ${orgId}, title = 'Secret Lab', updated_at = now() - interval '10 days' WHERE id = ${secret}`;
  created.push(orgId, child, secret);
  const [sprint] = await sql`INSERT INTO project_sprints (project_id, sprint_number, name, start_date, end_date, status) VALUES (${orgId}, 2, 'CO2', now() - interval '10 days', now() + interval '3 days', 'active') RETURNING id`;
  await sql`INSERT INTO project_sprints (project_id, sprint_number, name, start_date, end_date, status, completed_at) VALUES (${orgId}, 1, 'CO1', now() - interval '40 days', now() - interval '11 days', 'completed', now() - interval '11 days')`;
  const [master] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, sprint_id, due_date) VALUES (${orgId}, 'Lab 2', 'assignment', ${owner!}, ${sprint!.id}, now() + interval '1 day') RETURNING id`;
  const copy = async (assignee: string, extra: { status?: string; review?: string; due?: string; project?: string } = {}) => {
    const [row] = await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, sprint_id, status, review_status, due_date, review_submitted_at)
      VALUES (${extra.project ?? orgId}, 'Lab 2', 'task', ${master!.id}, ${assignee}, ${owner!}, ${extra.project ? null : sprint!.id}, ${extra.status ?? "todo"}, ${extra.review ?? "none"}, now() + ${extra.due ?? "1 day"}::interval, ${extra.review === "pending" ? sql`now()` : null}) RETURNING id`;
    return row!.id as string;
  };
  const copyA = await copy(a!, { review: "pending" });
  const copyB = await copy(b!);
  await sql`INSERT INTO task_activity_events (project_id, task_id, actor_id, event_type, payload) VALUES (${orgId}, ${copyA}, ${a!}, 'review_submitted', '{}'::jsonb)`;
  return { orgId, child, secret, sprint: sprint!.id as string, master: master!.id as string, copyA, copyB, copy, owner: owner!, admin: admin!, a: a!, b: b! };
}

async function dashboard(orgId: string, as: string) {
  viewerId = as;
  const r = await dash.readOrgDashboardAction(orgId);
  assert.equal(r.success, true, JSON.stringify(r));
  return r.success ? r : null;
}

test("Needs you: admins see reviews and requests; members their own due and returned work; leads their group copies", async () => {
  const o = await org();
  const applicant = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO role_applications (project_id, applicant_id, creator_id, status) VALUES (${o.orgId}, ${applicant}, ${o.owner}, 'pending')`;
  await sql`UPDATE project_sprints SET end_date = now() - interval '1 hour' WHERE id = ${o.sprint}`;
  const admin = await dashboard(o.orgId, o.admin);
  assert.deepEqual(admin!.needsYou.map((n) => n.label), ["1 submission to review · Lab 2", "1 join request", "CO2 ended · Complete it?"]);

  await o.copy(o.b, { review: "rejected", status: "in_progress", due: "5 days" });
  await o.copy(o.b, { due: "-2 days" });
  const member = await dashboard(o.orgId, o.b);
  // b also leads Secret Lab, which has no sprint inside the active CO2 (report §26 C).
  assert.deepEqual(member!.needsYou.map((n) => n.label).sort(), ["CO2 started. Plan your sprint in Secret Lab", "Lab 2 · due soon", "Lab 2 · overdue", "Lab 2 · returned"].sort());

  await o.copy(o.a, { project: o.child });
  const lead = await dashboard(o.orgId, o.a);
  assert.ok(lead!.needsYou.some((n) => n.label === "Compiler Lab · Lab 2 for the project"), JSON.stringify(lead!.needsYou));
});

test("This sprint and Coming up: admins see counts, members their own status", async () => {
  const o = await org();
  const admin = await dashboard(o.orgId, o.admin);
  assert.equal(admin!.thisSprint.sprint?.name, "CO2");
  assert.deepEqual(admin!.thisSprint.items.map((i) => [i.title, i.counts]), [["Lab 2", { done: 0, total: 2, missing: 0 }]]);
  const member = await dashboard(o.orgId, o.a);
  assert.deepEqual(member!.thisSprint.items.map((i) => [i.title, i.own?.state]), [["Lab 2", "submitted"]]);
  assert.ok(member!.comingUp.some((c) => c.label === "CO2 ends"));
});

test("activity privacy: members never see other people's submissions; admins do", async () => {
  const o = await org();
  const admin = await dashboard(o.orgId, o.admin);
  assert.ok(admin!.activity.some((e) => e.kind === "submission"));
  const other = await dashboard(o.orgId, o.b);
  assert.ok(!other!.activity.some((e) => e.kind === "submission"), JSON.stringify(other!.activity));
  assert.ok(other!.activity.some((e) => e.kind === "sprint"));
  const own = await dashboard(o.orgId, o.a);
  assert.ok(own!.activity.some((e) => e.kind === "submission"), "their own submission");
});

test("recent activity on an org follows the copy and folder rules", async () => {
  const o = await org();
  await sql`INSERT INTO task_activity_events (project_id, task_id, actor_id, event_type, payload) VALUES (${o.orgId}, ${o.copyA}, ${o.a}, 'status_changed', '{"to": "done"}'::jsonb)`;
  const [staff] = await sql`INSERT INTO project_nodes (project_id, path, type, name, metadata) VALUES (${o.orgId}, '/Staff', 'folder', 'Staff', '{"access": "admins"}'::jsonb) RETURNING id`;
  const [key] = await sql`INSERT INTO project_nodes (project_id, parent_id, path, type, name) VALUES (${o.orgId}, ${staff!.id}, '/Staff/answer-key.pdf', 'file', 'answer-key.pdf') RETURNING id`;
  await sql`INSERT INTO project_node_events (project_id, node_id, actor_id, type) VALUES (${o.orgId}, ${key!.id}, ${o.owner}, 'create_file')`;
  viewerId = o.b;
  const items = await recent.readProjectRecentActivityAction(o.orgId);
  assert.ok(!items.some((i) => i.text.includes("answer-key") || i.type === "task"), JSON.stringify(items));
  viewerId = o.admin;
  const adminItems = await recent.readProjectRecentActivityAction(o.orgId);
  assert.ok(adminItems.some((i) => i.text.includes("answer-key")));
});

test("Projects tab: admins see Private projects and Needs attention; members don't see others' Private projects", async () => {
  const o = await org();
  for (let i = 0; i < 3; i += 1) await sql`INSERT INTO tasks (project_id, title, creator_id, due_date, status) VALUES (${o.child}, ${`Task ${i}`}, ${o.a}, now() - interval '2 days', 'todo')`;
  viewerId = o.admin;
  const all = await dash.readOrgProjectsAction(o.orgId);
  assert.equal(all.success, true);
  if (all.success) {
    assert.deepEqual(all.rows.map((r) => r.title).sort(), ["Compiler Lab", "Secret Lab"]);
    const lab = all.rows.find((r) => r.title === "Compiler Lab")!;
    assert.deepEqual([lab.open, lab.overdue, lab.reasons.includes("3 overdue")], [3, 3, true]);
    assert.ok(all.rows.find((r) => r.title === "Secret Lab")!.reasons.includes("quiet 7 days"));
    assert.equal(all.summary.attention, 2);
  }
  viewerId = o.a;
  const mine = await dash.readOrgProjectsAction(o.orgId);
  assert.deepEqual(mine.success ? mine.rows.map((r) => [r.title, r.mine]) : [], [["Compiler Lab", true]]);
});

test("About: visitors get public projects, show-on-profile leaders and no Journey unless Sprints are public", async () => {
  const o = await org();
  viewerId = "";
  const visitor = await dash.readOrgAboutAction(o.orgId);
  assert.equal(visitor.success, true, JSON.stringify(visitor));
  if (visitor.success) {
    assert.deepEqual(visitor.projects.map((p) => p.title), ["Compiler Lab"]);
    assert.deepEqual(visitor.leaders.map((l) => l.title), ["Teacher"], "the TA hid themself from the profile");
    assert.equal(visitor.journey, null);
    assert.ok(visitor.activity.every((e) => ["sprint", "project", "joins", "announcement"].includes(e.kind)));
  }
  viewerId = o.b;
  const member = await dash.readOrgAboutAction(o.orgId);
  if (member.success) {
    assert.deepEqual(member.journey?.stages, ["CO1", "CO2"]);
    assert.equal(member.journey?.currentIndex, 1);
    assert.equal(member.leaders.length, 2);
    assert.equal(member.card.kind, "member");
  }
});

test("a child project's org line: the org, its current sprint and the project's due group work", async () => {
  const o = await org();
  await o.copy(o.a, { project: o.child, due: "2 days" });
  viewerId = o.a;
  const line = await dash.readChildOrgLineAction(o.child);
  assert.deepEqual(line && { org: line.orgTitle, sprint: line.sprint?.name, due: line.dueCount }, { org: "CSE-3A", sprint: "CO2", due: 1 });
});
