import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

let access: typeof import("../../src/lib/data/workspace-access");
let caps: typeof import("../../src/lib/workspaces/file-capabilities");
before(async () => {
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  caps = await loadAppModule(() => import("../../src/lib/workspaces/file-capabilities"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const forUser = async (projectId: string, userId: string | null) => caps.buildFileCapabilities(await access.getWorkspaceAccessById(projectId, userId));

// API-006: the capability projection must agree with what the file actions enforce.
test("capabilities follow file authorization, including the member upload switch and Files visibility", async () => {
  const ids: string[] = [];
  const user = async () => { const id = await sql.begin((tx) => createUser(tx)); ids.push(id); return id; };
  try {
    const owner = await user();
    const uploader = await user();
    const noUpload = await user();
    const viewer = await user();
    const outsider = await user();
    const projectId = await sql.begin((tx) => createProject(tx, owner));
    const hiddenFilesProject = await sql.begin((tx) => createProject(tx, owner, { publicTabVisibility: { files: false } }));
    await sql.begin(async (tx) => {
      await addMember(tx, projectId, uploader, "member");
      await addMember(tx, projectId, noUpload, "member");
      await addMember(tx, projectId, viewer, "viewer");
    });
    await sql`UPDATE workspace_members SET file_upload_enabled = false WHERE workspace_id = ${projectId} AND user_id = ${noUpload}`;

    const ownerCaps = await forUser(projectId, owner);
    assert.deepEqual([ownerCaps.canReadFiles, ownerCaps.canCreateFiles, ownerCaps.canEditFiles, ownerCaps.canManageSettings], [true, true, true, true]);

    const uploaderCaps = await forUser(projectId, uploader);
    assert.deepEqual([uploaderCaps.canCreateFiles, uploaderCaps.canAcquireLock], [true, true]);

    // Same role, upload switched off for this member: the role alone must not advertise upload.
    const noUploadCaps = await forUser(projectId, noUpload);
    assert.deepEqual([noUploadCaps.canReadFiles, noUploadCaps.canCreateFiles, noUploadCaps.canEditFiles, noUploadCaps.canAcquireLock], [true, false, false, false]);

    const viewerCaps = await forUser(projectId, viewer);
    assert.deepEqual([viewerCaps.canReadFiles, viewerCaps.canCreateFiles, viewerCaps.canStageToTask, viewerCaps.canManageSettings], [true, false, false, false]);

    const outsiderCaps = await forUser(projectId, outsider);
    assert.deepEqual([outsiderCaps.canReadFiles, outsiderCaps.canCreateFiles, outsiderCaps.canManageSettings], [true, false, false]);

    // Public workspace with the Files tab hidden: a stranger can read the workspace but not its files.
    assert.equal((await forUser(hiddenFilesProject, outsider)).canReadFiles, false);
    assert.equal((await forUser(hiddenFilesProject, owner)).canReadFiles, true);
  } finally {
    await sql`DELETE FROM workspaces WHERE owner_id = ANY(${ids}::uuid[])`;
  }
});
