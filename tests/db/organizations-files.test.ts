import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { actAs, closeAppDb, createProject, createUser, inRollback, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.16" }) });

let nodes: typeof import("../../src/app/actions/files/nodes");
let mutations: typeof import("../../src/app/actions/files/mutations");
let helpers: typeof import("../../src/lib/files/internal-helpers");
let orgFiles: typeof import("../../src/app/actions/org-files");
let orgFilesLib: typeof import("../../src/lib/organizations/org-files");
let db: typeof import("../../src/lib/db").db;
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  nodes = await loadAppModule(() => import("../../src/app/actions/files/nodes"));
  mutations = await loadAppModule(() => import("../../src/app/actions/files/mutations"));
  helpers = await loadAppModule(() => import("../../src/lib/files/internal-helpers"));
  orgFiles = await loadAppModule(() => import("../../src/app/actions/org-files"));
  orgFilesLib = await loadAppModule(() => import("../../src/lib/organizations/org-files"));
  db = (await loadAppModule(() => import("../../src/lib/db"))).db;
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function node(projectId: string, path: string, type: "folder" | "file", extra: { access?: string; taskId?: string; version?: number } = {}) {
  const name = path.split("/").filter(Boolean).at(-1)!;
  const parentPath = path.split("/").slice(0, -1).join("/") || null;
  const [parent] = parentPath ? await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${projectId} AND path = ${parentPath}` : [null];
  const [row] = await sql`INSERT INTO workspace_nodes (workspace_id, parent_id, task_id, path, type, name, metadata, current_version)
    VALUES (${projectId}, ${parent?.id ?? null}, ${extra.taskId ?? null}, ${path}, ${type}, ${name}, ${sql.json(extra.access ? { access: extra.access } : {})}, ${extra.version ?? 1}) RETURNING id`;
  return row!.id as string;
}

async function copyTask(orgId: string, masterId: string, assignee: string) {
  const [row] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id)
    VALUES (${orgId}, 'Lab 2', 'task', ${masterId}, ${assignee}, ${assignee}) RETURNING id`;
  return row!.id as string;
}

async function org() {
  const [owner, admin, a, b, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const orgId = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${orgId}, ${owner!}, 'owner'), (${orgId}, ${admin!}, 'admin'), (${orgId}, ${a!}, 'member'), (${orgId}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, status = 'active', title = 'CSE-3A' WHERE id = ${orgId}`;
  const child = await sql.begin((tx) => createProject(tx, a!, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${a!}, 'owner'), (${child}, ${outsider!}, 'member')`;
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = 'Compiler Lab' WHERE id = ${child}`;
  created.push(orgId, child);
  await node(orgId, "/Course materials", "folder");
  const notes = await node(orgId, "/Course materials/notes.pdf", "file");
  await node(orgId, "/Staff", "folder", { access: "admins" });
  const key = await node(orgId, "/Staff/answer-key.pdf", "file");
  await node(orgId, "/Public", "folder", { access: "public" });
  const syllabus = await node(orgId, "/Public/syllabus.pdf", "file");
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id) VALUES (${orgId}, 'Lab 2', 'assignment', ${owner!}) RETURNING id`;
  const copyA = await copyTask(orgId, master!.id, a!);
  const copyB = await copyTask(orgId, master!.id, b!);
  const fileA = await node(orgId, `/.system/tasks/${copyA}/lab2-a.pdf`, "file", { taskId: copyA });
  const fileB = await node(orgId, `/.system/tasks/${copyB}/lab2-b.pdf`, "file", { taskId: copyB });
  return { orgId, child, owner: owner!, admin: admin!, a: a!, b: b!, outsider: outsider!, notes, key, syllabus, copyA, copyB, fileA, fileB, master: master!.id as string };
}

async function search(projectId: string, as: string, query: string) {
  viewerId = as;
  return (await nodes.getWorkspaceNodes(projectId, null, query)).nodes.map((n) => n.name).sort();
}
async function byIds(projectId: string, as: string, ids: string[]) {
  viewerId = as;
  return (await nodes.getNodesByIds(projectId, ids)).map((n) => n.id).sort();
}

test("folder access: members never see Admins only; visitors only Public; listing, search and lookups agree", async () => {
  const o = await org();
  assert.deepEqual(await search(o.orgId, o.a, "pdf"), ["lab2-a.pdf", "notes.pdf", "syllabus.pdf"], "own copy yes, Staff and B's copy no");
  assert.deepEqual(await search(o.orgId, o.admin, "pdf"), ["answer-key.pdf", "lab2-a.pdf", "lab2-b.pdf", "notes.pdf", "syllabus.pdf"]);
  assert.deepEqual(await search(o.orgId, "", "pdf"), ["syllabus.pdf"]);
  assert.deepEqual(await byIds(o.orgId, o.a, [o.key, o.notes]), [o.notes]);
  assert.deepEqual(await byIds(o.orgId, o.owner, [o.key]), [o.key]);
  viewerId = o.a;
  const staff = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${o.orgId} AND path = '/Staff'`;
  assert.deepEqual((await nodes.getWorkspaceNodes(o.orgId, staff[0]!.id)).nodes, [], "opening the folder by id lists nothing");
  await assert.rejects(helpers.assertFileNodeVisible(await helpers.assertWorkspaceFileReadAccess(o.orgId, o.a), { path: "/Staff/answer-key.pdf", taskId: null, deletedAt: null }));
});

test("assignment copy files are private to the copy and the admins, in the app and in the database rule", async () => {
  const o = await org();
  assert.deepEqual(await byIds(o.orgId, o.a, [o.fileA, o.fileB]), [o.fileA]);
  assert.deepEqual(await byIds(o.orgId, o.admin, [o.fileA, o.fileB]), [o.fileA, o.fileB].sort());
  const canRead = async (as: string | null, path: string, taskId: string | null) => inRollback(async (tx) => {
    await actAs(tx, as);
    const [row] = await tx`SELECT app_private.nb_workspace_node_can_read(${o.orgId}::uuid, ${taskId}::uuid, ${path}, NULL) AS ok`;
    return row!.ok as boolean;
  });
  assert.equal(await canRead(o.a, "/Staff/answer-key.pdf", null), false);
  assert.equal(await canRead(o.admin, "/Staff/answer-key.pdf", null), true);
  assert.equal(await canRead(o.a, "/Course materials/notes.pdf", null), true);
  assert.equal(await canRead(null, "/Course materials/notes.pdf", null), false, "unmarked is Members");
  assert.equal(await canRead(null, "/Public/syllabus.pdf", null), true);
  assert.equal(await canRead(o.a, `/.system/tasks/${o.copyB}/lab2-b.pdf`, o.copyB), false);
  assert.equal(await canRead(o.a, `/.system/tasks/${o.copyA}/lab2-a.pdf`, o.copyA), true);
});

test("members can't write the org tree but can always add files to their own copy", async () => {
  const o = await org();
  await sql`UPDATE workspace_members SET file_upload_enabled = true WHERE workspace_id = ${o.orgId} AND user_id = ${o.a}`;
  await assert.rejects(helpers.assertWorkspaceUploadAccess(o.orgId, o.a), /organization/i);
  await helpers.assertWorkspaceUploadAccess(o.orgId, o.a, { taskId: o.copyA });
  await assert.rejects(helpers.assertWorkspaceUploadAccess(o.orgId, o.a, { taskId: o.copyB }));
  await helpers.assertWorkspaceUploadAccess(o.orgId, o.admin);
  viewerId = o.a;
  await assert.rejects(mutations.createFolder(o.orgId, null, "Mine"));
  await assert.rejects(db.transaction((tx) => helpers.assertWorkspaceUploadAccessTx(tx, o.orgId, o.a)));
  await db.transaction((tx) => helpers.assertWorkspaceUploadAccessTx(tx, o.orgId, o.a, { nodeId: o.fileA }));
});

test("admins set folder access with a preview; a folder can't be more open than its parent", async () => {
  const o = await org();
  const co1 = await node(o.orgId, "/Course materials/CO1", "folder");
  await node(o.orgId, "/Course materials/CO1/slides.pdf", "file");
  viewerId = o.a;
  assert.equal((await orgFiles.setFolderAccessAction(o.orgId, co1, "admins", true)).success, false);
  viewerId = o.admin;
  const blocked = await orgFiles.setFolderAccessAction(o.orgId, (await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${o.orgId} AND path = '/Staff'`)[0]!.id, "admins", true);
  assert.equal(blocked.success, true);
  const sub = await node(o.orgId, "/Staff/keys", "folder");
  assert.equal((await orgFiles.setFolderAccessAction(o.orgId, sub, "public", true)).success, false, "Public inside Admins only");
  const preview = await orgFiles.setFolderAccessAction(o.orgId, co1, "admins", false);
  assert.deepEqual(preview, { success: true, preview: { files: 1, message: "Members will lose access to 1 file." } });
  assert.equal((await orgFiles.setFolderAccessAction(o.orgId, co1, "admins", true)).success, true);
  assert.deepEqual(await search(o.orgId, o.a, "slides"), []);
  viewerId = o.admin;
  // Decision 61 (step 8): an Admins-only folder can't be a template.
  assert.equal((await orgFiles.setFolderTemplateAction(o.orgId, co1, true)).success, false);
  const [row] = await sql`SELECT metadata FROM workspace_nodes WHERE id = ${co1}`;
  assert.deepEqual([row!.metadata.access, row!.metadata.template], ["admins", undefined]);
});

test("new orgs get starter folders by type, the last one Admins only", async () => {
  const o = await org();
  const fresh = await sql.begin((tx) => createProject(tx, o.owner));
  created.push(fresh);
  await orgFilesLib.createStarterFolders(db, fresh, o.owner, "company");
  const rows = await sql`SELECT path, metadata->>'access' AS access FROM workspace_nodes WHERE workspace_id = ${fresh} ORDER BY created_at, path`;
  assert.deepEqual(rows.map((r) => [r.path, r.access]), [["/Docs", null], ["/Managers", "admins"], ["/Shared", null], ["/Templates", null]].sort((x, y) => x[0]!.localeCompare(y[0]!)));
});

test("From <org> in a child project: org members browse the org tree read-only; copies remember their source", async () => {
  const o = await org();
  viewerId = o.a;
  const top = await orgFiles.browseOrgFilesAction(o.child, null);
  assert.equal(top.success, true, JSON.stringify(top));
  if (top.success) assert.deepEqual(top.nodes.map((n) => n.name), ["Course materials", "Public"], "no Admins-only folder, no task files");
  viewerId = o.outsider;
  assert.equal((await orgFiles.browseOrgFilesAction(o.child, null)).success, false, "outside people get no From org view");

  viewerId = o.a;
  const copy = await node(o.child, "/notes.pdf", "file");
  assert.equal((await orgFiles.recordOrgCopyAction(o.child, copy, o.notes)).success, true);
  assert.equal((await orgFiles.recordOrgCopyAction(o.child, copy, o.key)).success, false, "can't claim a hidden source");
  await sql`UPDATE workspace_nodes SET current_version = 3 WHERE id = ${o.notes}`;
  const copies = await orgFiles.listOrgCopiesAction(o.child);
  assert.equal(copies.success, true);
  if (copies.success) assert.deepEqual(copies.copies.map((c) => [c.nodeId, c.copiedVersion, c.sourceVersion]), [[copy, 1, 3]]);
});

test("§23 pass: Sprint materials by access, trash-in-use warnings, storage line, template folders, group deliverables; no GitHub sync for orgs", async () => {
  const o = await org();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, status, start_date, end_date) VALUES (${o.orgId}, 1, 'CO2', 'active', now(), now() + interval '7 days') RETURNING id`;
  await sql`INSERT INTO sprint_materials (sprint_id, node_id) VALUES (${sprint!.id}, ${o.notes}), (${sprint!.id}, ${o.key})`;
  viewerId = o.a;
  const asMember = await orgFiles.readOrgSprintMaterialsAction(o.orgId);
  assert.deepEqual(asMember.success && asMember.groups.map((g) => [g.sprint, g.files.map((f) => f.name)]), [["CO2", ["notes.pdf"]]], "the answer key stays hidden");
  viewerId = o.admin;
  const asAdmin = await orgFiles.readOrgSprintMaterialsAction(o.orgId);
  assert.equal(asAdmin.success && asAdmin.groups[0]!.files.length, 2);

  const [course] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${o.orgId} AND path = '/Course materials'`;
  await sql`UPDATE workspace_nodes SET metadata = metadata || '{"template": true}'::jsonb WHERE id = ${course!.id}`;
  const usage = await orgFiles.readOrgFileUsageAction(o.orgId, [course!.id]);
  assert.deepEqual(usage.sort(), ["CO2", "the Course materials template"]);
  viewerId = o.a;
  assert.deepEqual(await orgFiles.readOrgFileUsageAction(o.orgId, [course!.id]), [], "admins only");
  assert.deepEqual((await orgFiles.listOrgTemplateFoldersAction(o.orgId)).map((f) => f.name), ["Course materials"]);

  viewerId = o.admin;
  await sql`INSERT INTO storage_quota_scopes (scope_type, scope_id, limit_bytes, retained_bytes) VALUES ('project', ${o.orgId}, ${10 * 1024 ** 3}, ${Math.round(4.2 * 1024 ** 3)})
    ON CONFLICT (scope_type, scope_id) DO UPDATE SET retained_bytes = EXCLUDED.retained_bytes`;
  const storage = await orgFiles.readOrgStorageAction(o.orgId);
  assert.deepEqual([storage?.limitBytes, storage?.warn], [5 * 1024 ** 3, true]);
  await sql`DELETE FROM storage_quota_scopes WHERE scope_type = 'project' AND scope_id = ${o.orgId}`;

  // A group copy in the child project with a handed-in file shows on the Submissions page under its workspace (step 8).
  const [group] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, review_status) VALUES (${o.child}, 'Lab 2', 'task', ${o.master}, ${o.a}, ${o.owner}, 'pending') RETURNING id`;
  await node(o.child, `/.system/tasks/${group!.id}/parser.zip`, "file", { taskId: group!.id });
  const submissions = await orgFiles.readOrgSubmissionsAction(o.orgId);
  const groupRow = submissions.success ? submissions.assignments.flatMap((a) => a.rows).find((r) => r.copyId === group!.id) : null;
  assert.deepEqual([groupRow?.who, groupRow?.files, groupRow?.status], ["Compiler Lab", 1, "Submitted"]);

  const github = await loadAppModule(() => import("../../src/app/actions/github-sync"));
  const refused = await github.connectGitHubSyncRepository(o.orgId, "https://github.com/acme/repo", "main") as { success?: boolean; error?: string };
  assert.ok(!refused.success && /Organizations can’t connect/.test(String(refused.error)), JSON.stringify(refused));
});

test("§23 pass: a member's folder zip skips Admins-only folders and other people's copies", async () => {
  const o = await org();
  // A zip only carries files with a verified stored copy.
  await sql`UPDATE workspace_nodes SET s3_key = workspace_id::text || '/files/' || id::text, size = 10 WHERE workspace_id = ${o.orgId} AND type = 'file'`;
  await sql`WITH made AS (
      INSERT INTO storage_assets (workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, content_hash, expires_at)
      SELECT workspace_id, 'project-files', s3_key, 'workspace_file', 'verified', 'application/pdf', 10, 'application/pdf', 10, now(), 'hash', now() + interval '1 day'
      FROM workspace_nodes WHERE workspace_id = ${o.orgId} AND type = 'file'
      RETURNING id, storage_key)
    UPDATE workspace_nodes n SET asset_id = made.id FROM made WHERE n.s3_key = made.storage_key`;
  const exportLib = await loadAppModule(() => import("../../src/lib/files/folder-export"));
  const accessLib = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  const { sql: dsql } = await import("drizzle-orm");
  const plan = async (userId: string) => {
    const access = await accessLib.getWorkspaceAccessById(o.orgId, userId);
    const nodeFilter = helpers.orgFileAccessSql(access)
      ? (alias: "n" | "child") => helpers.orgFileAccessSql(access, { projectId: dsql.raw(`${alias}.workspace_id`), path: dsql.raw(`${alias}.path`), taskId: dsql.raw(`${alias}.task_id`) })
      : undefined;
    const prepared = await exportLib.prepareFolderExport({ projectId: o.orgId, folderId: null, canReadTaskFiles: true, nodeFilter });
    await exportLib.releaseFolderExport(prepared.operationId);
    return prepared.entries.filter((e) => e.type === "file").map((e) => e.path.split("/").at(-1)).sort();
  };
  assert.deepEqual(await plan(o.a), ["lab2-a.pdf", "notes.pdf", "syllabus.pdf"]);
  assert.ok((await plan(o.owner)).includes("answer-key.pdf"));
});
