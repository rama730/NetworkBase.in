import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("@/lib/server/viewer-context", {
  getViewerProfileContext: async () => ({ userId: viewerId, profile: { fullName: "Tester", username: "tester", avatarUrl: null } }),
  getViewerAuthContext: async () => ({ userId: viewerId }),
  getViewerIdentityContext: async () => ({ userId: viewerId }),
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/server", { after: () => undefined, NextResponse: { json: () => undefined } });

let updates: typeof import("../../src/app/actions/workspace/updates");
before(async () => {
  updates = await loadAppModule(() => import("../../src/app/actions/workspace/updates"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function withProject(fn: (ids: { owner: string; projectId: string }) => Promise<void>) {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  viewerId = owner;
  try {
    await fn({ owner, projectId });
  } finally {
    await sql`DELETE FROM project_update_comments WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_updates WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
  }
}

async function createUpdate(projectId: string, authorId: string) {
  const [row] = await sql`INSERT INTO project_updates (project_id, author_id, content, visibility)
    VALUES (${projectId}, ${authorId}, 'body', 'public') RETURNING id`;
  return row!.id as string;
}

// COR-039: a reply's parent must belong to the same update and project.
test("replies reject a parent comment from another update", async () => {
  await withProject(async ({ owner, projectId }) => {
    const member = await sql.begin((tx) => createUser(tx));
    await sql.begin((tx) => addMember(tx, projectId, member));
    const first = await createUpdate(projectId, owner);
    const second = await createUpdate(projectId, owner);
    const parent = await updates.createProjectUpdateCommentAction(projectId, first, "parent");
    assert.equal(parent.success, true, JSON.stringify(parent));
    const parentId = (parent as { data: { id: string } }).data.id;

    const crossed = await updates.createProjectUpdateCommentAction(projectId, second, "reply", parentId);
    assert.equal(crossed.success, false);
    const ok = await updates.createProjectUpdateCommentAction(projectId, first, "reply", parentId);
    assert.equal(ok.success, true, JSON.stringify(ok));
    const [{ count }] = await sql`SELECT comment_count AS count FROM project_updates WHERE id = ${second}`;
    assert.equal(Number(count), 0, "a rejected reply never bumps the count");
  });
});

// COR-040: two deletes of one comment decrement the count once.
test("deleting a comment twice at once decrements the count once", async () => {
  await withProject(async ({ owner, projectId }) => {
    const updateId = await createUpdate(projectId, owner);
    const first = await updates.createProjectUpdateCommentAction(projectId, updateId, "one");
    await updates.createProjectUpdateCommentAction(projectId, updateId, "two");
    const commentId = (first as { data: { id: string } }).data.id;
    await Promise.all([
      updates.deleteProjectUpdateCommentAction(projectId, commentId),
      updates.deleteProjectUpdateCommentAction(projectId, commentId),
    ]);
    const [{ count }] = await sql`SELECT comment_count AS count FROM project_updates WHERE id = ${updateId}`;
    assert.equal(Number(count), 1);
  });
});

// COR-046: an invalid pin keeps the current one, and concurrent pins leave exactly one.
test("pins: an invalid target never unpins, and concurrent pins leave one", async () => {
  await withProject(async ({ owner, projectId }) => {
    const a = await createUpdate(projectId, owner);
    const b = await createUpdate(projectId, owner);
    const c = await createUpdate(projectId, owner);
    assert.equal((await updates.toggleProjectUpdatePinAction(projectId, a, true)).success, true);
    await sql`UPDATE project_updates SET deleted_at = now() WHERE id = ${c}`;
    const invalid = await updates.toggleProjectUpdatePinAction(projectId, c, true);
    assert.equal(invalid.success, false);
    const [{ pinned: aPinned }] = await sql`SELECT is_pinned AS pinned FROM project_updates WHERE id = ${a}`;
    assert.equal(aPinned, true, "the existing pin survives an invalid request");
    await Promise.all([
      updates.toggleProjectUpdatePinAction(projectId, a, true),
      updates.toggleProjectUpdatePinAction(projectId, b, true),
    ]);
    const [{ pins }] = await sql`SELECT count(*)::int AS pins FROM project_updates WHERE project_id = ${projectId} AND is_pinned AND deleted_at IS NULL`;
    assert.equal(pins, 1);
  });
});
