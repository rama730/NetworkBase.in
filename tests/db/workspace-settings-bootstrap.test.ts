import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
let realProjectAccess: Record<string, unknown> = {};
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
// Counts project access reads, to show the sections of one settings load share a single read.
let accessReads = 0;
moduleStubs.set("@/lib/data/workspace-access", new Proxy({} as Record<string, unknown>, {
  get(_target, name: string) {
    const real = realProjectAccess[name];
    if (name === "getProjectAccessById" && typeof real === "function") {
      return (...args: unknown[]) => { accessReads += 1; return (real as (...a: unknown[]) => unknown)(...args); };
    }
    return real;
  },
}));
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let actions: typeof import("../../src/app/actions/workspace/index");
before(async () => {
  realProjectAccess = (await loadAppModule(() => import("../../src/lib/data/workspace-access"))) as unknown as Record<string, unknown>;
  actions = await loadAppModule(() => import("../../src/app/actions/workspace/index"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// PERF-011: totals come from aggregates; lists are bounded; the summary always covers every member.
test("settings readers count roles and upload permissions in SQL for the whole team", async () => {
  const ids: string[] = [];
  const user = async () => { const id = await sql.begin((tx) => createUser(tx)); ids.push(id); return id; };
  try {
    const owner = await user();
    viewerId = owner;
    const projectId = await sql.begin((tx) => createProject(tx, owner));
    await sql.begin((tx) => addMember(tx, projectId, owner, "owner")); // creating a project adds the owner's membership row
    const roles = ["admin", "member", "member", "member", "viewer"];
    const members: string[] = [];
    for (const role of roles) {
      const id = await user();
      members.push(id);
      await sql.begin((tx) => addMember(tx, projectId, id, role));
    }
    await sql`UPDATE project_members SET file_upload_enabled = false WHERE project_id = ${projectId} AND user_id = ${members[2]!}`;

    const collaborators = await actions.getProjectCollaboratorSettingsAction(projectId, { limit: 2 });
    assert.equal(collaborators.success, true, "message" in collaborators ? collaborators.message : "");
    if (!collaborators.success) return;
    assert.deepEqual(collaborators.data.roleCounts, { owner: 1, admin: 1, member: 3, viewer: 1 });
    assert.equal(collaborators.data.members.length, 2);
    assert.equal(collaborators.data.hasMore, true);

    const files = await actions.getProjectFileAccessSettingsAction(projectId);
    assert.equal(files.success, true, "message" in files ? files.message : "");
    if (!files.success) return;
    assert.equal(files.data.members.length, 6);
    assert.equal(files.data.hasMore, false);
    // owner + admin always allowed; 3 members of which one has uploads off; the viewer counts nowhere.
    assert.deepEqual(files.data.summary, { alwaysAllowedCount: 2, enabledMemberCount: 2, disabledMemberCount: 1 });

    const bootstrap = await actions.readProjectSettingsBootstrapAction(projectId, { limit: 40 });
    assert.equal(bootstrap.collaboratorSettings.success, true);
    assert.equal(bootstrap.fileAccess.success, true);
  } finally {
    await sql`DELETE FROM projects WHERE owner_id = ANY(${ids}::uuid[])`;
  }
});

// PERF-011: the sections of one settings load share one sign-in check and one project access read.
test("the settings bootstrap reads project access once for all of its sections", async () => {
  const ids: string[] = [];
  try {
    const owner = await sql.begin((tx) => createUser(tx));
    ids.push(owner);
    viewerId = owner;
    const projectId = await sql.begin((tx) => createProject(tx, owner));
    await sql.begin((tx) => addMember(tx, projectId, owner, "owner"));
    accessReads = 0;
    const bootstrap = await actions.readProjectSettingsBootstrapAction(projectId, { limit: 10 }, true);
    assert.equal(bootstrap.collaboratorSettings.success, true);
    assert.equal(bootstrap.fileAccess.success, true);
    assert.equal(bootstrap.notifications.success, true);
    assert.equal(bootstrap.dangerPreflight.success, true);
    assert.equal(accessReads, 1, "one project access read for every section");
  } finally {
    await sql`DELETE FROM projects WHERE owner_id = ANY(${ids}::uuid[])`;
  }
});
