'use server';

import { db } from '@/lib/db';
import { fileVersions, projects, projectNodes, storageAssets } from '@/lib/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { isCanonicalProjectFileKey, parseProjectFileKey } from '@/lib/storage/project-file-key';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { buildProjectImportEventId, buildUploadManifestHash } from '@/lib/import/idempotency';
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  normalizeAndValidateUploadRelativePath,
  PROJECT_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/upload/security';
import { finalizeUploadIntent } from '@/lib/upload/upload-intents';

export type UploadManifestEntry = {
  relativePath: string;
  size?: number | null;
  mimeType?: string | null;
  storageKey: string;
  uploadIntentId: string;
};

export type UploadReconcilePolicy = 'mirror' | 'additive';

export type UploadRegisterOptions = {
  sessionId?: string | null;
  manifestHash?: string | null;
  reconcilePolicy?: UploadReconcilePolicy;
};

type UploadSessionState = {
  sessionId: string;
  manifestHash: string;
  totalFiles: number;
  uploadedFiles: number;
  startedAt: string;
  lastActivityAt: string;
  status: 'pending' | 'uploading' | 'registering' | 'reconciling' | 'ready' | 'failed';
};

function normalizeManifestEntry(entry: UploadManifestEntry, projectId: string) {
  const relativePath = normalizeAndValidateUploadRelativePath(entry.relativePath);
  const size = normalizeAndValidateFileSize(entry.size ?? 0, PROJECT_UPLOAD_MAX_FILE_BYTES);
  const mimeType = normalizeAndValidateMimeType(entry.mimeType ?? 'application/octet-stream');
  const storageKey = typeof entry.storageKey === 'string' ? entry.storageKey.trim() : '';
  const parsedKey = parseProjectFileKey(storageKey);
  if (!parsedKey || !isCanonicalProjectFileKey(storageKey) || parsedKey.projectId !== projectId) {
    throw new Error('Invalid folder upload storage key');
  }
  const uploadIntentId = typeof entry.uploadIntentId === 'string' ? entry.uploadIntentId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadIntentId)) {
    throw new Error('Invalid folder upload intent');
  }
  return { relativePath, size, mimeType, storageKey, uploadIntentId };
}

function splitDirParts(dir: string) {
  return dir.split('/').map(s => s.trim()).filter(Boolean);
}

const BATCH_SIZE = 500;
const ROOT_KEY = 'root';
const LOCK_NAMESPACE = 'project-git-sync';

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function makeKey(parentId: string | null, name: string) {
  return `${parentId ?? ROOT_KEY}::${name}`;
}

function normalizeSessionId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return randomUUID();
  return raw.length > 120 ? raw.slice(0, 120) : raw;
}

function getProjectImportSource(importSource: unknown): Record<string, unknown> {
  if (importSource && typeof importSource === 'object') {
    return importSource as Record<string, unknown>;
  }
  return { type: 'upload' };
}

function getImportMetadata(importSource: Record<string, unknown>): Record<string, unknown> {
  const metadata = importSource.metadata;
  if (metadata && typeof metadata === 'object') {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function buildUploadImportSource(
  currentImportSource: unknown,
  metadataUpdates: Record<string, unknown>,
): Record<string, unknown> {
  const source = getProjectImportSource(currentImportSource);
  const metadata = getImportMetadata(source);
  return {
    ...source,
    type: 'upload',
    metadata: {
      ...metadata,
      ...metadataUpdates,
    },
  };
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function withProjectSyncLock<T>(
  projectId: string,
  task: (tx: DbTransaction) => Promise<T>,
): Promise<{ skipped: boolean; value: T | null }> {
  // ponytail: transaction-scoped advisory lock (pg_try_advisory_xact_lock) releases automatically on commit/rollback. ceiling: single Postgres primary. upgrade: Redis redlock if multi-region active-active deployment required.
  return await db.transaction(async (tx) => {
    const lockResult = await tx.execute<{ locked: boolean }>(sql`
      SELECT pg_try_advisory_xact_lock(
        hashtext(${LOCK_NAMESPACE}),
        hashtext(CAST(${projectId} AS text))
      ) AS locked
    `);
    const lockRow = Array.from(lockResult)[0];
    const lockAcquired = !!lockRow?.locked;
    if (!lockAcquired) {
      return { skipped: true, value: null };
    }

    const value = await task(tx);
    return { skipped: false, value };
  });
}

async function fetchExistingNodes(
  tx: any,
  projectId: string,
  type: 'folder' | 'file',
  entries: Array<{ parentId: string | null; name: string }>
) {
  const map = new Map<string, {
    id: string;
    parentId: string | null;
    name: string;
    currentVersion: number;
  }>();
  if (entries.length === 0) return map;

  for (const batch of chunkArray(entries, BATCH_SIZE)) {
    const parentIds = Array.from(new Set(batch.map(b => b.parentId)));
    const names = Array.from(new Set(batch.map(b => b.name))).filter(Boolean);
    if (names.length === 0) continue;

    const hasRoot = parentIds.includes(null);
    const nonNullParents = parentIds.filter(p => p !== null) as string[];

    const conditions: any[] = [
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.type, type),
      isNull(projectNodes.deletedAt),
      inArray(projectNodes.name, names),
    ];

    if (hasRoot && nonNullParents.length > 0) {
      conditions.push(sql`(${inArray(projectNodes.parentId, nonNullParents)} OR ${isNull(projectNodes.parentId)})`);
    } else if (hasRoot) {
      conditions.push(isNull(projectNodes.parentId));
    } else if (nonNullParents.length > 0) {
      conditions.push(inArray(projectNodes.parentId, nonNullParents));
    } else {
      continue;
    }

    const rows = await tx
      .select({
        id: projectNodes.id,
        parentId: projectNodes.parentId,
        name: projectNodes.name,
        currentVersion: projectNodes.currentVersion,
      })
      .from(projectNodes)
      .where(and(...conditions));

    for (const r of rows) {
      map.set(makeKey(r.parentId ?? null, r.name), {
        id: r.id,
        parentId: r.parentId ?? null,
        name: r.name,
        currentVersion: r.currentVersion,
      });
    }
  }

  return map;
}

export async function updateUploadSessionAction(
  projectId: string,
  input: {
    sessionId: string;
    manifestHash: string;
    totalFiles: number;
    uploadedFiles: number;
    status: UploadSessionState['status'];
    importEventId?: string | null;
  },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to continue');

  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, importSource: projects.importSource })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Workspace not found');
  if (project.ownerId !== user.id) throw new Error('Sign in to continue');

  const nowIso = new Date().toISOString();
  const sessionId = normalizeSessionId(input.sessionId);
  const manifestHash = (input.manifestHash || '').trim() || 'empty';
  const totalFiles = Math.max(0, Math.floor(Number(input.totalFiles || 0)));
  const uploadedFiles = Math.max(0, Math.floor(Number(input.uploadedFiles || 0)));
  const importEventId =
    (typeof input.importEventId === 'string' && input.importEventId.trim().length > 0)
      ? input.importEventId.trim()
      : buildProjectImportEventId({
        projectId,
        source: 'upload',
        normalizedTarget: 'upload',
        branchOrManifestHash: manifestHash,
      });

  const currentImportSource = getProjectImportSource(project.importSource);
  const currentMetadata = getImportMetadata(currentImportSource);
  const prevSession = (currentMetadata.uploadSession && typeof currentMetadata.uploadSession === 'object')
    ? currentMetadata.uploadSession as Record<string, unknown>
    : null;
  const existingSessionId = typeof prevSession?.sessionId === 'string'
    ? prevSession.sessionId
    : null;
  const existingLastActivityAt = typeof prevSession?.lastActivityAt === 'string'
    ? prevSession.lastActivityAt
    : null;
  const existingLastActivityMs = existingLastActivityAt ? Date.parse(existingLastActivityAt) : NaN;
  const incomingLastActivityMs = Date.parse(nowIso);

  if (
    existingSessionId &&
    existingSessionId !== sessionId &&
    Number.isFinite(existingLastActivityMs) &&
    Number.isFinite(incomingLastActivityMs) &&
    existingLastActivityMs > incomingLastActivityMs
  ) {
    const existingManifestHash = typeof prevSession?.manifestHash === 'string' && prevSession.manifestHash.trim().length > 0
      ? prevSession.manifestHash
      : manifestHash;
    const existingImportEventId =
      typeof currentMetadata.importEventId === 'string' && currentMetadata.importEventId.trim().length > 0
        ? currentMetadata.importEventId
        : importEventId;

    return {
      success: true as const,
      sessionId: existingSessionId,
      manifestHash: existingManifestHash,
      importEventId: existingImportEventId,
    };
  }

  const startedAt = typeof prevSession?.startedAt === 'string' ? prevSession.startedAt : nowIso;
  const nextSource = buildUploadImportSource(currentImportSource, {
    syncPhase: input.status,
    importEventId,
    uploadSession: {
      sessionId,
      manifestHash,
      totalFiles,
      uploadedFiles,
      startedAt,
      lastActivityAt: nowIso,
      status: input.status,
    } satisfies UploadSessionState,
  });

  await db.update(projects)
    .set({
      importSource: nextSource as any,
      syncStatus: input.status === 'failed'
        ? 'failed'
        : input.status === 'ready'
          ? 'ready'
          : input.status === 'pending' || input.status === 'uploading'
            ? 'pending'
            : 'indexing',
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return {
    success: true as const,
    sessionId,
    manifestHash,
    importEventId,
  };
}

export async function registerUploadedFolderAction(
  projectId: string,
  manifest: UploadManifestEntry[],
  options?: UploadRegisterOptions,
) {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to continue');


  const [project] = await db
    .select({
      id: projects.id,
      ownerId: projects.ownerId,
      slug: projects.slug,
      importSource: projects.importSource,
      syncStatus: projects.syncStatus,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Workspace not found');
  if (project.ownerId !== user.id) throw new Error('Sign in to continue');

  if (!Array.isArray(manifest) || manifest.length > 5_000) {
    throw new Error('Folder upload exceeds the 5,000 file limit');
  }
  const entries = manifest.map((entry) => normalizeManifestEntry(entry, projectId));
  const totalDeclaredBytes = entries.reduce((total, entry) => total + entry.size, 0);
  if (!Number.isSafeInteger(totalDeclaredBytes) || totalDeclaredBytes > 1024 * 1024 * 1024) {
    throw new Error('Folder upload exceeds the 1 GiB operation limit');
  }
  if (new Set(entries.map((entry) => entry.relativePath.toLowerCase())).size !== entries.length) {
    throw new Error('Folder manifest contains duplicate paths');
  }
  if (new Set(entries.map((entry) => entry.storageKey)).size !== entries.length) {
    throw new Error('Folder manifest reuses an uploaded asset');
  }

  const finalizedByStorageKey = new Map<string, {
    assetId: string;
    contentHash: string | null;
    finalizedSize: number;
    finalizedMimeType: string;
  }>();
  if (entries.length > 0) {
    const FINALIZE_BATCH_SIZE = 50;
    for (const batch of chunkArray(entries, FINALIZE_BATCH_SIZE)) {
      const finalized: Awaited<ReturnType<typeof finalizeUploadIntent>>[] = [];
      for (const verifyBatch of chunkArray(batch, 8)) {
        finalized.push(...await Promise.all(
          verifyBatch.map((entry) => finalizeUploadIntent({
            intentId: entry.uploadIntentId,
            bucket: 'project-files',
            storageKey: entry.storageKey,
            userId: user.id,
            projectId,
            expectedScope: 'project_file',
            expectedKind: 'file',
          }))));
      }
      for (const result of finalized) {
        if (!result.assetId || result.finalizedSize === null || !result.finalizedMimeType) {
          throw new Error('Folder upload verification did not produce a publishable asset');
        }
        finalizedByStorageKey.set(result.storageKey, {
          assetId: result.assetId,
          contentHash: null,
          finalizedSize: result.finalizedSize,
          finalizedMimeType: result.finalizedMimeType,
        });
      }
    }
    if (finalizedByStorageKey.size !== entries.length) {
      throw new Error('Folder upload verification is incomplete');
    }
    const assetIds = [...new Set([...finalizedByStorageKey.values()].map((asset) => asset.assetId))];
    const verifiedAssets = await db.select({
      id: storageAssets.id,
      contentHash: storageAssets.contentHash,
    }).from(storageAssets).where(and(
      inArray(storageAssets.id, assetIds),
      eq(storageAssets.state, 'verified'),
      eq(storageAssets.ownerUserId, user.id),
      eq(storageAssets.projectId, projectId),
    ));
    const verifiedAssetById = new Map(verifiedAssets.map((asset) => [asset.id, asset]));
    if (verifiedAssetById.size !== assetIds.length) {
      throw new Error('Folder upload contains an unavailable asset');
    }
    for (const asset of finalizedByStorageKey.values()) {
      asset.contentHash = verifiedAssetById.get(asset.assetId)?.contentHash ?? null;
      if (!asset.contentHash) throw new Error('Folder upload content hash is unavailable');
    }
  }

  const manifestHash = (options?.manifestHash || '').trim() || buildUploadManifestHash(entries);
  const sessionId = normalizeSessionId(options?.sessionId);
  const reconcilePolicy: UploadReconcilePolicy =
    options?.reconcilePolicy === 'additive'
      ? 'additive'
      : 'mirror';
  const importEventId = buildProjectImportEventId({
    projectId,
    source: 'upload',
    normalizedTarget: 'upload',
    branchOrManifestHash: manifestHash,
  });

  const currentImportSource = getProjectImportSource(project.importSource);
  const currentMetadata = getImportMetadata(currentImportSource);
  const currentSession = (currentMetadata.uploadSession && typeof currentMetadata.uploadSession === 'object')
    ? currentMetadata.uploadSession as Record<string, unknown>
    : null;
  const currentSessionId = typeof currentSession?.sessionId === 'string' ? currentSession.sessionId : null;
  const currentManifestHash = typeof currentSession?.manifestHash === 'string' ? currentSession.manifestHash : null;
  const currentSessionStatus = typeof currentSession?.status === 'string' ? currentSession.status : null;
  const currentSyncPhase = typeof currentMetadata.syncPhase === 'string' ? currentMetadata.syncPhase : null;

  if (
    currentSessionId === sessionId &&
    currentManifestHash === manifestHash &&
    currentSessionStatus === 'ready' &&
    currentSyncPhase === 'ready' &&
    project.syncStatus === 'ready'
  ) {
    const dedupedRegisteredFiles = Math.max(
      0,
      Number((currentSession?.uploadedFiles as number | undefined) ?? entries.length),
    );
    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId,
      manifestHash,
      reconcilePolicy,
      deduped: 1,
      registeredFiles: dedupedRegisteredFiles,
      durationMs: Date.now() - startedAt,
    });
    return { success: true as const, deduped: true as const, registeredFiles: dedupedRegisteredFiles, deletedFiles: 0 };
  }

  if (entries.length === 0) {
    const deletedCount = await db.transaction(async (tx) => {
      const now = new Date();
      const nowIso = now.toISOString();
      let deletedFiles = 0;

      if (reconcilePolicy === 'mirror') {
        const deletedRows = await tx
          .update(projectNodes)
          .set({
            deletedAt: now,
            deletedBy: user.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(projectNodes.projectId, projectId),
              eq(projectNodes.type, 'file'),
              isNull(projectNodes.deletedAt),
            ),
          )
          .returning({ id: projectNodes.id });
        deletedFiles = deletedRows.length;
      }

      const nextImportSource = buildUploadImportSource(currentImportSource, {
        syncPhase: 'ready',
        importEventId,
        lastError: null,
        uploadSession: {
          sessionId,
          manifestHash,
          totalFiles: 0,
          uploadedFiles: 0,
          startedAt: nowIso,
          lastActivityAt: nowIso,
          status: 'ready',
        } satisfies UploadSessionState,
        reconcile: {
          status: 'completed',
          policy: reconcilePolicy,
          reason: 'empty-manifest',
          deletedFiles,
          completedAt: nowIso,
        },
      });

      await tx.update(projects)
        .set({ syncStatus: 'ready', importSource: nextImportSource as any, updatedAt: now })
        .where(eq(projects.id, projectId));

      return deletedFiles;
    });

    revalidatePath(`/projects/${projectId}`);
    if (project.slug) revalidatePath(`/projects/${project.slug}`);
    revalidatePath('/discover');
    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId,
      manifestHash,
      reconcilePolicy,
      deduped: 0,
      registeredFiles: 0,
      deletedFiles: deletedCount,
      durationMs: Date.now() - startedAt,
    });
    return { success: true as const, registeredFiles: 0, deletedFiles: deletedCount };
  }

  try {
    const lockResult = await withProjectSyncLock(projectId, async (tx) => {
      const nowIso = new Date().toISOString();
        const keepS3Keys = new Set(entries.map((entry) => entry.storageKey));
        const startedSessionAt = typeof currentSession?.startedAt === 'string' ? currentSession.startedAt : nowIso;
        let activeImportSource = buildUploadImportSource(currentImportSource, {
          syncPhase: 'registering',
          importEventId,
          lastError: null,
          uploadSession: {
            sessionId,
            manifestHash,
            totalFiles: entries.length,
            uploadedFiles: entries.length,
            startedAt: startedSessionAt,
            lastActivityAt: nowIso,
            status: 'registering',
          } satisfies UploadSessionState,
          reconcile: {
            status: 'pending',
            policy: reconcilePolicy,
            candidateCount: 0,
            deletedFiles: 0,
          },
        });

        await tx.update(projects)
          .set({
            syncStatus: 'indexing',
            importSource: activeImportSource as any,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId));

        // --- Build folder paths ---
        const dirPaths = new Set<string>();
        for (const f of entries) {
          const parts = f.relativePath.split('/');
          if (parts.length <= 1) continue; // file at root
          const dirParts = parts.slice(0, -1);
          let cur = '';
          for (const part of dirParts) {
            cur = cur ? `${cur}/${part}` : part;
            dirPaths.add(cur);
          }
        }

        const sortedDirs = Array.from(dirPaths).sort(
          (a, b) => a.split('/').length - b.split('/').length
        );

        const folderIdByPath = new Map<string, string>();

        // --- Ensure folders exist (batched per depth) ---
        const dirsByDepth = new Map<number, string[]>();
        for (const dirPath of sortedDirs) {
          const depth = dirPath.split('/').length;
          const list = dirsByDepth.get(depth) || [];
          list.push(dirPath);
          dirsByDepth.set(depth, list);
        }

        const depths = Array.from(dirsByDepth.keys()).sort((a, b) => a - b);

        for (const depth of depths) {
          const paths = dirsByDepth.get(depth) || [];
          if (paths.length === 0) continue;

          const items = paths.map((dirPath) => {
            const parts = splitDirParts(dirPath);
            const name = parts[parts.length - 1]!;
            const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
            const parentId = parentPath ? folderIdByPath.get(parentPath) ?? null : null;
            return { dirPath, parentId, name };
          });

          const existingMap = await fetchExistingNodes(
            tx,
            projectId,
            'folder',
            items.map((i) => ({ parentId: i.parentId, name: i.name }))
          );

          const toInsert: Array<{
            projectId: string;
            parentId: string | null;
            type: 'folder';
            name: string;
            path: string;
            createdBy: string;
            createdAt: Date;
            updatedAt: Date;
          }> = [];
          const pathByKey = new Map<string, string>();

          for (const item of items) {
            const key = makeKey(item.parentId, item.name);
            const existing = existingMap.get(key);
            if (existing) {
              folderIdByPath.set(item.dirPath, existing.id);
            } else {
              pathByKey.set(key, item.dirPath);
              const now = new Date();
              toInsert.push({
                projectId,
                parentId: item.parentId,
                type: 'folder',
                name: item.name,
                path: `/${item.dirPath}`,
                createdBy: user.id,
                createdAt: now,
                updatedAt: now,
              });
            }
          }

          if (toInsert.length > 0) {
            const inserted = await tx.insert(projectNodes).values(toInsert).returning({
              id: projectNodes.id,
              parentId: projectNodes.parentId,
              name: projectNodes.name,
            });

            for (const row of inserted) {
              const key = makeKey(row.parentId ?? null, row.name);
              const path = pathByKey.get(key);
              if (path) folderIdByPath.set(path, row.id);
            }
          }
        }

        // --- Upsert files (batched) ---
        let registeredFiles = 0;
        for (const batch of chunkArray(entries, BATCH_SIZE)) {
          const items = batch.map((f) => {
            const parts = f.relativePath.split('/');
            const name = parts[parts.length - 1]!;
            const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
            const parentId = dir ? folderIdByPath.get(dir) : null;
            if (dir && !parentId) throw new Error(`Folder publication parent is missing for ${f.relativePath}`);
            const asset = finalizedByStorageKey.get(f.storageKey);
            if (!asset) throw new Error(`Verified asset is missing for ${f.relativePath}`);
            return {
              name,
              parentId: parentId ?? null,
              path: `/${f.relativePath}`,
              s3Key: f.storageKey,
              assetId: asset.assetId,
              contentHash: asset.contentHash,
              size: asset.finalizedSize,
              mimeType: asset.finalizedMimeType,
            };
          });

          const existingMap = await fetchExistingNodes(
            tx,
            projectId,
            'file',
            items.map((i) => ({ parentId: i.parentId, name: i.name }))
          );

          const toInsert: Array<{
            projectId: string;
            parentId: string | null;
            type: 'file';
            name: string;
            path: string;
            s3Key: string;
            assetId: string;
            size: number;
            mimeType: string;
            createdBy: string;
            createdAt: Date;
            updatedAt: Date;
          }> = [];
          const toUpdate: Array<{
            id: string;
            s3Key: string;
            assetId: string;
            contentHash: string | null;
            size: number;
            mimeType: string;
            currentVersion: number;
            updatedAt: Date;
          }> = [];

          for (const item of items) {
            const key = makeKey(item.parentId, item.name);
            const existing = existingMap.get(key);
            if (existing) {
              toUpdate.push({
                id: existing.id,
                s3Key: item.s3Key,
                assetId: item.assetId,
                contentHash: item.contentHash,
                size: item.size,
                mimeType: item.mimeType,
                currentVersion: existing.currentVersion + 1,
                updatedAt: new Date(),
              });
            } else {
              const now = new Date();
              toInsert.push({
                projectId,
                parentId: item.parentId,
                type: 'file',
                name: item.name,
                path: item.path,
                s3Key: item.s3Key,
                assetId: item.assetId,
                size: item.size,
                mimeType: item.mimeType,
                createdBy: user.id,
                createdAt: now,
                updatedAt: now,
              });
            }
          }

          const batchAssetIds = [...new Set(items.map((item) => item.assetId))];
          const publishableAssets = await tx.update(storageAssets)
            .set({
              backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
              updatedAt: new Date(),
            })
            .where(and(
              inArray(storageAssets.id, batchAssetIds),
              eq(storageAssets.state, 'verified'),
              eq(storageAssets.ownerUserId, user.id),
              eq(storageAssets.projectId, projectId),
            ))
            .returning({ id: storageAssets.id });
          if (publishableAssets.length !== batchAssetIds.length) {
            throw new Error('One or more folder assets are no longer publishable');
          }

          let inserted: Array<{ id: string; currentVersion: number; s3Key: string | null }> = [];
          if (toInsert.length > 0) {
            inserted = await tx.insert(projectNodes).values(toInsert).returning({
              id: projectNodes.id,
              currentVersion: projectNodes.currentVersion,
              s3Key: projectNodes.s3Key,
            });
          }

          if (toUpdate.length > 0) {
            const values = toUpdate.map((u) =>
              sql`(${u.id}::uuid, ${u.s3Key}::text, ${u.assetId}::uuid, ${u.size}::bigint, ${u.mimeType}::text, ${u.currentVersion}::integer, ${u.updatedAt}::timestamptz)`
            );
            await tx.execute(sql`
              UPDATE ${projectNodes} AS t
              SET s3_key = v.s3_key,
                  asset_id = v.asset_id,
                  size = v.size,
                  mime_type = v.mime_type,
                  current_version = v.current_version,
                  updated_at = v.updated_at
              FROM (VALUES ${sql.join(values, sql`,`)}) AS v(id, s3_key, asset_id, size, mime_type, current_version, updated_at)
              WHERE t.id = v.id AND t.project_id = ${projectId}::uuid
            `);
          }

          const itemByStorageKey = new Map(items.map((item) => [item.s3Key, item]));
          const insertedVersions = inserted.map((node) => {
            const item = node.s3Key ? itemByStorageKey.get(node.s3Key) : null;
            if (!item) throw new Error('Inserted folder file could not be matched to its asset');
            return {
              nodeId: node.id,
              version: node.currentVersion,
              s3Key: item.s3Key,
              assetId: item.assetId,
              size: item.size,
              mimeType: item.mimeType,
              contentHash: item.contentHash,
              uploadedBy: user.id,
              attribution: { source: 'folder_upload', sessionId },
            };
          });
          const updatedVersions = toUpdate.map((item) => ({
            nodeId: item.id,
            version: item.currentVersion,
            s3Key: item.s3Key,
            assetId: item.assetId,
            size: item.size,
            mimeType: item.mimeType,
            contentHash: item.contentHash,
            uploadedBy: user.id,
            attribution: { source: 'folder_upload', sessionId },
          }));
          if (insertedVersions.length + updatedVersions.length > 0) {
            await tx.insert(fileVersions).values([...insertedVersions, ...updatedVersions]);
          }

          registeredFiles += items.length;
        }

        let deletedFiles = 0;
        let reconcileCandidateCount = 0;
        let reconcileValidatedCount = 0;
        if (reconcilePolicy === 'mirror') {
          const activeFileNodes = await tx
            .select({ id: projectNodes.id, s3Key: projectNodes.s3Key })
            .from(projectNodes)
            .where(
              and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.type, 'file'),
                isNull(projectNodes.deletedAt),
              ),
            );

          const candidates = activeFileNodes.filter((node) => {
            if (!node.s3Key) return false;
            return !keepS3Keys.has(node.s3Key);
          });

          const candidateIds = candidates.map((node) => node.id);
          reconcileCandidateCount = candidateIds.length;
          reconcileValidatedCount = candidateIds.length;

          if (candidateIds.length > 0) {
            const now = new Date();
            for (const batchIds of chunkArray(candidateIds, BATCH_SIZE)) {
              if (batchIds.length === 0) continue;
              await tx
                .update(projectNodes)
                .set({
                  deletedAt: now,
                  deletedBy: user.id,
                  updatedAt: now,
                })
                .where(inArray(projectNodes.id, batchIds));
              deletedFiles += batchIds.length;
            }
          }
        }

        const completedAt = new Date().toISOString();
        activeImportSource = buildUploadImportSource(activeImportSource, {
          syncPhase: 'ready',
          importEventId,
          lastError: null,
          uploadSession: {
            sessionId,
            manifestHash,
            totalFiles: entries.length,
            uploadedFiles: entries.length,
            startedAt: startedSessionAt,
            lastActivityAt: completedAt,
            status: 'ready',
          } satisfies UploadSessionState,
          reconcile: {
            status: 'committed',
            policy: reconcilePolicy,
            candidateCount: reconcileCandidateCount,
            validatedCount: reconcileValidatedCount,
            deletedFiles,
            completedAt,
          },
        });

        await tx.update(projects)
          .set({
            syncStatus: 'ready',
            importSource: activeImportSource as any,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId));

        return {
          registeredFiles,
          deletedFiles,
          importEventId,
          manifestHash,
          sessionId,
          reconcilePolicy,
        };
      });

    if (lockResult.skipped) {
      let lockOwnerSessionId: string | null = currentSessionId;
      let lockOwnerManifestHash: string | null = currentManifestHash;
      try {
        const [latestProject] = await db
          .select({ importSource: projects.importSource })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        const latestImportSource = getProjectImportSource(latestProject?.importSource);
        const latestMetadata = getImportMetadata(latestImportSource);
        const latestSession = (latestMetadata.uploadSession && typeof latestMetadata.uploadSession === 'object')
          ? latestMetadata.uploadSession as Record<string, unknown>
          : null;
        lockOwnerSessionId = typeof latestSession?.sessionId === 'string' ? latestSession.sessionId : lockOwnerSessionId;
        lockOwnerManifestHash = typeof latestSession?.manifestHash === 'string' ? latestSession.manifestHash : lockOwnerManifestHash;
      } catch {
        // Best-effort lock owner context only; skip branch still returns deterministic collision payload.
      }

      logger.metric('upload.register.result', {
        projectId,
        userId: user.id,
        sessionId,
        manifestHash,
        reconcilePolicy,
        deduped: 1,
        skipped: 'in_progress',
        lockOwnerSessionId,
        lockOwnerManifestHash,
        durationMs: Date.now() - startedAt,
      });
      return {
        success: false as const,
        deduped: true as const,
        skipped: true as const,
        registeredFiles: 0,
        deletedFiles: 0,
        lockOwnerSessionId,
        lockOwnerManifestHash,
      };
    }

    // Refresh the project page (slug or id)
    revalidatePath(`/projects/${projectId}`);
    if (project.slug) revalidatePath(`/projects/${project.slug}`);
    revalidatePath('/discover');

    const value = lockResult.value || {
      registeredFiles: 0,
      deletedFiles: 0,
      importEventId,
      manifestHash,
      sessionId,
      reconcilePolicy,
    };
    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId: value.sessionId,
      manifestHash: value.manifestHash,
      importEventId: value.importEventId,
      reconcilePolicy: value.reconcilePolicy,
      deduped: 0,
      registeredFiles: value.registeredFiles,
      deletedFiles: value.deletedFiles,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true as const,
      deduped: false as const,
      registeredFiles: value.registeredFiles,
      deletedFiles: value.deletedFiles,
      importEventId: value.importEventId,
      manifestHash: value.manifestHash,
      sessionId: value.sessionId,
      reconcilePolicy: value.reconcilePolicy,
    };
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'Upload registration failed';
    const nowIso = new Date().toISOString();
    const failedSource = buildUploadImportSource(currentImportSource, {
      syncPhase: 'failed',
      importEventId,
      lastError: message,
      uploadSession: {
        sessionId,
        manifestHash,
        totalFiles: entries.length,
        uploadedFiles: Math.max(0, Math.min(entries.length, Number(currentSession?.uploadedFiles || 0))),
        startedAt: typeof currentSession?.startedAt === 'string' ? currentSession.startedAt : nowIso,
        lastActivityAt: nowIso,
        status: 'failed',
      } satisfies UploadSessionState,
    });

    await db.update(projects)
      .set({
        syncStatus: 'failed',
        importSource: failedSource as any,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    logger.metric('upload.register.result', {
      projectId,
      userId: user.id,
      sessionId,
      manifestHash,
      reconcilePolicy,
      result: 'failed',
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export async function markProjectSyncFailedAction(
  projectId: string,
  options?: {
    sessionId?: string | null;
    manifestHash?: string | null;
    reason?: string | null;
  },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to continue');

  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId, slug: projects.slug, importSource: projects.importSource })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error('Workspace not found');
  if (project.ownerId !== user.id) throw new Error('Sign in to continue');

  const currentImportSource = getProjectImportSource(project.importSource);
  const currentMetadata = getImportMetadata(currentImportSource);
  const currentSession = (currentMetadata.uploadSession && typeof currentMetadata.uploadSession === 'object')
    ? currentMetadata.uploadSession as Record<string, unknown>
    : null;
  const nowIso = new Date().toISOString();
  const sessionId = normalizeSessionId(options?.sessionId || currentSession?.sessionId);
  const manifestHash =
    (typeof options?.manifestHash === 'string' && options.manifestHash.trim().length > 0)
      ? options.manifestHash.trim()
      : (typeof currentSession?.manifestHash === 'string' && currentSession.manifestHash.trim().length > 0)
        ? currentSession.manifestHash
        : 'unknown';
  const reason = (typeof options?.reason === 'string' && options.reason.trim().length > 0)
    ? options.reason.trim()
    : 'Upload import failed';
  const failedSource = buildUploadImportSource(currentImportSource, {
    syncPhase: 'failed',
    lastError: reason,
    importEventId: currentMetadata.importEventId ?? null,
    uploadSession: {
      sessionId,
      manifestHash,
      totalFiles: Math.max(0, Number(currentSession?.totalFiles || 0)),
      uploadedFiles: Math.max(0, Number(currentSession?.uploadedFiles || 0)),
      startedAt: typeof currentSession?.startedAt === 'string' ? currentSession.startedAt : nowIso,
      lastActivityAt: nowIso,
      status: 'failed',
    } satisfies UploadSessionState,
  });

  await db.update(projects)
    .set({ syncStatus: 'failed', importSource: failedSource as any, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  // Schedule cleanup of dangling unreferenced assets created for this project
  try {
    const danglingAssets = await db
      .select({ id: storageAssets.id })
      .from(storageAssets)
      .where(
        and(
          eq(storageAssets.projectId, projectId),
          eq(storageAssets.ownerUserId, user.id),
          eq(storageAssets.state, 'pending'),
        ),
      );
    if (danglingAssets.length > 0) {
      await db.delete(storageAssets).where(
        and(
          inArray(storageAssets.id, danglingAssets.map((a) => a.id)),
          eq(storageAssets.state, 'pending'),
        ),
      ).catch(() => undefined);
    }
  } catch {
    // Non-blocking cleanup
  }

  revalidatePath(`/projects/${projectId}`);
  if (project.slug) revalidatePath(`/projects/${project.slug}`);
  revalidatePath('/discover');

  logger.metric('upload.register.result', {
    projectId,
    userId: user.id,
    sessionId,
    manifestHash,
    result: 'failed',
    reason,
  });

  return { success: true };
}
