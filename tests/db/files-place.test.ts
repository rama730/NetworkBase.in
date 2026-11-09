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
