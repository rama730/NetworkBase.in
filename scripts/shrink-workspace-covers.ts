/**
 * One-off: re-encodes covers saved before uploads were shrunk. Prints what it would do unless --apply is passed.
 * Originals are saved to the folder given by --backup first, because the object is replaced in place.
 *   npx tsx scripts/shrink-workspace-covers.ts --backup=/some/folder [--apply]
 */
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => (request === "server-only" ? {} : originalLoad(request, parent, isMain));

const SHRUNK_BYTES = 300 * 1024;

async function main() {
  const apply = process.argv.includes("--apply");
  const backup = process.argv.find((arg) => arg.startsWith("--backup="))?.slice("--backup=".length);
  if (apply && !backup) throw new Error("--apply needs --backup=<folder>");

  const { db } = await import("@/lib/db");
  const { storageAssets, workspaces } = await import("@/lib/db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { readBoundedStorageBytes } = await import("@/lib/storage/bounded-object-read");
  const { shrinkStoredWorkspaceCover } = await import("@/lib/workspaces/server/cover-image");

  const rows = await db
    .select({
      slug: workspaces.slug,
      assetId: storageAssets.id,
      bucket: storageAssets.bucket,
      storageKey: storageAssets.storageKey,
      size: storageAssets.verifiedSize,
      mimeType: storageAssets.verifiedMimeType,
    })
    .from(workspaces)
    .innerJoin(storageAssets, and(
      eq(storageAssets.bucket, workspaces.coverImageBucket),
      eq(storageAssets.storageKey, workspaces.coverImageKey),
      eq(storageAssets.state, "verified"),
    ))
    .where(isNull(workspaces.deletedAt));

  for (const row of rows) {
    // Already small and already WebP: this script has done it, or the upload path has.
    if (row.mimeType === "image/webp" && (row.size ?? 0) < SHRUNK_BYTES) continue;
    console.info(`${row.slug}: ${row.size} bytes, ${row.mimeType}`);
    if (!apply) continue;
    const original = await readBoundedStorageBytes({ bucket: row.bucket, storageKey: row.storageKey, maxBytes: 2 * 1024 * 1024 });
    fs.mkdirSync(backup!, { recursive: true });
    fs.writeFileSync(path.join(backup!, `${row.assetId}-${path.basename(row.storageKey)}`), Buffer.from(original));
    await shrinkStoredWorkspaceCover(row.assetId);
    const [after] = await db.select({ size: storageAssets.verifiedSize }).from(storageAssets).where(eq(storageAssets.id, row.assetId));
    console.info(`  now ${after?.size} bytes, image/webp`);
  }
  if (!apply) console.info("Nothing changed. Pass --apply to re-encode.");
  process.exit(0);
}

void main();
