import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 8 (report §18.6, §28.5, §37.5, §38.1 #6; decision 61): the Files screen's server side.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.81" }) });

let orgFiles: typeof import("../../src/app/actions/org-files");
let story: typeof import("../../src/lib/profile/contribution-story-server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  orgFiles = await loadAppModule(() => import("../../src/app/actions/org-files"));
  story = await loadAppModule(() => import("../../src/lib/profile/contribution-story-server"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function node(projectId: string, path: string, type: "folder" | "file", extra: { access?: string; template?: boolean; taskId?: string; mime?: string } = {}) {
  const name = path.split("/").filter(Boolean).at(-1)!;
  const parentPath = path.split("/").slice(0, -1).join("/") || null;
  const [parent] = parentPath ? await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${projectId} AND path = ${parentPath}` : [null];
  const metadata = { ...(extra.access ? { access: extra.access } : {}), ...(extra.template ? { template: true } : {}) };
  const [row] = await sql`INSERT INTO workspace_nodes (workspace_id, parent_id, task_id, path, type, name, metadata, mime_type)
    VALUES (${projectId}, ${parent?.id ?? null}, ${extra.taskId ?? null}, ${path}, ${type}, ${name}, ${sql.json(metadata)}, ${extra.mime ?? null}) RETURNING id`;
  return row!.id as string;
}

async function org() {
  const [owner, admin, member, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member'), (${id}, ${other!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, status = 'active', title = 'CSE 3B',
            public_tab_visibility = '{"files": true}'::jsonb WHERE id = ${id}`;
  const child = await sql.begin((tx) => createProject(tx, member!, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${member!}, 'owner')`;
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'Team Falcon' WHERE id = ${child}`;
  created.push(id);
  return { id, child, owner: owner!, admin: admin!, member: member!, other: other! };
}

test("38.1 #6: importing a profile image from an organization's files only offers what visitors may see", async () => {
  const o = await org();
  await node(o.id, "/Staff", "folder", { access: "admins" });
  const hidden = await node(o.id, "/Staff/key.png", "file", { mime: "image/png" });
  await node(o.id, "/Class", "folder");
  const members = await node(o.id, "/Class/board.png", "file", { mime: "image/png" });
  await node(o.id, "/Public", "folder", { access: "public" });
  const open = await node(o.id, "/Public/poster.png", "file", { mime: "image/png" });
  const offered = (await story.contributionReferenceOptions(o.id, "file", "", [hidden, members, open])).map((f) => f.id);
  assert.deepEqual(offered, [open]);
});

test("decision 61, 28.5: an Admins-only folder can't be a template, and Start from a template skips empty and Admins-only folders", async () => {
  const o = await org();
  const staff = await node(o.id, "/Staff", "folder", { access: "admins" });
  const inner = await node(o.id, "/Staff/Keys", "folder");
  const course = await node(o.id, "/Course", "folder", { template: true });
  await node(o.id, "/Course/syllabus.pdf", "file");
  await node(o.id, "/Empty", "folder", { template: true });
  viewerId = o.admin;
  for (const folder of [staff, inner]) {
    const r = await orgFiles.setFolderTemplateAction(o.id, folder, true);
    assert.deepEqual(r, { success: false, error: "Admins-only folders can’t be templates. Copying would show them to the team." });
  }
  const preview = await orgFiles.setFolderAccessAction(o.id, course, "admins", false);
  assert.ok(preview.success && preview.preview?.message.includes("It stops being a template."), JSON.stringify(preview));
  assert.deepEqual((await orgFiles.listOrgTemplateFoldersAction(o.id)).map((f) => f.name), ["Course"], "the empty one isn't offered");
  assert.equal((await orgFiles.setFolderAccessAction(o.id, course, "admins", true)).success, true);
  const [row] = await sql`SELECT metadata FROM workspace_nodes WHERE id = ${course}`;
  assert.deepEqual(row!.metadata, { access: "admins" });
  assert.deepEqual(await orgFiles.listOrgTemplateFoldersAction(o.id), []);
});

test("37.5: the Submissions page lists each person or group per assignment, with version, when, Late and status; admins only", async () => {
  const o = await org();
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date) VALUES (${o.id}, 'Lab 3', 'assignment', ${o.owner}, now() - interval '1 day') RETURNING id`;
  const [late] = await sql`INSERT INTO tasks (workspace_id, title, assignment_id, assignee_id, creator_id, due_date, review_status, review_submitted_at, submission)
    VALUES (${o.id}, 'Lab 3', ${master!.id}, ${o.member}, ${o.owner}, now() - interval '1 day', 'pending', now(), '{"version": 2}'::jsonb) RETURNING id`;
  await node(o.id, `/.system/tasks/${late!.id}/lab3.pdf`, "file", { taskId: late!.id });
  await sql`INSERT INTO tasks (workspace_id, title, assignment_id, team_name, creator_id, due_date) VALUES (${o.id}, 'Lab 3', ${master!.id}, 'Group 4', ${o.owner}, now() - interval '1 day')`;
  viewerId = o.admin;
  const r = await orgFiles.readOrgSubmissionsAction(o.id);
  assert.ok(r.success, JSON.stringify(r));
  const [lab] = r.success ? r.assignments : [];
  assert.equal(lab?.title, "Lab 3");
  const byWho = new Map(lab!.rows.map((row) => [row.who, row]));
  assert.deepEqual([byWho.get("Group 4")?.status, byWho.get("Group 4")?.files], ["Missing", 0]);
  const mine = [...byWho.values()].find((row) => row.files === 1)!;
  assert.deepEqual([mine.status, mine.late, mine.version, Boolean(mine.submittedAt)], ["In review", true, 2, true]);
  viewerId = o.member;
  assert.equal((await orgFiles.readOrgSubmissionsAction(o.id)).success, false);
});

test("18.6: a workspace's Final files list its group work handed in, with the organization's review", async () => {
  const o = await org();
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id) VALUES (${o.id}, 'Project 1', 'assignment', ${o.owner}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, assignment_id, creator_id, status) VALUES (${o.child}, 'Project 1', ${master!.id}, ${o.owner}, 'done') RETURNING id`;
  await node(o.child, `/.system/tasks/${copy!.id}/report.pdf`, "file", { taskId: copy!.id });
  viewerId = o.member;
  const r = await orgFiles.readChildFinalFilesAction(o.child);
  assert.ok(r.success, JSON.stringify(r));
  assert.deepEqual(r.success && r.rows.map((row) => [row.name, row.assignment, row.review]), [["report.pdf", "Project 1", "Reviewed by CSE 3B"]]);
  viewerId = o.other;
  assert.equal((await orgFiles.readChildFinalFilesAction(o.child)).success, false, "org members outside the team don't");
});

test("37.5: the in-use warning names what uses a file", async () => {
  const o = await org();
  const folder = await node(o.id, "/Course", "folder", { template: true });
  const file = await node(o.id, "/Course/notes.pdf", "file");
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.id}, 'CO1', now(), now() + interval '7 days', 'planning') RETURNING id`;
  await sql`INSERT INTO sprint_materials (sprint_id, node_id) VALUES (${sprint!.id}, ${file})`;
  viewerId = o.admin;
  assert.deepEqual((await orgFiles.readOrgFileUsageAction(o.id, [folder])).sort(), ["CO1", "the Course template"]);
});
