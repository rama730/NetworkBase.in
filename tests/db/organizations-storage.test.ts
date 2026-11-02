import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 9b (report §7.12, §19.2, §37.5; decisions 12, 30): the Storage section and its Review actions.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let orgFiles: typeof import("../../src/app/actions/org-files");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  orgFiles = await loadAppModule(() => import("../../src/app/actions/org-files"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const MB = 1024 * 1024;

async function org() {
  const [owner, admin, member] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, member: member! };
}

async function file(projectId: string, name: string, size: number, mime: string, extra: { deleted?: boolean; taskId?: string; versions?: number } = {}) {
  const [row] = await sql`INSERT INTO workspace_nodes (workspace_id, path, type, name, size, mime_type, deleted_at, task_id, current_version)
    VALUES (${projectId}, ${`/${name}-${Math.random()}`}, 'file', ${name}, ${size}, ${mime}, ${extra.deleted ? new Date() : null}, ${extra.taskId ?? null}, ${extra.versions ?? 1}) RETURNING id`;
  for (let v = 1; v <= (extra.versions ?? 0); v += 1) {
    await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type) VALUES (${row!.id}, ${v}, ${`k/${row!.id}/${v}`}, ${size}, ${mime})`;
  }
  return row!.id as string;
}

test("7.12: Storage shows use by type, recommendations and each workspace, for admins only", async () => {
  const o = await org();
  await file(o.id, "syllabus.pdf", 4 * MB, "application/pdf");
  await file(o.id, "board.png", 2 * MB, "image/png");
  await file(o.id, "lecture.mp4", 150 * MB, "video/mp4");
  await file(o.id, "main.py", 1 * MB, "text/x-python");
  await file(o.id, "old.zip", 3 * MB, "application/zip", { deleted: true });
  await file(o.id, "notes.pdf", 1 * MB, "application/pdf", { versions: 5 });
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, assignment_id, assignee_id, creator_id) VALUES (${o.id}, 'Lab 1', ${master!.id}, ${o.member}, ${o.owner}) RETURNING id`;
  await file(o.id, "lab1.pdf", 2 * MB, "application/pdf", { taskId: copy!.id });
  const child = await sql.begin((tx) => createProject(tx, o.member, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon' WHERE id = ${child}`;
  await sql`INSERT INTO storage_quota_scopes (scope_type, scope_id, limit_bytes, retained_bytes) VALUES ('project', ${child}, ${2 * 1024 * MB}, ${90 * MB})`;

  viewerId = o.admin;
  const r = await orgFiles.readOrgStorageBreakdownAction(o.id);
  assert.ok(r.success, JSON.stringify(r));
  const s = r.success ? r.storage : null!;
  assert.deepEqual(s.byType, { documents: 5 * MB, images: 2 * MB, video: 150 * MB, code: 1 * MB, submissions: 2 * MB, other: 0 });
  assert.equal(s.trashBytes, 3 * MB);
  assert.equal(s.largeFiles, 1, "files over 100 MB");
  assert.equal(s.oldVersionBytes, 2 * MB, "versions beyond the latest 3");
  assert.deepEqual(s.byWorkspace, [{ id: child, title: "Team Falcon", bytes: 90 * MB }]);
  assert.equal(s.limitBytes, 5 * 1024 * MB);
  const large = await orgFiles.readLargeFilesAction(o.id);
  const sizes = large.success ? large.files.map((f) => f.size) : [];
  assert.equal(large.success && large.files[0]!.name, "lecture.mp4", "largest first");
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  assert.ok(large.success && !large.files.some((f) => f.name === "old.zip"), "nothing from Trash");
  viewerId = o.member;
  assert.equal((await orgFiles.readOrgStorageBreakdownAction(o.id)).success, false);
});

test("37.5: Keep latest 3 asks first, removes older versions, and never touches hand-ins", async () => {
  const o = await org();
  const notes = await file(o.id, "notes.pdf", 1 * MB, "application/pdf", { versions: 5 });
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, assignment_id, assignee_id, creator_id) VALUES (${o.id}, 'Lab 1', ${master!.id}, ${o.member}, ${o.owner}) RETURNING id`;
  const handIn = await file(o.id, "lab1.pdf", 1 * MB, "application/pdf", { taskId: copy!.id, versions: 5 });
  viewerId = o.admin;
  assert.deepEqual(await orgFiles.keepLatestVersionsAction(o.id, false), { success: true, files: 1, versions: 2, bytes: 2 * MB });
  assert.deepEqual(await orgFiles.keepLatestVersionsAction(o.id, true), { success: true, files: 1, versions: 2, bytes: 2 * MB });
  const left = async (id: string) => (await sql`SELECT version FROM file_versions WHERE node_id = ${id} ORDER BY version`).map((r) => r.version);
  assert.deepEqual(await left(notes), [3, 4, 5]);
  assert.deepEqual(await left(handIn), [1, 2, 3, 4, 5]);
  viewerId = o.member;
  assert.equal((await orgFiles.keepLatestVersionsAction(o.id, true)).success, false);
});
