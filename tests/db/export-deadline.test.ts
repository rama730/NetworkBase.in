import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, mock, test } from "node:test";
import { sql as drizzleSql } from "drizzle-orm";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let exporter: typeof import("../../src/lib/files/folder-export");
const users: string[] = [];
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const realWait = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

before(async () => {
  moduleStubs.set("@/lib/supabase/server", {
    createClient: async () => { throw new Error("not used"); },
    createAdminClient: async () => ({
      storage: { from: () => ({ createSignedUrls: async (keys: string[]) => ({ data: keys.map((key) => ({ signedUrl: `https://storage.test/${key}`, error: null })), error: null }) }) },
    }),
  });
  exporter = await loadAppModule(() => import("../../src/lib/files/folder-export"));
});
afterEach(async () => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
  if (users.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(users)}`;
  users.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function seedFolderWithFile() {
  return sql.begin(async (tx) => {
    const owner = await createUser(tx);
    users.push(owner);
    const projectId = await createProject(tx, owner);
    const key = `${projectId}/files/${randomUUID()}`;
    const [asset] = await tx`
      INSERT INTO public.storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, content_hash, expires_at)
      VALUES (${owner}, ${projectId}, 'project-files', ${key}, 'workspace_file', 'verified', 'text/plain', 5, 'text/plain', 5, now(), 'hash', now() + interval '1 day')
      RETURNING id`;
    const [node] = await tx`INSERT INTO public.workspace_nodes (workspace_id, type, name, s3_key, asset_id, size, mime_type, path)
      VALUES (${projectId}, 'file', 'a.txt', ${key}, ${asset!.id}, 5, 'text/plain', ${`/${randomUUID()}`}) RETURNING id`;
    return { projectId, assetId: asset!.id as string, nodeId: node!.id as string };
  });
}
const pinsOf = async (assetId: string) => (await sql`SELECT count(*)::int AS n FROM public.storage_asset_pins WHERE asset_id = ${assetId}`)[0]!.n as number;

test("a client that stops reading can't hold an export past 30 minutes, and its pins are released", async () => {
  const seeded = await seedFolderWithFile();
  const prepared = await exporter.prepareFolderExport({ projectId: seeded.projectId, folderId: null, canReadTaskFiles: true });
  assert.equal(await pinsOf(seeded.assetId), 1);
  globalThis.fetch = (async () => new Response("hello")) as typeof fetch;

  mock.timers.enable({ apis: ["setTimeout"] });
  const stream = exporter.streamFolderExport({ prepared, requestSignal: new AbortController().signal, reauthorize: async () => undefined });
  await realWait(300); // nobody reads, so the export parks on a write
  assert.equal(await pinsOf(seeded.assetId), 1, "still running while within the deadline");

  mock.timers.tick(30 * 60 * 1000);
  await realWait(300);
  assert.equal(await pinsOf(seeded.assetId), 0, "released at the deadline");
  await assert.rejects(stream.getReader().read(), /30 minutes/);
});

test("a zip stops when folder rules change, but not because a teammate deleted a file", async () => {
  const seeded = await seedFolderWithFile();
  const entries = [{ id: seeded.nodeId, path: "a.txt", type: "file" as const, bucket: "project-files", storageKey: "k", assetId: seeded.assetId, size: 5 }];
  const allowed = () => drizzleSql`true`;
  const refused = () => drizzleSql`false`;
  assert.equal(await exporter.exportEntriesStillVisible(entries, allowed), true);
  assert.equal(await exporter.exportEntriesStillVisible(entries, refused), false);
  await sql`UPDATE public.workspace_nodes SET deleted_at = now() WHERE id = ${seeded.nodeId}`;
  assert.equal(await exporter.exportEntriesStillVisible(entries, allowed), true);
});

test("a dry run pins nothing, and files with no stored copy are counted", async () => {
  const seeded = await seedFolderWithFile();
  await sql`INSERT INTO public.workspace_nodes (workspace_id, type, name, path) VALUES (${seeded.projectId}, 'file', 'linked.md', ${`/${randomUUID()}`})`;
  const prepared = await exporter.prepareFolderExport({ projectId: seeded.projectId, folderId: null, canReadTaskFiles: true, dryRun: true });
  assert.equal(prepared.skippedFiles, 1);
  assert.equal(prepared.entries.filter((entry) => entry.type === "file").length, 1);
  assert.equal(await pinsOf(seeded.assetId), 0);
});
