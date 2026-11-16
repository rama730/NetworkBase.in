import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { fileVersions, storageAssets, workspaceNodes, workspaces } from "@/lib/db/schema";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { gitBlobSha } from "@/lib/github/git-blob";
import { fetchAndParseTarball } from "@/lib/github/tarball-stream";
import { logger } from "@/lib/logger";
import { buildWorkspaceFileKey } from "@/lib/storage/workspace-file-key";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

/**
 * Imported files get their content (report 2026-11-16, imported files without stored content). An import lists the
 * repository's files first (no content, each with its Git blob hash); this stores each file's bytes and first
 * version from the repository archive.
 *
 * In batches of files still without content (1,000 at a time), in path order, each batch carrying on after the last path: a file that
 * fails never blocks the rest, a stopped run resumes with what's still missing, and a 17,000-file repository fits in
 * many short steps instead of one long one. The status goes into import_source.metadata.hydration with a targeted
 * update, so nothing that writes the rest of the import record erases it.
 */
/** Each batch reads the archive once; 1,000 files keeps a big repository (17,000 files) to about 17 reads. */
export const HYDRATE_BATCH = 1000;
const UPLOAD_CONCURRENCY = 5;
/** 1,000 × 100 = 100,000 files a run; a bigger repository resumes on the next run. */
const MAX_BATCHES = 100;
const FAILED_SAMPLE = 20;
/** The most any archive may unpack to, whatever the listing says (a workspace holds at most 10 GB). */
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Types the project-files bucket stores (drizzle/0003_storage.sql). The import labels files by extension
 * ("text/typescript", "text/x-python"), which the bucket refuses: those are stored as text/plain, anything else
 * unknown as application/octet-stream. The file keeps its own type for previews (found in the 2026-11-16 backfill).
 */
const STORABLE = new Set(["text/plain", "text/markdown", "text/csv", "text/html", "text/css", "text/javascript", "text/xml", "application/json", "application/xml", "application/octet-stream", "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/bmp", "image/tiff", "image/avif", "image/x-icon", "image/vnd.microsoft.icon", "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/mpeg", "video/ogg", "video/3gpp", "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/aac", "audio/mp4", "audio/x-m4a", "audio/webm", "audio/flac", "application/zip", "application/gzip", "application/x-tar"]);
export const storableType = (mime: string | null | undefined) => {
  const m = (mime ?? "").toLowerCase();
  return STORABLE.has(m) ? m : m.startsWith("text/") ? "text/plain" : "application/octet-stream";
};

type Node = { id: string; path: string; mimeType: string | null; gitHash: string | null; currentVersion: number | null };

/** Imported files with no content yet (they have a Git blob hash to fetch them by). */
export async function missingContent(projectId: string) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceNodes)
    .where(and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.s3Key), isNotNull(workspaceNodes.gitHash)));
  return Number(row?.n ?? 0);
}

/** Merges into import_source.metadata.hydration in one statement. */
export async function setHydrationStatus(projectId: string, patch: Record<string, unknown>) {
  await db.execute(sql`
    UPDATE workspaces
    SET import_source = jsonb_set(
          coalesce(import_source, '{}'::jsonb),
          '{metadata,hydration}',
          coalesce(import_source #> '{metadata,hydration}', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
          true),
        updated_at = now()
    WHERE id = ${projectId}::uuid AND import_source ? 'metadata'
  `);
  await db.execute(sql`
    UPDATE workspaces
    SET import_source = jsonb_set(coalesce(import_source, '{}'::jsonb), '{metadata}', jsonb_build_object('hydration', ${JSON.stringify(patch)}::jsonb), true),
        updated_at = now()
    WHERE id = ${projectId}::uuid AND NOT (coalesce(import_source, '{}'::jsonb) ? 'metadata')
  `);
}

/** Stores one file's bytes and first version, exactly as the import recorded it. Returns false when it lost a race. */
async function publish(input: { projectId: string; userId: string; eventId: string; node: Node; content: Buffer }) {
  const { projectId, userId, eventId, node, content } = input;
  if (node.gitHash && gitBlobSha(content) !== node.gitHash) throw new Error("doesn't match the imported Git blob");
  if (content.byteLength > WORKSPACE_UPLOAD_MAX_FILE_BYTES) throw new Error(`over the ${WORKSPACE_UPLOAD_MAX_FILE_BYTES} byte limit`);
  const mimeType = storableType(node.mimeType);
  const contentHash = createHash("sha256").update(content).digest("hex");
  const operationIdentity = createHash("sha256").update(`${eventId}:${node.id}`).digest("hex").slice(0, 32);
  const extension = node.path.split(".").pop()?.toLowerCase();
  const suffix = extension && /^[a-z0-9]{1,16}$/.test(extension) ? `.${extension}` : "";
  const s3Key = buildWorkspaceFileKey(projectId, `nodes/${node.id}/imports/${contentHash}-${operationIdentity}${suffix}`);
  const intent = await createUploadIntent({
    userId, projectId, bucket: "project-files", storageKey: s3Key, scope: "workspace_file", kind: "file",
    expectedMimeType: mimeType, expectedSize: content.byteLength,
    idempotencyKey: `github-hydrate:${eventId}:${node.id}`,
    metadata: { source: "github_hydration", nodeId: node.id, path: node.path, operationId: eventId },
  });
  if (intent.status === "pending") {
    const storage = (await createAdminClient()).storage.from("project-files");
    const { error } = await storage.upload(intent.storageKey, content, { contentType: mimeType, cacheControl: "31536000", upsert: false });
    if (error) {
      const { data: existing } = await storage.info(intent.storageKey);
      if (!existing) throw error;
    }
  }
  const verified = await finalizeUploadIntent({ intentId: intent.id, bucket: intent.bucket, storageKey: intent.storageKey, userId, projectId, expectedScope: "workspace_file", expectedKind: "file" });
  if (!verified.assetId) throw new Error("the stored file is unavailable");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM workspace_nodes WHERE id = ${node.id} AND workspace_id = ${projectId} FOR UPDATE`);
    const current = await tx.query.workspaceNodes.findFirst({ where: and(eq(workspaceNodes.id, node.id), eq(workspaceNodes.projectId, projectId)) });
    if (!current || current.deletedAt) return false;
    if (current.s3Key) return current.assetId === verified.assetId;
    const [asset] = await tx.update(storageAssets)
      .set({ backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`, updatedAt: new Date() })
      .where(and(eq(storageAssets.id, verified.assetId!), eq(storageAssets.state, "verified"), eq(storageAssets.contentHash, contentHash)))
      .returning({ id: storageAssets.id });
    if (!asset) throw new Error("the stored bytes failed their check");
    const [version] = await tx.insert(fileVersions)
      .values({ nodeId: node.id, version: current.currentVersion, s3Key: intent.storageKey, assetId: asset.id, size: content.byteLength, mimeType, contentHash, uploadedBy: userId, attribution: { source: "github_hydration", eventId } })
      .onConflictDoNothing()
      .returning({ id: fileVersions.id });
    if (!version) throw new Error("its first version already has other content");
    const updated = await tx.update(workspaceNodes)
      .set({ s3Key: intent.storageKey, assetId: asset.id, size: content.byteLength, syncStatus: "merged", updatedAt: new Date() })
      .where(and(eq(workspaceNodes.id, node.id), isNull(workspaceNodes.s3Key)))
      .returning({ id: workspaceNodes.id });
    if (updated.length !== 1) throw new Error("another run stored it first");
    return true;
  });
}

/**
 * One batch: up to `limit` files still without content whose path sorts after `after`, read from one pass over the
 * archive (the pass stops once all of them are found). Files missing from the archive, or whose bytes don't match,
 * are counted as failed and left for a later run to report; they never block the next batch.
 */
export async function hydrateBatch(input: { projectId: string; userId: string; eventId: string; ref: string; after: string; limit?: number }) {
  const limit = input.limit ?? HYDRATE_BATCH;
  const nodes: Node[] = await db.select({ id: workspaceNodes.id, path: workspaceNodes.path, mimeType: workspaceNodes.mimeType, gitHash: workspaceNodes.gitHash, currentVersion: workspaceNodes.currentVersion })
    .from(workspaceNodes)
    .where(and(eq(workspaceNodes.projectId, input.projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.s3Key), isNotNull(workspaceNodes.gitHash), gt(workspaceNodes.path, input.after)))
    .orderBy(asc(workspaceNodes.path))
    .limit(limit);
  if (!nodes.length) return { stored: 0, failed: 0, failedPaths: [] as string[], lastPath: null as string | null };
  const [project] = await db.select({ importSource: workspaces.importSource }).from(workspaces).where(eq(workspaces.id, input.projectId)).limit(1);
  const source = (project?.importSource ?? {}) as { repoUrl?: string; metadata?: Record<string, unknown> };
  if (!source.repoUrl) throw new Error("This workspace has no repository to download from");
  // Current repository access from the workspace's sealed credential or the GitHub App; never one from the event.
  const access = await resolveGithubRepoAccess({
    repoUrl: source.repoUrl,
    preferredInstallationId: (source.metadata?.githubInstallationId as string | number | null | undefined) ?? null,
    sealedImportToken: source.metadata?.importAuth as string | undefined,
  });
  const wanted = new Map(nodes.map((n) => [n.path.replace(/^\/+/, ""), n]));
  // The archive may unpack to what the import listed (every file's size) plus a margin, never more: the import's own
  // 100 MB guard stays for archives nobody has listed yet.
  const [listed] = await db.select({ bytes: sql<string>`coalesce(sum(${workspaceNodes.size}), 0)` }).from(workspaceNodes)
    .where(and(eq(workspaceNodes.projectId, input.projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt)));
  const maxBytes = Math.min(MAX_ARCHIVE_BYTES, Math.max(100 * 1024 * 1024, Math.ceil(Number(listed?.bytes ?? 0) * 1.25) + 50 * 1024 * 1024));
  let stored = 0;
  const failedPaths: string[] = [];
  let inFlight: Promise<void>[] = [];
  /** Why files failed, counted: one log line a batch, not one a file (Railway drops a flood). */
  const reasons = new Map<string, number>();
  for await (const file of fetchAndParseTarball(source.repoUrl, input.ref, access.token ?? undefined, maxBytes)) {
    const node = wanted.get(file.path);
    if (!node) continue;
    wanted.delete(file.path);
    inFlight.push(publish({ ...input, node, content: Buffer.from(file.content) }).then(
      (ok) => { if (ok) stored += 1; },
      (error: unknown) => {
        failedPaths.push(node.path);
        const reason = (error instanceof Error ? error.message : String(error)).slice(0, 120);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      },
    ));
    if (inFlight.length >= UPLOAD_CONCURRENCY) { await Promise.all(inFlight); inFlight = []; }
    if (wanted.size === 0) break;
  }
  await Promise.all(inFlight);
  // Not in the repository at this commit (renamed or deleted since the listing).
  for (const node of wanted.values()) failedPaths.push(node.path);
  if (wanted.size) reasons.set("not in the repository at this commit", wanted.size);
  // Strings, not objects: the logger keeps only flat values (found in the 2026-11-16 backfill).
  if (failedPaths.length) logger.warn("github.hydrate.batch_failures", { module: "github", projectId: input.projectId, failed: failedPaths.length, count: stored, reason: [...reasons].map(([r, n]) => `${n}× ${r}`).join(" | ").slice(0, 600), path: failedPaths.slice(0, 5).join(", ") });
  return { stored, failed: failedPaths.length, failedPaths, lastPath: nodes.at(-1)!.path };
}

/**
 * The whole run, as steps: each batch is one step (`step` is Inngest's step.run, or a direct call in tests), so a
 * retry redoes only its own batch and a run that stopped resumes with what's still missing.
 */
export async function hydrateWorkspace(input: {
  projectId: string; userId: string; eventId: string; ref: string; batchSize?: number;
  step: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const { projectId, step } = input;
  const total = await step("count", () => missingContent(projectId));
  await step("start", () => setHydrationStatus(projectId, { status: "in_progress", total, stored: 0, failed: 0, startedAt: new Date().toISOString() }));
  let after = "";
  let stored = 0;
  let failed = 0;
  let batches = 0;
  const failedSample: string[] = [];
  for (let i = 0; i < MAX_BATCHES; i++) {
    // The batch writes its progress itself: one step per batch.
    const batch = await step(`batch-${i}`, async () => {
      const done = await hydrateBatch({ projectId, userId: input.userId, eventId: input.eventId, ref: input.ref, after, limit: input.batchSize });
      if (done.lastPath) await setHydrationStatus(projectId, { stored: stored + done.stored, failed: failed + done.failed });
      return done;
    });
    if (!batch.lastPath) break;
    batches += 1;
    stored += batch.stored;
    failed += batch.failed;
    failedSample.push(...batch.failedPaths.slice(0, FAILED_SAMPLE - failedSample.length));
    after = batch.lastPath;
  }
  const remaining = await step("remaining", () => missingContent(projectId));
  await step("finish", () => setHydrationStatus(projectId, {
    status: remaining === 0 ? "done" : "incomplete", stored, failed, remaining, failedSample, finishedAt: new Date().toISOString(),
  }));
  return { stored, failed, remaining, batches };
}
