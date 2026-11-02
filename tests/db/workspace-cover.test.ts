import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

import sharp from "sharp";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Real database and real image encoder; only the storage provider is replaced.
let stored = Buffer.alloc(0);
let storedType = "";
moduleStubs.set("@/lib/storage/bounded-object-read", { readBoundedStorageBytes: async () => stored });
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({
    storage: {
      from: () => ({
        update: async (_key: string, bytes: Buffer, options: { contentType: string }) => {
          stored = bytes;
          storedType = options.contentType;
          return { error: null };
        },
      }),
    },
  }),
});

let cover: typeof import("@/lib/workspaces/server/cover-image");
const created: string[] = [];
const assets: string[] = [];

before(async () => {
  cover = await loadAppModule(() => import("@/lib/workspaces/server/cover-image"));
});
afterEach(async () => {
  if (assets.length) await sql`DELETE FROM public.storage_assets WHERE id IN ${sql(assets)}`;
  if (created.length) {
    await sql`DELETE FROM public.storage_quota_scopes WHERE scope_id IN ${sql(created)}`;
    await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  }
  created.length = 0;
  assets.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function frame(size: number, noise: boolean, red = 0) {
  if (!noise) return sharp({ create: { width: size, height: size, channels: 3, background: { r: red, g: 40, b: 90 } } }).png().toBuffer();
  return sharp(randomBytes(size * size * 3), { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

async function animatedGif(frames: number, size: number, noise = false) {
  const images = await Promise.all(Array.from({ length: frames }, (_, index) => frame(size, noise, index * 20)));
  return sharp(images, { join: { animated: true } }).gif().toBuffer();
}

test("an animated picture becomes a small square WebP and keeps every frame", async () => {
  const rendered = await cover.renderWorkspaceCover(await animatedGif(6, 400));
  const metadata = await sharp(rendered, { animated: true }).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.pages, 6);
  assert.equal(metadata.width, 256);
  assert.equal(metadata.pageHeight, 256);
});

test("a still picture comes out at the same small size", async () => {
  const rendered = await cover.renderWorkspaceCover(await frame(1024, false));
  const metadata = await sharp(rendered).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.ok(rendered.length < 300 * 1024);
});

test("an animation still over the limit after shrinking is refused", async () => {
  await assert.rejects(cover.renderWorkspaceCover(await animatedGif(40, 300, true)), cover.CoverTooLargeError);
});

test("shrinking a stored cover updates the object and the asset, and gives the saved bytes back to the quota", async () => {
  const owner = await sql.begin((tx) => createUser(tx, {}));
  created.push(owner);
  stored = await animatedGif(6, 400);
  const original = stored.length;
  const padded = original + 500_000;
  const [asset] = await sql`
    INSERT INTO public.storage_assets
      (owner_user_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size,
       verified_mime_type, verified_size, content_hash, expires_at, verified_at, quota_tracked)
    VALUES
      (${owner}, 'project-files', ${`cover-${randomUUID()}.gif`}, 'project_cover', 'verified', 'image/gif', ${padded},
       'image/gif', ${padded}, 'old', now() + interval '1 year', now(), true)
    RETURNING id`;
  assets.push(asset!.id as string);
  await sql`INSERT INTO public.storage_quota_scopes (scope_type, scope_id, limit_bytes, retained_bytes)
            VALUES ('user', ${owner}, 1000000000, ${padded + 1000})`;

  await cover.shrinkStoredWorkspaceCover(asset!.id as string);

  assert.equal(storedType, "image/webp");
  const [row] = await sql`SELECT verified_size, verified_mime_type, content_hash FROM public.storage_assets WHERE id = ${asset!.id as string}`;
  assert.equal(Number(row!.verified_size), stored.length);
  assert.equal(row!.verified_mime_type, "image/webp");
  assert.notEqual(row!.content_hash, "old");
  const [quota] = await sql`SELECT retained_bytes FROM public.storage_quota_scopes WHERE scope_type = 'user' AND scope_id = ${owner}`;
  assert.equal(Number(quota!.retained_bytes), stored.length + 1000);
});
