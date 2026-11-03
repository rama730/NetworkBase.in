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
let recent: typeof import("../../src/app/actions/workspace/recent-activity");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  const viewer = () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true });
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => viewer(),
    getViewerIdentityContext: async () => ({ ...viewer(), profile: null }),
  });
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  recent = await loadAppModule(() => import("../../src/app/actions/workspace/recent-activity"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) {
    await sql`DELETE FROM role_applications WHERE workspace_id = ${id}`;
    await sql`DELETE FROM workspaces WHERE id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const orgId = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public", publicTabVisibility: { sprints: false } }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, title, show_on_profile) VALUES (${orgId}, ${owner!}, 'owner', 'Teacher', true), (${orgId}, ${admin!}, 'admin', 'TA', false), (${orgId}, ${a!}, 'member', null, true), (${orgId}, ${b!}, 'member', null, true)`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3A' WHERE id = ${orgId}`;
  const child = await sql.begin((tx) => createProject(tx, a!, { visibility: "public" }));
  const secret = await sql.begin((tx) => createProject(tx, b!, { visibility: "private" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${a!}, 'owner'), (${secret}, ${b!}, 'owner')`;
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = 'Compiler Lab' WHERE id = ${child}`;
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = 'Secret Lab', updated_at = now() - interval '10 days' WHERE id = ${secret}`;
  created.push(orgId, child, secret);
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status) VALUES (${orgId}, 2, 'CO2', now() - interval '10 days', now() + interval '3 days', 'active') RETURNING id`;
  await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, completed_at) VALUES (${orgId}, 1, 'CO1', now() - interval '40 days', now() - interval '11 days', 'completed', now() - interval '11 days')`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, sprint_id, due_date, assignment_settings) VALUES (${orgId}, 'Lab 2', 'assignment', ${owner!}, ${sprint!.id}, now() + interval '1 day', jsonb_build_object('publishedAt', now())) RETURNING id`;
  const copy = async (assignee: string, extra: { status?: string; review?: string; due?: string; project?: string } = {}) => {
    const [row] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, sprint_id, status, review_status, due_date, review_submitted_at)
      VALUES (${extra.project ?? orgId}, 'Lab 2', 'task', ${master!.id}, ${assignee}, ${owner!}, ${extra.project ? null : sprint!.id}, ${extra.status ?? "todo"}, ${extra.review ?? "none"}, now() + ${extra.due ?? "1 day"}::interval, ${extra.review === "pending" ? sql`now()` : null}) RETURNING id`;
    return row!.id as string;
  };
  const copyA = await copy(a!, { review: "pending" });
  const copyB = await copy(b!);
  await sql`INSERT INTO task_activity_events (workspace_id, task_id, actor_id, event_type, payload) VALUES (${orgId}, ${copyA}, ${a!}, 'review_submitted', '{}'::jsonb)`;
  return { orgId, child, secret, sprint: sprint!.id as string, master: master!.id as string, copyA, copyB, copy, owner: owner!, admin: admin!, a: a!, b: b! };
}

async function dashboard(orgId: string, as: string) {
  viewerId = as;
  const r = await dash.readOrgDashboardAction(orgId);
  assert.equal(r.success, true, JSON.stringify(r));
  return r.success ? r : null;
}

test("Needs your attentionr attention: admins see reviews and requests; members their own due and returned work; leads their group copies", async () => {
  const o = await org();
  const applicant = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${o.orgId}, ${applicant}, ${o.owner}, 'pending')`;
  await sql`UPDATE workspace_sprints SET end_date = now() - interval '1 hour' WHERE id = ${o.sprint}`;
  const admin = await dashboard(o.orgId, o.admin);
  assert.deepEqual(admin!.needsYou.map((n) => n.label), ["1 submission to review · Lab 2", "1 join request", "CO2 ended · Complete it?"]);
  // Live-fix 12: a bold title, a quiet detail line, and Approve in place for a single request.
  const [review, request] = admin!.needsYou;
  assert.deepEqual([review!.title, review!.detail?.startsWith("Lab 2 · oldest")], ["1 submission to review", true]);
  const [app] = await sql`SELECT id FROM role_applications WHERE workspace_id = ${o.orgId} AND applicant_id = ${applicant}`;
  assert.deepEqual([request!.title, request!.approveId, /ago$/.test(request!.detail ?? "")], ["1 join request", app!.id, true]);
  await sql`INSERT INTO application_events (application_id, actor_id, kind, to_status, metadata) VALUES (${app!.id}, ${applicant}, 'created', 'pending', '{"source":"org_join_code"}'::jsonb)`;
  assert.match((await dashboard(o.orgId, o.admin))!.needsYou[1]!.detail ?? "", / · via code · /, "where the request came from");

  await o.copy(o.b, { review: "rejected", status: "in_progress", due: "5 days" });
  await o.copy(o.b, { due: "-2 days" });
  const member = await dashboard(o.orgId, o.b);
  // b also leads Secret Lab, which has no sprint inside the active CO2 (report §26 C).
  assert.deepEqual(member!.needsYou.map((n) => n.label).sort(), ["CO2 started. Plan your sprint in Secret Lab", "Lab 2 · due soon", "Lab 2 · overdue", "Lab 2 · returned"].sort());

  await o.copy(o.a, { project: o.child });
  const lead = await dashboard(o.orgId, o.a);
  assert.ok(lead!.needsYou.some((n) => n.label === "Compiler Lab · Lab 2 for the workspace"), JSON.stringify(lead!.needsYou));
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

test("live-fix 13: This sprint is a card with status, goal, dates, progress and ordinary tasks too", async () => {
  const o = await org();
  await sql`UPDATE workspace_sprints SET goal = 'Arrays and linked lists' WHERE id = ${o.sprint}`;
  const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${o.orgId} AND status = 'done' LIMIT 1`;
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, workflow_column_id, sprint_id, assignee_id) VALUES (${o.orgId}, ${o.owner}, 'Prepare the rubric', 'done', ${col!.id}, ${o.sprint}, ${o.owner})`;
  const s = (await dashboard(o.orgId, o.admin))!.thisSprint;
  assert.deepEqual([s.sprint?.status, s.sprint?.goal, typeof s.sprint?.startDate], ["active", "Arrays and linked lists", "string"]);
  assert.deepEqual(s.tasks.map((t) => [t.title, t.status]), [["Prepare the rubric", "done"]]);
  assert.deepEqual(s.progress, { done: 1, total: 2 }, "the rubric is done; Lab 2 isn't");
  await sql`UPDATE workspace_sprints SET end_date = now() - interval '1 hour' WHERE id = ${o.sprint}`;
  assert.equal((await dashboard(o.orgId, o.admin))!.thisSprint.sprint?.status, "ended");
});

test("live-fix 15: This week includes ordinary task dues, with a type", async () => {
  const o = await org();
  const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${o.orgId} AND status = 'todo' LIMIT 1`;
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, workflow_column_id, due_date) VALUES (${o.orgId}, ${o.owner}, 'Print handouts', 'todo', ${col!.id}, now() + interval '1 day')`;
  const week = (await dashboard(o.orgId, o.admin))!.thisWeek;
  assert.ok(week.some((w) => w.label === "Print handouts due" && w.kind === "due"), JSON.stringify(week));
  assert.ok(week.every((w) => w.kind === "due" || w.kind === "sprint"));
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
  await sql`INSERT INTO task_activity_events (workspace_id, task_id, actor_id, event_type, payload) VALUES (${o.orgId}, ${o.copyA}, ${o.a}, 'status_changed', '{"to": "done"}'::jsonb)`;
  const [staff] = await sql`INSERT INTO workspace_nodes (workspace_id, path, type, name, metadata) VALUES (${o.orgId}, '/Staff', 'folder', 'Staff', '{"access": "admins"}'::jsonb) RETURNING id`;
  const [key] = await sql`INSERT INTO workspace_nodes (workspace_id, parent_id, path, type, name) VALUES (${o.orgId}, ${staff!.id}, '/Staff/answer-key.pdf', 'file', 'answer-key.pdf') RETURNING id`;
  await sql`INSERT INTO workspace_node_events (workspace_id, node_id, actor_id, type) VALUES (${o.orgId}, ${key!.id}, ${o.owner}, 'create_file')`;
  viewerId = o.b;
  const items = await recent.readWorkspaceRecentActivityAction(o.orgId);
  assert.ok(!items.some((i) => i.text.includes("answer-key") || i.type === "task"), JSON.stringify(items));
  viewerId = o.admin;
  const adminItems = await recent.readWorkspaceRecentActivityAction(o.orgId);
  assert.ok(adminItems.some((i) => i.text.includes("answer-key")));
});

test("Projects tab: admins see Private workspaces and Needs attention; members don't see others' Private workspaces", async () => {
  const o = await org();
  for (let i = 0; i < 3; i += 1) await sql`INSERT INTO tasks (workspace_id, title, creator_id, due_date, status) VALUES (${o.child}, ${`Task ${i}`}, ${o.a}, now() - interval '2 days', 'todo')`;
  viewerId = o.admin;
  const all = await dash.readOrgWorkspacesAction(o.orgId);
  assert.equal(all.success, true);
  if (all.success) {
    assert.deepEqual(all.rows.map((r) => r.title).sort(), ["Compiler Lab", "Secret Lab"]);
    const lab = all.rows.find((r) => r.title === "Compiler Lab")!;
    assert.deepEqual([lab.open, lab.overdue, lab.reasons.includes("3 overdue")], [3, 3, true]);
    assert.ok(all.rows.find((r) => r.title === "Secret Lab")!.reasons.includes("quiet 7 days"));
    assert.equal(all.summary.attention, 2);
  }
  viewerId = o.a;
  const mine = await dash.readOrgWorkspacesAction(o.orgId);
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

test("a child project's org line: the org, its current sprint and the workspace's due group work", async () => {
  const o = await org();
  await o.copy(o.a, { project: o.child, due: "2 days" });
  viewerId = o.a;
  const line = await dash.readChildOrgLineAction(o.child);
  assert.deepEqual(line && { org: line.orgTitle, sprint: line.sprint?.name, due: line.dueCount }, { org: "CSE-3A", sprint: "CO2", due: 1 });
});

test("§27 pass: the child Dashboard's What’s happening (group copy, own sprint inside the org sprint, lead's plan item); the archived summary line", async () => {
  const o = await org();
  await o.copy(o.a, { project: o.child });
  viewerId = o.a;
  let line = await dash.readChildOrgLineAction(o.child);
  assert.ok(line?.needsYou.some((n) => n.label === "Lab 2 for the workspace"), JSON.stringify(line));
  assert.ok(line?.needsYou.some((n) => n.label === "CO2 started. Plan your sprint in Compiler Lab"), "the lead's linked-sprint item");
  await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, parent_sprint_id) VALUES (${o.child}, 1, 'Parser week', now() - interval '1 day', now() + interval '2 days', 'active', ${o.sprint})`;
  line = await dash.readChildOrgLineAction(o.child);
  assert.deepEqual([line?.ownSprint?.name, line?.ownSprint?.parent], ["Parser week", "CO2"]);
  assert.ok(!line?.needsYou.some((n) => n.label.startsWith("CO2 started")), "planned now");

  await sql`UPDATE workspaces SET status = 'archived', term_end = '2026-12-15' WHERE id = ${o.orgId}`;
  const d = await dashboard(o.orgId, o.owner);
  assert.equal(d?.archivedSummary, "CSE-3A ended Dec 2026 · 2 sprints · 1 assignment · 4 members");
  assert.deepEqual(d?.needsYou.map((n) => n.kind), ["verify"]);
  assert.equal((await dashboard(o.orgId, o.a))?.needsYou.length, 0);
});

test("the child org line stays closed to org members who can't open the child project", async () => {
  const o = await org();
  viewerId = o.a;
  assert.equal(await dash.readChildOrgLineAction(o.secret), null, "Secret Lab is private to b");
  viewerId = o.b;
  assert.ok(await dash.readChildOrgLineAction(o.secret));
});

test("§28 pass: rows carry stage, sprint inside the org sprint and New in <org>; Remind leads tells leads what's open", async () => {
  const o = await org();
  await sql`UPDATE workspaces SET lifecycle_stages = '["Idea","Build","Ship"]'::jsonb, current_stage_index = 1, org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('movedInAt', now()) WHERE id = ${o.child}`;
  await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, parent_sprint_id) VALUES (${o.child}, 1, 'Parser week', now() - interval '1 day', now() + interval '2 days', 'active', ${o.sprint})`;
  await o.copy(o.a, { project: o.child, due: "-1 day" });
  viewerId = o.owner;
  const read = await dash.readOrgWorkspacesAction(o.orgId);
  assert.ok(read.success);
  const row = read.success ? read.rows.find((r) => r.id === o.child)! : null;
  assert.deepEqual([row?.stage, row?.sprint, row?.newInOrg], ["Build", { name: "Parser week", inOrgSprint: true }, true]);
  const reminded = await dash.remindLeadsAction(o.orgId, [o.child]);
  assert.deepEqual(reminded, { success: true, reminded: 1, skipped: 0 });
  const [note] = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.a} AND title LIKE 'CSE-3A reminded you:%'`;
  assert.ok(note, "the lead heard");
  viewerId = o.b;
  assert.equal((await dash.remindLeadsAction(o.orgId, [o.child])).success, false, "admins only");
});

test("live-fix 11: pinned shows who and when, a dot until you've read Updates, and × hides it for you only", async () => {
  const o = await org();
  await sql`UPDATE profiles SET full_name = 'Ms. Rao' WHERE id = ${o.owner}`;
  const [post] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, is_pinned) VALUES (${o.orgId}, ${o.owner}, 'Lab 1 is out. Due Sunday.', true) RETURNING id`;
  const pinned = (await dashboard(o.orgId, o.a))!.pinned!;
  assert.deepEqual([pinned.id, pinned.authorName, pinned.unread, typeof pinned.at], [post!.id, "Ms. Rao", true, "string"]);
  await sql`UPDATE workspace_members SET last_seen_updates_at = now() + interval '1 minute' WHERE workspace_id = ${o.orgId} AND user_id = ${o.a}`;
  assert.equal((await dashboard(o.orgId, o.a))!.pinned!.unread, false);

  viewerId = o.a;
  assert.deepEqual(await dash.hidePinnedForMeAction(o.orgId, post!.id), { success: true });
  assert.equal((await dashboard(o.orgId, o.a))!.pinned, null, "hidden for her");
  assert.equal((await dashboard(o.orgId, o.b))!.pinned?.id, post!.id, "still pinned for everyone else");
});

test("live-fix 17: the Overview's workspace rows count their own members and overdue work", async () => {
  const o = await org();
  const [members] = await sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${o.child}`;
  const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${o.child} AND status = 'todo' LIMIT 1`;
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, workflow_column_id, due_date) VALUES (${o.child}, ${o.a}, 'Late one', 'todo', ${col!.id}, now() - interval '2 days')`;
  const row = (await dashboard(o.orgId, o.admin))!.projects.find((p) => p.id === o.child)!;
  assert.deepEqual([row.members, row.overdue], [members!.n, 1]);
  assert.ok(row.members > 0);
});
