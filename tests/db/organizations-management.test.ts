import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 9c (report §19.1, §27.4, §27.5, §42.7 S7, §45.2, §45.7; decisions 29, 132, 170): Settings → Management.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => ({ storage: { from: () => ({ copy: async () => ({ error: null }) }) } }),
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.93" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
moduleStubs.set("@/lib/security/step-up", { resolveSecurityStepUp: async () => ({ ok: true, payload: { method: "test" } }) });

let lifecycle: typeof import("../../src/app/actions/org-lifecycle");
let lifecycleLib: typeof import("../../src/lib/organizations/lifecycle");
let orgs: typeof import("../../src/app/actions/organizations");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  lifecycle = await loadAppModule(() => import("../../src/app/actions/org-lifecycle"));
  lifecycleLib = await loadAppModule(() => import("../../src/lib/organizations/lifecycle"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, admin2, member] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  const handle = `cse-${Math.random().toString(36).slice(2, 8)}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${admin2!}, 'admin'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', slug = ${handle}, join_code = ${generateJoinCode()} WHERE id = ${id}`;
  created.push(id);
  return { id, handle, owner: owner!, admin: admin!, admin2: admin2!, member: member! };
}

async function child(orgId: string, lead: string, title: string) {
  const id = await sql.begin((tx) => createProject(tx, lead, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${lead}, 'owner')`;
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = ${title} WHERE id = ${id}`;
  created.push(id);
  return id;
}

test("19.1, decision 29: Delete chooses per workspace; someone else's is always kept; the owner can invite them back after Restore", async () => {
  const o = await org();
  const mineKept = await child(o.id, o.owner, "Staff room");
  const mineGone = await child(o.id, o.owner, "Scratch");
  const theirs = await child(o.id, o.member, "Team Falcon");
  viewerId = o.owner;
  const preview = await lifecycle.readOrgLifecyclePreviewAction(o.id);
  assert.ok(preview.success);
  const rows = preview.success ? preview.preview.childProjects : [];
  assert.deepEqual(rows.map((r) => [r.title, r.mine]).sort(), [["Scratch", true], ["Staff room", true], ["Team Falcon", false]]);
  const r = await lifecycle.deleteOrgAction(o.id, { confirmHandle: o.handle, choices: { [mineKept]: "keep", [mineGone]: "delete", [theirs]: "delete" } });
  assert.equal(r.success, true, JSON.stringify(r));
  const state = async (id: string) => (await sql`SELECT parent_id, visibility, deletion_scheduled_at FROM workspaces WHERE id = ${id}`)[0]!;
  assert.deepEqual([(await state(mineKept)).parent_id, (await state(mineKept)).visibility], [null, "private"]);
  assert.ok((await state(mineGone)).deletion_scheduled_at, "the owner's own, chosen for deletion");
  assert.deepEqual([(await state(theirs)).parent_id, (await state(theirs)).deletion_scheduled_at], [null, null], "never someone else's");

  assert.equal((await lifecycle.restoreOrgAction(o.id)).success, true);
  const restored = await lifecycle.readOrgLifecyclePreviewAction(o.id);
  assert.deepEqual(restored.success && restored.preview.detached.map((d) => d.title).sort(), ["Staff room", "Team Falcon"]);
  assert.equal((await lifecycle.inviteBackAction(o.id, theirs)).success, true);
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.member} AND title LIKE 'CSE 3B invited Team Falcon back%'`;
  assert.ok(notice, "the lead is told");
  viewerId = o.member;
  assert.deepEqual(await orgs.moveWorkspaceToOrgAction(theirs, o.id), { success: true, outcome: "moved" }, "one click, no admin approval");
});

test("27.5, 45.7: Archive shows what's waiting for review and each assignment's Download all", async () => {
  const o = await org();
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, assignment_id, assignee_id, creator_id, review_status) VALUES (${o.id}, 'Lab 1', ${master!.id}, ${o.member}, ${o.owner}, 'pending') RETURNING id`;
  await sql`INSERT INTO workspace_nodes (workspace_id, path, type, name, task_id) VALUES (${o.id}, ${`/.system/tasks/${copy!.id}/a.pdf`}, 'file', 'a.pdf', ${copy!.id})`;
  viewerId = o.owner;
  const r = await lifecycle.readOrgLifecyclePreviewAction(o.id);
  assert.ok(r.success);
  assert.deepEqual(r.success && [r.preview.waitingReviews, r.preview.assignments], [1, [{ id: master!.id, title: "Lab 1" }]]);
});

test("smaller bug 7, decision 132: Duplicate brings an assignment's own files and links, and sprint materials", async () => {
  const o = await org();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status, sprint_number) VALUES (${o.id}, 'CO1', now(), now() + interval '7 days', 'planning', 1) RETURNING id`;
  const [notes] = await sql`INSERT INTO workspace_nodes (workspace_id, path, type, name, size) VALUES (${o.id}, '/notes.pdf', 'file', 'notes.pdf', 10) RETURNING id`;
  await sql`INSERT INTO sprint_materials (sprint_id, node_id) VALUES (${sprint!.id}, ${notes!.id})`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date, sprint_id, assignment_settings) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}, now(), ${sprint!.id}, '{"target":{"kind":"everyone"},"lateRule":"none"}'::jsonb) RETURNING id`;
  await sql`INSERT INTO workspace_nodes (workspace_id, path, type, name, task_id, size) VALUES (${o.id}, ${`/.system/tasks/${master!.id}/brief.pdf`}, 'file', 'brief.pdf', ${master!.id}, 5)`;
  await sql`INSERT INTO task_node_links (task_id, node_id) VALUES (${master!.id}, ${notes!.id})`;
  const newId = await lifecycleLib.duplicateOrg(o.id, o.owner, { title: "CSE 3B 2027", handle: `${o.handle}-27`, termStart: null, copy: { about: true, docs: false, files: true, sprints: true, assignments: true, channels: false, admins: false } });
  created.push(newId);
  const [newMaster] = await sql`SELECT id FROM tasks WHERE workspace_id = ${newId} AND kind = 'assignment'`;
  assert.deepEqual((await sql`SELECT name FROM workspace_nodes WHERE task_id = ${newMaster!.id}`).map((r) => r.name), ["brief.pdf"]);
  assert.deepEqual((await sql`SELECT n.name FROM task_node_links l JOIN workspace_nodes n ON n.id = l.node_id WHERE l.task_id = ${newMaster!.id}`).map((r) => r.name), ["notes.pdf"]);
  assert.deepEqual((await sql`SELECT n.name FROM sprint_materials m JOIN workspace_sprints s ON s.id = m.sprint_id JOIN workspace_nodes n ON n.id = m.node_id WHERE s.workspace_id = ${newId}`).map((r) => r.name), ["notes.pdf"]);
});

test("45.2, decision 170: an admin asks to take over after 30 days away; the owner can refuse; after 7 days the admin takes over", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.equal((await lifecycle.readTakeoverAction(o.id)).success && (await lifecycle.readTakeoverAction(o.id) as { state: string }).state, "hidden", "an owner active here hides it");
  await sql`UPDATE workspace_members SET last_active_here_at = now() - interval '40 days' WHERE workspace_id = ${o.id} AND user_id = ${o.owner}`;
  assert.equal((await lifecycle.askToTakeOverAction(o.id)).success, true);
  viewerId = o.admin2;
  assert.deepEqual(await lifecycle.askToTakeOverAction(o.id), { success: false, error: "Someone has already asked. One request at a time." });
  viewerId = o.owner;
  assert.equal((await lifecycle.refuseTakeoverAction(o.id)).success, true);
  viewerId = o.admin;
  assert.equal((await lifecycle.askToTakeOverAction(o.id)).success, true);
  assert.deepEqual(await lifecycle.takeOverNowAction(o.id), { success: false, error: "The owner has 7 days to refuse." });
  await sql`UPDATE workspaces SET takeover_requested_at = now() - interval '8 days' WHERE id = ${o.id}`;
  assert.equal((await lifecycle.takeOverNowAction(o.id)).success, true);
  const [row] = await sql`SELECT owner_id, takeover_requested_by FROM workspaces WHERE id = ${o.id}`;
  assert.deepEqual([row!.owner_id, row!.takeover_requested_by], [o.admin, null]);
  const roles = await sql`SELECT user_id, role FROM workspace_members WHERE workspace_id = ${o.id} AND user_id IN (${o.owner}, ${o.admin})`;
  assert.deepEqual(Object.fromEntries(roles.map((r) => [r.user_id, r.role])), { [o.owner]: "admin", [o.admin]: "owner" });
});

test("45.2 (security review): take-over refuses a suspended organization or a demoted asker, and a new owner ends the request", async () => {
  const o = await org();
  await sql`UPDATE workspace_members SET last_active_here_at = now() - interval '40 days' WHERE workspace_id = ${o.id} AND user_id = ${o.owner}`;
  viewerId = o.admin;
  assert.equal((await lifecycle.askToTakeOverAction(o.id)).success, true);
  await sql`UPDATE workspaces SET takeover_requested_at = now() - interval '8 days', suspended_at = now() WHERE id = ${o.id}`;
  assert.equal((await lifecycle.takeOverNowAction(o.id)).success, false, "suspended");
  await sql`UPDATE workspaces SET suspended_at = NULL WHERE id = ${o.id}`;
  await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${o.id} AND user_id = ${o.admin}`;
  assert.equal((await lifecycleLib.takeOverOrg(o.id, o.admin, null) as { ok?: boolean }).ok, undefined, "no longer an admin");
  const [still] = await sql`SELECT owner_id FROM workspaces WHERE id = ${o.id}`;
  assert.equal(still!.owner_id, o.owner);
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${o.id} AND user_id = ${o.admin}`;
  const account = await loadAppModule(() => import("../../src/app/actions/account"));
  viewerId = o.owner;
  assert.equal((await account.transferWorkspaceOwnership(o.id, o.admin2)).success, true);
  const [after] = await sql`SELECT takeover_requested_by FROM workspaces WHERE id = ${o.id}`;
  assert.equal(after!.takeover_requested_by, null, "the request was about the old owner");
});
