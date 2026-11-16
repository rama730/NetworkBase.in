import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report 2026-11-16: Fetch now on a file not downloaded from GitHub yet queues one download for the whole workspace
// (it resumes with what's missing), for people who can change the workspace, once every 10 minutes.
let viewerId = "";
const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
const used = new Set<string>();
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: viewerId ? { id: viewerId } : null }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("@/inngest/client", { inngest: { send: async (e: { name: string; data: Record<string, unknown> }) => { sent.push(e); return { ids: ["x"] }; } } });
moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async (key: string) => { const allowed = !used.has(key); used.add(key); return { allowed }; } });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let action: typeof import("../../src/app/actions/files/import-download");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  action = await loadAppModule(() => import("../../src/app/actions/files/import-download"));
});
after(async () => { await sql.end(); await closeAppDb(); });

test("an owner's Fetch now queues one download of what's missing; a viewer can't; a second click within 10 minutes doesn't queue another", async () => {
  const [owner, viewer] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql.begin(async (tx) => { await addMember(tx, ws, owner!, "owner"); await addMember(tx, ws, viewer!, "viewer"); });
  await sql`UPDATE workspaces SET import_source = ${sql.json({ type: "github", repoUrl: "https://github.com/o/r", branch: "main", metadata: { importAuth: "sealed-secret" } })}, github_last_commit_sha = 'abc123' WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, git_blob_hash) VALUES (${ws}, 'file', 'a.md', '/a.md', ${owner!}, 10, ${"a".repeat(40)}), (${ws}, 'file', 'b.md', '/b.md', ${owner!}, 10, ${"b".repeat(40)})`;

  viewerId = viewer!;
  assert.equal((await action.requestImportDownloadAction(ws)).success, false);
  assert.equal(sent.length, 0);

  viewerId = owner!;
  const first = await action.requestImportDownloadAction(ws);
  assert.deepEqual(first, { success: true, remaining: 2 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.name, "workspace/import.hydrate");
  assert.equal(sent[0]!.data.commitSha, "abc123");
  assert.ok(!JSON.stringify(sent[0]!.data).includes("sealed-secret"), "the event never carries the credential");
  const [w] = await sql`SELECT import_source->'metadata'->'hydration'->>'status' AS s FROM workspaces WHERE id = ${ws}`;
  assert.equal(w!.s, "queued");

  const again = await action.requestImportDownloadAction(ws);
  assert.equal(again.success && "alreadyQueued" in again && again.alreadyQueued, true);
  assert.equal(sent.length, 1);
});
