import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A7.2 (report 38.16 W3–W5, calls 2–3): comments on a file's version, at a spot on an image or a moment in
// media; members comment, viewers read, outsiders nothing; replies stay on their comment's version; resolve and delete.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.178" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let comments: typeof import("../../src/app/actions/file-comments");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  comments = await loadAppModule(() => import("../../src/app/actions/file-comments"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const node = async (name: string, mime: string) => (await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, mime_type, created_by, current_version) VALUES (${ws}, 'file', ${name}, ${`/${name}`}, ${mime}, ${owner!}, 3) RETURNING id`)[0]!.id as string;
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws, image: await node("Logo.png", "image/png"), video: await node("Intro.mp4", "video/mp4") };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("W3/W4: a spot on an image, a moment on video, not the other way round; versions that exist only", async () => {
  const t = await workspace();
  viewerId = t.member;
  assert.equal((await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 3, anchor: { x: 0.4, y: 0.6 }, content: "Too close to the edge" })).success, true);
  assert.match(errorOf(await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 3, anchor: { t: 4 }, content: "x" })), /spot goes on an image/);
  assert.equal((await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.video, version: 3, anchor: { t: 42 }, content: "Cut here", duration: 60 })).success, true);
  assert.match(errorOf(await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.video, version: 3, anchor: { t: 90 }, content: "x", duration: 60 })), /moment on video/);
  assert.match(errorOf(await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 4, content: "x" })), /doesn’t exist yet/);
  const [n] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.owner} AND title LIKE 'New comment on %'`;
  assert.equal(n!.n, 2, "the uploader is told");
});

test("W5: comments stay on their version; replies follow their comment; viewers read only; outsiders nothing", async () => {
  const t = await workspace();
  viewerId = t.member;
  const first = await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 2, anchor: { x: 0.1, y: 0.1 }, content: "On v2" });
  assert.ok(first.success);
  const reply = await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 3, content: "Fixed in v3", parentId: first.id, anchor: null });
  assert.ok(reply.success);
  const [r] = await sql`SELECT version, anchor FROM file_comments WHERE id = ${reply.id}`;
  assert.deepEqual([r!.version, r!.anchor], [2, null], "a reply sits on its comment's version, without a spot");
  viewerId = t.viewer;
  const read = await comments.readFileCommentsAction(t.ws, t.image);
  assert.deepEqual(read.success && [read.version, read.kind, read.canComment, read.comments.length], [3, "image", false, 2]);
  assert.match(errorOf(await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 3, content: "x" })), /Viewers can read/);
  viewerId = t.outsider;
  assert.equal((await comments.readFileCommentsAction(t.ws, t.image)).success, false);
});

test("resolve by the author or someone who can change files; delete by the author only", async () => {
  const t = await workspace();
  viewerId = t.member;
  const c = await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 3, content: "Use the dark one" });
  assert.ok(c.success);
  viewerId = t.owner;
  assert.equal((await comments.changeFileCommentAction({ projectId: t.ws, nodeId: t.image, commentId: c.id, action: "resolve" })).success, true);
  assert.match(errorOf(await comments.changeFileCommentAction({ projectId: t.ws, nodeId: t.image, commentId: c.id, action: "delete" })), /Only its author deletes/);
  viewerId = t.member;
  assert.equal((await comments.changeFileCommentAction({ projectId: t.ws, nodeId: t.image, commentId: c.id, action: "delete" })).success, true);
  const read = await comments.readFileCommentsAction(t.ws, t.image);
  assert.equal(read.success && read.comments.length, 0);
});

test("security review: a completed member can't comment or delete; a member without See Files can't read", async () => {
  const t = await workspace();
  viewerId = t.member;
  const c = await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 3, content: "Before I finished" });
  assert.ok(c.success);
  await sql`UPDATE workspace_members SET completed_at = now() WHERE workspace_id = ${t.ws} AND user_id = ${t.member}`;
  assert.equal((await comments.addFileCommentAction({ projectId: t.ws, nodeId: t.image, version: 3, content: "x" })).success, false);
  assert.equal((await comments.changeFileCommentAction({ projectId: t.ws, nodeId: t.image, commentId: c.id, action: "delete" })).success, false);
  await sql`UPDATE workspace_members SET completed_at = NULL WHERE workspace_id = ${t.ws} AND user_id = ${t.member}`;
  await sql`UPDATE workspaces SET role_abilities = '{"member": {"files.see": false}}'::jsonb WHERE id = ${t.ws}`;
  assert.equal((await comments.readFileCommentsAction(t.ws, t.image)).success, false);
});
