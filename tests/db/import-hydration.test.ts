import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report 2026-11-16 (imported files without stored content): hydration stores imported files in resumable batches,
// keeps going past a file that fails, records its status where nothing overwrites it, and never stores bytes that
// don't match the imported Git blob.
const gitSha = (content: Buffer) => createHash("sha1").update(`blob ${content.byteLength}\0`).update(content).digest("hex");

/** What the fake repository archive holds, path → bytes (paths without a leading slash, as in a tarball). */
let archive = new Map<string, Buffer>();
let tarballReads = 0;
let lastMaxBytes = 0;
moduleStubs.set("@/lib/github/tarball-stream", {
  fetchAndParseTarball: async function* (_repo: string, _ref: string, _token: string | undefined, maxBytes: number) {
    tarballReads += 1;
    lastMaxBytes = maxBytes;
    for (const [path, content] of archive) yield { path, content };
  },
});
moduleStubs.set("@/lib/github/auth-resolver", { resolveGithubRepoAccess: async () => ({ source: "none", token: null, installationId: null, normalizedRepoUrl: "https://github.com/o/r" }) });
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({ storage: { from: () => ({ upload: async () => ({ error: null }), info: async () => ({ data: {} }) }) } }),
});
/** The upload helpers, standing in for storage: a verified asset with the bytes' hash. */
moduleStubs.set("@/lib/upload/upload-intents", {
  createUploadIntent: async (p: { storageKey: string; bucket: string }) => ({ id: randomUUID(), status: "pending", storageKey: p.storageKey, bucket: p.bucket }),
  finalizeUploadIntent: async (p: { storageKey: string; projectId: string; userId: string }) => {
    // The hydrate code names the object after the bytes' sha256, so the "verified" asset carries it.
    const hash = /\/imports\/([0-9a-f]{64})-/.exec(p.storageKey)?.[1] ?? null;
    const [asset] = await sql`INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, content_hash, expires_at, verified_at, verified_size, verified_mime_type)
      VALUES (${p.userId}, ${p.projectId}, 'project-files', ${p.storageKey}, 'workspace_file', 'verified', 'text/plain', 1, ${hash}, now() + interval '1 day', now(), 1, 'text/plain') RETURNING id`;
    return { assetId: asset!.id, storageKey: p.storageKey };
  },
});

let hydration: typeof import("../../src/lib/github/import-hydration");
before(async () => {
  hydration = await loadAppModule(() => import("../../src/lib/github/import-hydration"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function importedWorkspace(files: Array<[string, string]>) {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE workspaces SET import_source = ${sql.json({ type: "github", repoUrl: "https://github.com/o/r", branch: "main", metadata: { syncPhase: "ready" } })} WHERE id = ${ws}`;
  archive = new Map();
  for (const [path, text] of files) {
    const bytes = Buffer.from(text);
    archive.set(path, bytes);
    await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, git_blob_hash, current_version)
              VALUES (${ws}, 'file', ${path.split("/").pop()!}, ${`/${path}`}, ${owner}, ${bytes.byteLength}, ${gitSha(bytes)}, 1)`;
  }
  return { owner, ws };
}
const missing = async (ws: string) => Number((await sql`SELECT count(*)::int AS n FROM workspace_nodes WHERE workspace_id = ${ws} AND type = 'file' AND deleted_at IS NULL AND s3_key IS NULL`)[0]!.n);

test("stores every imported file in batches, each with its first version, and finishes as done", async () => {
  const files = Array.from({ length: 12 }, (_, i) => [`src/f${String(i).padStart(2, "0")}.txt`, `file ${i}`] as [string, string]);
  const { owner, ws } = await importedWorkspace(files);
  const run = await hydration.hydrateWorkspace({ projectId: ws, userId: owner, eventId: "e1", ref: "abc", batchSize: 5, step: (_name, fn) => fn() });
  assert.deepEqual({ stored: run.stored, failed: run.failed, remaining: run.remaining, batches: run.batches }, { stored: 12, failed: 0, remaining: 0, batches: 3 });
  assert.equal(await missing(ws), 0);
  const [v] = await sql`SELECT count(*)::int AS n FROM file_versions v JOIN workspace_nodes n ON n.id = v.node_id WHERE n.workspace_id = ${ws} AND v.attribution->>'source' = 'github_hydration'`;
  assert.equal(v!.n, 12);
  const [w] = await sql`SELECT import_source->'metadata'->'hydration' AS h FROM workspaces WHERE id = ${ws}`;
  assert.equal(w!.h.status, "done");
  assert.equal(w!.h.remaining, 0);
});

test("a file that doesn't match its Git blob, or isn't in the archive, is skipped and counted; the rest still arrive", async () => {
  const { owner, ws } = await importedWorkspace([["a.txt", "one"], ["b.txt", "two"], ["c.txt", "three"], ["gone.txt", "four"]]);
  archive.set("b.txt", Buffer.from("changed upstream"));
  archive.delete("gone.txt");
  const run = await hydration.hydrateWorkspace({ projectId: ws, userId: owner, eventId: "e2", ref: "abc", batchSize: 2, step: (_name, fn) => fn() });
  assert.equal(run.stored, 2);
  assert.equal(run.failed, 2);
  assert.equal(run.remaining, 2);
  const [w] = await sql`SELECT import_source->'metadata'->'hydration' AS h FROM workspaces WHERE id = ${ws}`;
  assert.equal(w!.h.status, "incomplete");
  assert.deepEqual([...w!.h.failedSample].sort(), ["/b.txt", "/gone.txt"]);
  const [b] = await sql`SELECT s3_key FROM workspace_nodes WHERE workspace_id = ${ws} AND path = '/b.txt'`;
  assert.equal(b!.s3_key, null, "never bytes that don't match the imported blob");
});

test("a run that stopped part way resumes: only what's still missing is fetched", async () => {
  const files = Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, `v${i}`] as [string, string]);
  const { owner, ws } = await importedWorkspace(files);
  let calls = 0;
  await assert.rejects(hydration.hydrateWorkspace({ projectId: ws, userId: owner, eventId: "e3", ref: "abc", batchSize: 3, step: async (name, fn) => {
    calls += 1;
    if (name === "batch-1") throw new Error("the worker was stopped");
    return fn();
  } }));
  assert.equal(await missing(ws), 3, "the first batch was kept");
  const again = await hydration.hydrateWorkspace({ projectId: ws, userId: owner, eventId: "e3", ref: "abc", batchSize: 3, step: (_name, fn) => fn() });
  assert.equal(again.stored, 3);
  assert.equal(await missing(ws), 0);
  assert.ok(calls >= 2);
});

test("the status is a targeted update: a stale copy of the import record written afterwards doesn't erase it", async () => {
  const { owner, ws } = await importedWorkspace([["x.txt", "x"]]);
  const [{ import_source: stale }] = await sql`SELECT import_source FROM workspaces WHERE id = ${ws}`;
  await hydration.hydrateWorkspace({ projectId: ws, userId: owner, eventId: "e4", ref: "abc", batchSize: 10, step: (_name, fn) => fn() });
  // The import runner used to write its whole record from an earlier copy after sending the event.
  await sql`UPDATE workspaces SET import_source = ${sql.json({ ...stale, metadata: { ...stale.metadata, syncPhase: "ready" } })} WHERE id = ${ws}`;
  assert.equal(await hydration.missingContent(ws), 0, "the files themselves are what count");
  assert.ok(tarballReads > 0);
});

test("a type the storage bucket refuses (TypeScript, Python) is stored as text; the file keeps its own type", async () => {
  const { owner, ws } = await importedWorkspace([["app.ts", "export const x = 1;\n"], ["tool.py", "print(1)\n"]]);
  await sql`UPDATE workspace_nodes SET mime_type = CASE WHEN path = '/app.ts' THEN 'text/typescript' ELSE 'text/x-python' END WHERE workspace_id = ${ws}`;
  const run = await hydration.hydrateWorkspace({ projectId: ws, userId: owner, eventId: "e5", ref: "abc", step: (_name, fn) => fn() });
  assert.equal(run.stored, 2);
  const rows = await sql`SELECT n.path, n.mime_type AS node_type, v.mime_type AS stored_type FROM workspace_nodes n JOIN file_versions v ON v.node_id = n.id WHERE n.workspace_id = ${ws} ORDER BY n.path`;
  assert.deepEqual(rows.map((r) => [r.path, r.node_type, r.stored_type]), [["/app.ts", "text/typescript", "text/plain"], ["/tool.py", "text/x-python", "text/plain"]]);
  assert.equal(hydration.storableType("image/svg+xml"), "image/svg+xml");
  assert.equal(hydration.storableType("application/x-weird"), "application/octet-stream");
});

test("the archive may unpack to the listed files' size plus a margin, at least the usual 100 MB", async () => {
  const { owner, ws } = await importedWorkspace([["big.bin", "x"]]);
  await sql`UPDATE workspace_nodes SET size = ${400 * 1024 * 1024} WHERE workspace_id = ${ws}`;
  await hydration.hydrateWorkspace({ projectId: ws, userId: owner, eventId: "e6", ref: "abc", step: (_name, fn) => fn() });
  assert.equal(lastMaxBytes, Math.ceil(400 * 1024 * 1024 * 1.25) + 50 * 1024 * 1024);
  const small = await importedWorkspace([["s.txt", "s"]]);
  await hydration.hydrateWorkspace({ projectId: small.ws, userId: small.owner, eventId: "e7", ref: "abc", step: (_name, fn) => fn() });
  assert.equal(lastMaxBytes, 100 * 1024 * 1024);
});
