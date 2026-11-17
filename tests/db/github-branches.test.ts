import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, unprotect } from "./_helpers";

// Report H6 (M8, phase H-5): GitHub feature-x pulls into NetworkBase feature-x (made from main when new), as one save
// "From GitHub", and main is untouched. A review whose branch moved, or whose branch-to-create appeared, stops.
moduleStubs.set("next/headers", { headers: async () => ({ get: () => null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/supabase/server", { createAdminClient: async () => ({ storage: { from: () => ({}) } }), createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) });

type Runner = typeof import("../../src/lib/github/sync-runner");
type Service = typeof import("../../src/lib/github/sync-service");
type Saves = typeof import("../../src/lib/domain/saves");
let runner: Runner;
let service: Service;
let saves: Saves;
before(async () => {
  runner = await loadAppModule(() => import("../../src/lib/github/sync-runner"));
  service = await loadAppModule(() => import("../../src/lib/github/sync-service"));
  saves = await loadAppModule(() => import("../../src/lib/domain/saves"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function asset(workspace: string, userId: string, text: string) {
  const key = `${workspace}/sync-snapshots/${randomUUID()}`;
  const [row] = await sql`INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, content_hash, expires_at, verified_at, verified_size, verified_mime_type)
    VALUES (${userId}, ${workspace}, 'project-files', ${key}, 'workspace_file:file', 'verified', 'text/plain', ${text.length}, ${sha(text)}, now(), now(), ${text.length}, 'text/plain') RETURNING id`;
  return { key, id: row!.id as string };
}

async function setup() {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  const readme = await asset(workspace, owner, "# Main\n");
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version, s3_key, asset_id, mime_type)
    VALUES (${workspace}, 'file', 'README.md', '/README.md', ${owner}, 7, 1, ${readme.key}, ${readme.id}, 'text/plain') RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${node!.id}, 1, ${readme.key}, ${readme.id}, 7, 'text/plain', ${sha("# Main\n")}, ${owner})`;
  await saves.setBranchesEnabled({ user: { id: owner } }, workspace, true);
  await unprotect(workspace);
  return { owner, workspace };
}

async function run(workspace: string, owner: string, manifest: Record<string, unknown>, snapshot: { key: string; id: string }) {
  const leaseId = randomUUID();
  const [r] = await sql`INSERT INTO github_sync_runs (workspace_id, actor_id, status, manifest, lease_id) VALUES (${workspace}, ${owner}, 'running', ${sql.json(manifest as never)}, ${leaseId}) RETURNING id`;
  await sql`INSERT INTO github_sync_snapshot_assets (run_id, asset_id, path) VALUES (${r!.id}, ${snapshot.id}, 'README.md')`;
  return { runId: r!.id as string, leaseId };
}

const file = (snapshotKey: string) => ({
  path: "README.md", nodeId: null, version: 1, storageKey: null, localHash: sha("# Main\n"), localBlobSha: null, remoteSha: "a".repeat(40), baseSha: null, baseCommit: null,
  baseSequence: 0, size: 12, mimeType: "text/plain", mode: "100644", blocked: null, contributors: [], change: "remote", snapshotKey, resultHash: sha("# From GH\n"), resultBlobSha: "b".repeat(40),
});
const manifest = (local: Record<string, unknown>, snapshotKey: string) => ({
  repository: "https://github.com/acme/site", repositoryId: 42, branch: "feature-x", headSha: "c".repeat(40), connectionVersion: 1, sequence: 0,
  direction: "pull", mode: "direct", message: "", files: [file(snapshotKey)], local,
});

test("a pull from GitHub feature-x makes NetworkBase feature-x from main and saves there once; main is untouched", async () => {
  const { owner, workspace } = await setup();
  const incoming = await asset(workspace, owner, "# From GH\n");
  const m = manifest({ branchId: null, name: "feature-x", headSaveId: null }, incoming.key);
  await service.validateBranchSide(workspace, m.local as never);
  const { runId, leaseId } = await run(workspace, owner, m, incoming);
  const result = await runner.pullIntoBranch(m as never, runId, leaseId, workspace, owner, {});
  assert.deepEqual(result.applied, ["README.md"]);
  const [b] = await sql`SELECT id, head_save_id FROM branches WHERE workspace_id = ${workspace} AND name = 'feature-x'`;
  assert.ok(b?.head_save_id, "the branch has the save");
  const [s] = await sql`SELECT kind, message FROM saves WHERE id = ${b!.head_save_id}`;
  assert.deepEqual([s!.kind, s!.message], ["sync", `From GitHub acme/site@${"c".repeat(7)}`]);
  const [bf] = await sql`SELECT content_hash, asset_id FROM branch_files WHERE branch_id = ${b!.id} AND path = '/README.md'`;
  assert.deepEqual([bf!.content_hash, bf!.asset_id], [sha("# From GH\n"), incoming.id]);
  const [{ v }] = await sql`SELECT current_version AS v FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md'`;
  assert.equal(v, 1, "main untouched");
  const [base] = await sql`SELECT branch, node_id, local_hash FROM github_sync_files WHERE workspace_id = ${workspace} AND path = 'README.md'`;
  assert.deepEqual([base!.branch, base!.node_id, base!.local_hash], ["feature-x", null, sha("# From GH\n")]);
  // Running it again (a resumed run) changes nothing.
  const again = await runner.pullIntoBranch(m as never, runId, leaseId, workspace, owner, result);
  assert.equal(again, result);
});

test("the review's branch must be as it was: moved, or created meanwhile, stops the run", async () => {
  const { owner, workspace } = await setup();
  const branches = await loadAppModule(() => import("../../src/lib/domain/branches"));
  const { branch } = await branches.createBranch({ user: { id: owner } }, workspace, { name: "feature-x" });
  await assert.rejects(service.validateBranchSide(workspace, { branchId: null, name: "Feature-X", headSaveId: null }), /appeared after review/);
  const local = { branchId: branch.id, name: "feature-x", headSaveId: null };
  await service.validateBranchSide(workspace, local);
  const moved = await asset(workspace, owner, "x\n");
  await branches.writeBranch(branch.id, { changes: [{ op: "add", path: "/new.md", contentHash: sha("x\n"), assetId: moved.id, size: 2, mimeType: "text/plain" }], message: "x", authorId: owner });
  await assert.rejects(service.validateBranchSide(workspace, local), /changed after review/);
});

test("H16: the old task sandbox is gone: no git deltas table, no canonical node column (0100)", async () => {
  const [t] = await sql`SELECT to_regclass('public.workspace_git_deltas') AS t`;
  assert.equal(t.t, null);
  const cols = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_nodes' AND column_name = 'canonical_node_id'`;
  assert.equal(cols.length, 0);
});
