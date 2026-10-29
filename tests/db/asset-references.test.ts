import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql, type Tx } from "./_helpers";

let assets: typeof import("../../src/lib/storage/asset-deletion");
let db: typeof import("../../src/lib/db").db;
before(async () => {
  assets = await loadAppModule(() => import("../../src/lib/storage/asset-deletion"));
  ({ db } = await loadAppModule(() => import("../../src/lib/db")));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function verifiedAsset(tx: Tx, projectId: string, owner: string, key: string, hash = "h") {
  const [row] = await tx`INSERT INTO public.storage_assets (workspace_id, owner_user_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, content_hash, expires_at)
    VALUES (${projectId}, ${owner}, 'project-updates-media', ${key}, 'project_update:media', 'verified', 'image/png', 1, 'image/png', 1, now(), ${hash}, now() - interval '1 hour') RETURNING id`;
  return row!.id as string;
}

// COR-045: detaching shared media from one update must not retire it while
// another update still uses it; an already pending one is restored.
test("shared update media stays verified; referenced pending deletions are restored", async () => {
  const fixture = await sql.begin(async (tx) => {
    const owner = await createUser(tx);
    const projectId = await createProject(tx, owner);
    const shared = await verifiedAsset(tx, projectId, owner, `${projectId}/shared.png`);
    const lonely = await verifiedAsset(tx, projectId, owner, `${projectId}/lonely.png`);
    const stale = await verifiedAsset(tx, projectId, owner, `${projectId}/stale.png`);
    const [update] = await tx`INSERT INTO public.workspace_updates (workspace_id, author_id, content) VALUES (${projectId}, ${owner}, 'u') RETURNING id`;
    await tx`INSERT INTO public.workspace_update_media_assets (update_id, asset_id, ordinal) VALUES (${update!.id}, ${shared}, 0), (${update!.id}, ${stale}, 1)`;
    await tx`UPDATE public.storage_assets SET state = 'delete_pending', delete_after = now() WHERE id = ${stale}`;
    return { projectId, shared, lonely, stale };
  });
  try {
    const scheduled = await db.transaction((tx) => assets.scheduleAssetDeletionIfUnreferenced(tx, [fixture.shared, fixture.lonely]));
    assert.deepEqual(scheduled, [fixture.lonely]);
    await assets.deleteEligibleStorageAssets().catch(() => undefined); // storage call may fail offline; the restore runs first
    const [stale] = await sql`SELECT state FROM public.storage_assets WHERE id = ${fixture.stale}`;
    assert.equal(stale?.state, "verified");
  } finally {
    await sql`DELETE FROM public.workspaces WHERE id = ${fixture.projectId}`;
  }
});

// The abandoned-upload sweep failed on every run in production: a raw Date inside sql`` reached the driver unserialized.
test("the abandoned-upload sweep schedules an expired, unreferenced asset", async () => {
  const fixture = await sql.begin(async (tx) => {
    const owner = await createUser(tx);
    const projectId = await createProject(tx, owner);
    return { projectId, abandoned: await verifiedAsset(tx, projectId, owner, `${projectId}/abandoned.png`) };
  });
  try {
    const result = await assets.scheduleAbandonedStorageAssets();
    assert.ok(result.scheduled >= 1);
    const [row] = await sql`SELECT state FROM public.storage_assets WHERE id = ${fixture.abandoned}`;
    assert.equal(row?.state, "delete_pending");
  } finally {
    await sql`DELETE FROM public.workspaces WHERE id = ${fixture.projectId}`;
  }
});
