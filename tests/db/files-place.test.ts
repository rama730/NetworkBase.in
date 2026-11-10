import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §19.3, A1.8, D11, D13, A3.13, A2.5: one way to place files, with version conflicts instead of
// overwrites, keep-both copies, role words, a server secret check, and a paged manifest.
let actingUser = "";
const uploaded = new Map<string, Buffer>();
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let place: typeof import("../../src/app/api/v1/files/place/route");
let manifest: typeof import("../../src/app/api/v1/workspaces/[id]/manifest/route");
before(async () => {
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", {
    ...shared,
    requireAuthenticatedUser: async () => ({ user: { id: actingUser, email: "a@example.com", user_metadata: {} }, extensionSessionId: "ext", tokenScopes: null, response: null }),
  });
  moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
  const server = await loadAppModule(() => import("../../src/lib/supabase/server"));
  moduleStubs.set("@/lib/supabase/server", {
    ...server,
    createAdminClient: async () => ({ storage: { from: () => ({ upload: async (key: string, body: Buffer) => { uploaded.set(key, body); return { error: null }; } }) } }),
  });
  place = await loadAppModule(() => import("../../src/app/api/v1/files/place/route"));
  manifest = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/manifest/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const file = (path: string, text: string, extra: Record<string, unknown> = {}) => ({
  path, contentHash: sha(text), size: Buffer.byteLength(text), mimeType: "text/plain", contentBase64: Buffer.from(text).toString("base64"), ...extra,
});
const post = async (body: Record<string, unknown>) => {
  const res = await place.POST(new Request("https://app.test/api/v1/files/place", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
};
async function workspace() {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  actingUser = owner;
  return { owner, projectId };
}

test("same path makes a new version; a stale base version is a conflict, not an overwrite", async () => {
  const { projectId } = await workspace();
  const first = await post({ projectId, files: [file("notes/plan.md", "v1")] });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.files[0].version, 1);

  const second = await post({ projectId, files: [file("notes/plan.md", "v2", { baseVersion: 1 })] });
  assert.equal(second.json.data.files[0].version, 2);

  const stale = await post({ projectId, files: [file("notes/plan.md", "my edit from v1", { baseVersion: 1 })] });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.errorCode, "VERSION_CONFLICT");
  assert.deepEqual(
    stale.json.details.conflicts.map((c: { path: string; baseVersion: number; currentVersion: number }) => [c.path, c.baseVersion, c.currentVersion]),
    [["/notes/plan.md", 1, 2]],
  );
  const [node] = await sql`SELECT current_version FROM workspace_nodes WHERE workspace_id = ${projectId} AND path = '/notes/plan.md'`;
  assert.equal(node!.current_version, 2, "the teammate's v2 stays current");

  const sameAsServer = await post({ projectId, files: [file("notes/plan.md", "v2", { baseVersion: 1 })] });
  assert.equal(sameAsServer.status, 200, "identical content is not a conflict");
  assert.equal(sameAsServer.json.data.files[0].status, "unchanged");
});

test("keep both saves a separate copy; folder and versionOf choose where", async () => {
  const { projectId } = await workspace();
  await post({ projectId, files: [file("report.pdf", "one")] });
  const both = await post({ projectId, onSameName: "keep-both", files: [file("report.pdf", "two")] });
  assert.equal(both.json.data.files[0].path, "/report (2).pdf");

  const inFolder = await post({ projectId, folder: "/design/icons", files: [file("logo.svg", "<svg/>")] });
  assert.equal(inFolder.json.data.files[0].path, "/design/icons/logo.svg");

  const [target] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${projectId} AND path = '/report.pdf'`;
  const version = await post({ projectId, files: [file("anything-dropped.pdf", "three", { versionOf: target!.id })] });
  assert.equal(version.json.data.files[0].path, "/report.pdf");
  assert.equal(version.json.data.files[0].version, 2);
});

test("files that look like credentials are refused before anything is saved", async () => {
  const { projectId } = await workspace();
  const refused = await post({ projectId, files: [file("config.ts", "const k = 'nb_pat_0123456789abcdef0123';")] });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.errorCode, "SECRET_DETECTED");
  assert.equal(refused.json.details.findings[0].rule, "NetworkBase token");
  const rows = await sql`SELECT 1 FROM workspace_nodes WHERE workspace_id = ${projectId} AND path = '/config.ts'`;
  assert.equal(rows.length, 0, "no empty file left behind");
  const confirmed = await post({ projectId, confirmSecrets: true, files: [file("config.ts", "const k = 'nb_pat_0123456789abcdef0123';")] });
  assert.equal(confirmed.status, 200);
});

test("role words: final links as a final file and answers in the app's words", async () => {
  const { projectId } = await workspace();
  const [task] = await sql`INSERT INTO tasks (workspace_id, title) VALUES (${projectId}, 'Write report') RETURNING id`;
  const res = await post({ projectId, taskId: task!.id, role: "final", files: [file("final.md", "done")] });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.as, "final");
  assert.equal(res.json.data.role, "deliverable", "1.x clients still read the stored word");
  const [link] = await sql`SELECT tags FROM task_node_links WHERE task_id = ${task!.id}`;
  assert.ok((link!.tags as string[]).includes("deliverable"));
});

test("the manifest lists every visible file with version and hash, in pages", async () => {
  const { projectId } = await workspace();
  await post({ projectId, files: [file("a.txt", "a"), file("b/c.txt", "c")] });
  const res = await manifest.GET(new Request(`https://app.test/api/v1/workspaces/${projectId}/manifest`), { params: Promise.resolve({ id: projectId }) });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  const byPath = Object.fromEntries(json.data.files.map((f: { path: string; version: number; contentHash: string }) => [f.path, f]));
  assert.equal(byPath["/a.txt"].version, 1);
  assert.equal(byPath["/b/c.txt"].contentHash, sha("c"));
  assert.equal(json.data.nextCursor, null);
  assert.ok(json.data.limits.largestFileBytes > 0);
});

test("versions only grow: going back makes an old version active, and the next save is based on it", async () => {
  const { owner, projectId } = await workspace();
  for (const [text, base] of [["one", undefined], ["two", 1], ["three", 2]] as const) {
    const res = await post({ projectId, files: [file("doc.md", text, base ? { baseVersion: base } : {})] });
    assert.equal(res.status, 200, JSON.stringify(res.json));
  }
  const [{ id: nodeId }] = await sql<{ id: string }[]>`SELECT id FROM workspace_nodes WHERE workspace_id = ${projectId} AND path = '/doc.md'`;
  const { activateFileVersion, ActiveVersionChangedError } = await loadAppModule(() => import("../../src/lib/files/activate-file-version"));
  const { withTransientFileLease } = await loadAppModule(() => import("../../src/lib/files/file-lock-service"));
  const activate = (version: number, expectActive?: number) =>
    withTransientFileLease({ projectId, nodeId, userId: owner }, (lease) => activateFileVersion({ projectId, nodeId, actorUserId: owner, version, lease, expectActive }));

  const back = await activate(1);
  assert.deepEqual([back.previousVersion, back.node.currentVersion, back.node.s3Key], [3, 1, back.version.s3Key]);
  const rows = await sql`SELECT version, content_hash FROM file_versions WHERE node_id = ${nodeId} ORDER BY version`;
  assert.deepEqual(rows.map((r) => [r.version, r.content_hash]), [[1, sha("one")], [2, sha("two")], [3, sha("three")]], "nothing copied, nothing rewritten");
  const [event] = await sql`SELECT metadata FROM workspace_node_events WHERE node_id = ${nodeId} AND type = 'version_activated'`;
  assert.deepEqual([event!.metadata.from, event!.metadata.to], [3, 1]);

  const stale = await post({ projectId, files: [file("doc.md", "edit from v3", { baseVersion: 3 })] });
  assert.equal(stale.status, 409, "someone who started from v3 is refused after going back");
  const next = await post({ projectId, files: [file("doc.md", "four", { baseVersion: 1 })] });
  assert.equal(next.json.data.files[0].version, 4);
  const [v4] = await sql`SELECT based_on_version FROM file_versions WHERE node_id = ${nodeId} AND version = 4`;
  assert.equal(v4!.based_on_version, 1, "v4 based on v1");

  await assert.rejects(activate(2, 3), ActiveVersionChangedError, "an undo only moves back when nobody saved since");
  assert.equal((await activate(3)).node.currentVersion, 3, "any version can be made active again");
});

test("the old 'apply to active version' mode adds a version instead of rewriting one", async () => {
  const { owner, projectId } = await workspace();
  const first = await post({ projectId, files: [file("old.md", "one")] });
  const nodeId = first.json.data.files[0].nodeId as string;
  const { applyFileRevision } = await loadAppModule(() => import("../../src/lib/files/apply-file-revision"));
  const { withTransientFileLease } = await loadAppModule(() => import("../../src/lib/files/file-lock-service"));
  const result = await withTransientFileLease({ projectId, nodeId, userId: owner }, (lease) => applyFileRevision({
    projectId, nodeId, actorUserId: owner, storageKey: `${projectId}/overwrite-attempt.md`, assetId: null, size: 3, mimeType: "text/markdown",
    contentHash: sha("two"), mode: "active_revision", lease, accessRequirement: "write",
  }));
  assert.deepEqual([result.mode, result.version.version, result.version.basedOnVersion], ["new_revision", 2, 1]);
  const [v1] = await sql`SELECT content_hash FROM file_versions WHERE node_id = ${nodeId} AND version = 1`;
  assert.equal(v1!.content_hash, sha("one"), "v1 is untouched");
});
