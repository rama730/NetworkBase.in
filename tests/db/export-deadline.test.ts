import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import { sql as drizzleSql } from "drizzle-orm";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let exporter: typeof import("../../src/lib/files/folder-export");
const users: string[] = [];
const realFetch = globalThis.fetch;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const stream = exporter.streamFolderExport({ prepared, requestSignal: new AbortController().signal, reauthorize: async () => undefined, maxMs: 800 });
  await wait(300); // nobody reads, so the export parks on a write
  assert.equal(await pinsOf(seeded.assetId), 1, "still running while within the deadline");

  await wait(800);
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

async function seedSubmission(options: { who: string; state?: string; fileNames?: string[] }) {
  return sql.begin(async (tx) => {
    const owner = await createUser(tx);
    users.push(owner);
    const projectId = await createProject(tx, owner);
    const masterId = randomUUID();
    await tx`INSERT INTO public.tasks (id, workspace_id, title, kind) VALUES (${masterId}, ${projectId}, 'Essay', 'assignment')`;
    const copyId = randomUUID();
    await tx`INSERT INTO public.tasks (id, workspace_id, title, assignment_id, status, team_name) VALUES (${copyId}, ${projectId}, 'Essay', ${masterId}, 'done', ${options.who})`;
    for (const name of options.fileNames ?? ["report.pdf"]) {
      const key = `${projectId}/files/${randomUUID()}`;
      const state = options.state ?? "verified";
      const [asset] = await tx`
        INSERT INTO public.storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, content_hash, expires_at)
        VALUES (${owner}, ${projectId}, 'project-files', ${key}, 'workspace_file', ${state}, 'text/plain', 5, ${state === "verified" ? "text/plain" : null}, ${state === "verified" ? 5 : null}, ${state === "verified" ? new Date() : null}, 'hash', now() + interval '1 day')
        RETURNING id`;
      await tx`INSERT INTO public.workspace_nodes (workspace_id, type, name, s3_key, asset_id, size, mime_type, path, task_id)
        VALUES (${projectId}, 'file', ${name}, ${key}, ${asset!.id}, 5, 'text/plain', ${`/${randomUUID()}`}, ${copyId})`;
    }
    return masterId;
  });
}

test("a submissions check gives the same answer as the download when a file isn't ready", async () => {
  const masterId = await seedSubmission({ who: "Priya", state: "pending" });
  await assert.rejects(exporter.prepareSubmissionsExport({ masterId, dryRun: true }), /isn’t ready to download yet/);
  await assert.rejects(exporter.prepareSubmissionsExport({ masterId }), /isn’t ready to download yet/);
});

test("a person named only dots can't climb out of the folder a zip is unpacked into", async () => {
  const masterId = await seedSubmission({ who: "..", fileNames: ["..", "report.pdf"] });
  const { entries } = await exporter.prepareSubmissionsExport({ masterId, dryRun: true });
  const paths = entries.map((entry) => entry.path);
  assert.ok(paths.every((path) => !path.split("/").includes("..")), paths.join());
  assert.ok(paths.includes("Untitled"));
  assert.equal(new Set(paths.map((path) => path.toLowerCase())).size, paths.length, "no two entries merge when unpacked");
});

test("a zip that fails partway releases its files even if nobody is reading", async () => {
  const seeded = await seedFolderWithFile();
  const prepared = await exporter.prepareFolderExport({ projectId: seeded.projectId, folderId: null, canReadTaskFiles: true });
  assert.equal(await pinsOf(seeded.assetId), 1);
  globalThis.fetch = (async () => new Response("gone", { status: 404 })) as typeof fetch;
  exporter.streamFolderExport({ prepared, requestSignal: new AbortController().signal, reauthorize: async () => undefined });
  await wait(300);
  assert.equal(await pinsOf(seeded.assetId), 0);
});
