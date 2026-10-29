import "server-only";

import { and, eq, max, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import { fileVersions, workspaceNodes, workspaceNodeEvents, storageAssets, type FileVersion } from "@/lib/db/schema";
import {
  assertWorkspaceUploadAccessTx,
  assertWorkspaceWriteAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import { assertOwnedFileLease, type FileLeaseCredentials } from "@/lib/files/file-lock-service";
import {
  normalizeRevisionComment,
  nextFileRevisionNumber,
  type FileRevisionMode,
} from "@/lib/files/revision-policy";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ApplyFileRevisionInput {
  projectId: string;
  nodeId: string;
  actorUserId: string;
  /** GitHub imports preserve content authorship separately from the authorized importer. */
  contentAuthorId?: string | null;
  attribution?: Record<string, unknown>;
  storageKey: string;
  /** Verified asset behind storageKey; null only for legacy/unregistered bytes. Required so no writer drops it (COR-004). */
  assetId: string | null;
  size: number;
  mimeType: string;
  contentHash: string | null;
  mode: FileRevisionMode;
  comment?: string | null;
  baseVersion?: number | null;
  baseHash?: string | null;
  baseStorageKey?: string;
  basePath?: string;
  lease: FileLeaseCredentials;
  eventType?: string;
  eventMetadata?: Record<string, unknown>;
  syncStatus?: string;
  accessRequirement?: "upload" | "write";
  afterMutationTx?: (tx: DbTransaction) => Promise<void>;
}

export interface ApplyFileRevisionResult {
  node: typeof workspaceNodes.$inferSelect;
  version: FileVersion;
  mode: FileRevisionMode;
  versionIncremented: boolean;
  replacedStorageKey: string | null;
  sequenceNumber: number;
}

/**
 * Canonical file-revision mutation used by the browser and extension APIs.
 *
 * The project and node rows are locked in the same transaction as the version
 * write. New revisions append a row and increment currentVersion; active
 * revisions update the current row while preserving its version number.
 */
export async function applyFileRevision(
  input: ApplyFileRevisionInput,
): Promise<ApplyFileRevisionResult> {
  const result = await db.transaction(async (tx) => {
    if (input.accessRequirement === "write") {
      await assertWorkspaceWriteAccessTx(tx, input.projectId, input.actorUserId, { nodeId: input.nodeId });
    } else {
      await assertWorkspaceUploadAccessTx(tx, input.projectId, input.actorUserId, { nodeId: input.nodeId });
    }
    await tx.execute(sql`
      SELECT id
      FROM workspace_nodes
      WHERE id = ${input.nodeId}
        AND workspace_id = ${input.projectId}
      FOR UPDATE
    `);


    const current = await tx.query.workspaceNodes.findFirst({
      where: and(
        eq(workspaceNodes.id, input.nodeId),
        eq(workspaceNodes.projectId, input.projectId),
      ),
    });
    if (!current || current.deletedAt) throw new Error("File not found");
    if (current.type !== "file") throw new Error("Only file nodes support versions");
    const operationId = typeof input.eventMetadata?.operationId === "string" ? input.eventMetadata.operationId : null;
    if(operationId) {
      const committed = await tx.query.workspaceNodeEvents.findFirst({where:and(eq(workspaceNodeEvents.projectId,input.projectId),eq(workspaceNodeEvents.actorId,input.actorUserId),sql`${workspaceNodeEvents.metadata}->>'operationId' = ${operationId}`)});
      if(committed) {
        const metadata=committed.metadata || {};
        if((metadata.nodeId||committed.nodeId)!==input.nodeId)throw new Error("The operation was already committed to a different or removed file. Do not recreate it.");
        if(metadata.hash!==input.contentHash) throw new Error("Operation ID was already used for different contents");
        const version=await tx.query.fileVersions.findFirst({where:and(eq(fileVersions.nodeId,input.nodeId),eq(fileVersions.version,Number(metadata.version)))});
        if(!version) throw new Error("The committed operation’s version is no longer available. Do not publish it again.");
        return {node:{...current,size:Number(metadata.size),currentVersion:Number(metadata.version),updatedAt:committed.createdAt},version:{...version,contentHash:String(metadata.hash),size:Number(metadata.size)},mode:metadata.revisionMode as FileRevisionMode,versionIncremented:Boolean(metadata.versionIncremented),replacedStorageKey:null,sequenceNumber:committed.sequenceNumber};
      }
    }
    await assertOwnedFileLease(tx, {
      projectId: input.projectId,
      nodeId: input.nodeId,
      userId: input.actorUserId,
      credentials: input.lease,
    });
    // The asset must be this project's verified object for exactly this key;
    // its server-computed digest is authoritative (COR-004).
    let contentHash = input.contentHash;
    if (input.assetId) {
      const [publishableAsset] = await tx.update(storageAssets)
        .set({
          backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageAssets.id, input.assetId),
          eq(storageAssets.state, "verified"),
          eq(storageAssets.projectId, input.projectId),
          eq(storageAssets.storageKey, input.storageKey),
        ))
        .returning({ id: storageAssets.id, contentHash: storageAssets.contentHash });
      if (!publishableAsset) throw new Error("File asset is no longer publishable");
      if (publishableAsset.contentHash) {
        if (input.contentHash && input.contentHash !== publishableAsset.contentHash) {
          throw new Error("File content does not match the verified upload");
        }
        contentHash = publishableAsset.contentHash;
      }
    }
    if ((input.baseStorageKey !== undefined && current.s3Key !== input.baseStorageKey) ||
        (input.basePath !== undefined && current.path !== input.basePath)) {
      throw new Error("File changed after review. Compare again.");
    }

    const currentVersionNumber = current.currentVersion ?? 1;
    if (input.baseVersion != null && input.baseVersion !== currentVersionNumber) {
      throw new Error("File changed on the server. Refresh before saving again.");
    }

    const currentVersion = await tx.query.fileVersions.findFirst({
      where: and(
        eq(fileVersions.nodeId, input.nodeId),
        eq(fileVersions.version, currentVersionNumber),
      ),
    });
    if (
      input.baseHash &&
      currentVersion?.contentHash &&
      input.baseHash !== currentVersion.contentHash
    ) {
      throw new Error("File content changed on the server. Refresh before saving again.");
    }

    const comment = normalizeRevisionComment(input.comment);
    const now = new Date();
    const [history] = await tx
      .select({ highestVersion: max(fileVersions.version) })
      .from(fileVersions)
      .where(eq(fileVersions.nodeId, input.nodeId));
    const versionNumber =
      input.mode === "new_revision"
        ? nextFileRevisionNumber(currentVersionNumber, history?.highestVersion)
        : currentVersionNumber;

    let version: FileVersion;
    if (input.mode === "new_revision") {
      const [inserted] = await tx
        .insert(fileVersions)
        .values({
          nodeId: input.nodeId,
          version: versionNumber,
          s3Key: input.storageKey,
          assetId: input.assetId ?? null,
          size: input.size,
          mimeType: input.mimeType,
          contentHash,
          uploadedBy: input.contentAuthorId === undefined ? input.actorUserId : input.contentAuthorId,
          attribution: input.attribution ?? {},
          comment,
          uploadedAt: now,
        })
        .returning();
      if (!inserted) throw new Error("Couldn’t create file version");
      version = inserted;
    } else if (currentVersion) {
      const [updated] = await tx
        .update(fileVersions)
        .set({
          s3Key: input.storageKey,
          assetId: input.assetId ?? null,
          size: input.size,
          mimeType: input.mimeType,
          contentHash,
          uploadedBy: input.contentAuthorId === undefined ? input.actorUserId : input.contentAuthorId,
          attribution: input.attribution ?? {},
          uploadedAt: now,
          ...(comment !== null ? { comment } : {}),
        })
        .where(eq(fileVersions.id, currentVersion.id))
        .returning();
      if (!updated) throw new Error("Couldn’t update active version");
      version = updated;
    } else {
      const [inserted] = await tx
        .insert(fileVersions)
        .values({
          nodeId: input.nodeId,
          version: currentVersionNumber,
          s3Key: input.storageKey,
          assetId: input.assetId ?? null,
          size: input.size,
          mimeType: input.mimeType,
          contentHash,
          uploadedBy: input.contentAuthorId === undefined ? input.actorUserId : input.contentAuthorId,
          attribution: input.attribution ?? {},
          comment,
          uploadedAt: now,
        })
        .returning();
      if (!inserted) throw new Error("Couldn’t initialize active version");
      version = inserted;
    }

    const [updatedNode] = await tx
      .update(workspaceNodes)
      .set({
        s3Key: input.storageKey,
        assetId: input.assetId ?? null,
        size: input.size,
        mimeType: input.mimeType,
        currentVersion: versionNumber,
        ...(input.syncStatus ? { syncStatus: input.syncStatus } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(workspaceNodes.id, input.nodeId),
          eq(workspaceNodes.projectId, input.projectId),
        ),
      )
      .returning();
    if (!updatedNode) throw new Error("Couldn’t update file node");

    if (
      input.mode === "active_revision" &&
      current.assetId &&
      current.assetId !== input.assetId
    ) {
      await scheduleAssetDeletionIfUnreferenced(tx, [current.assetId]);
    }

    await input.afterMutationTx?.(tx);

    const event = await recordNodeEvent(
      input.projectId,
      input.actorUserId,
      input.nodeId,
      input.eventType ?? "file_revision_applied",
      {
        revisionMode: input.mode,
        version: versionNumber,
        versionIncremented: input.mode === "new_revision",
        size: input.size,
        mimeType: input.mimeType,
        hash: input.contentHash,
        leaseId: input.lease.leaseId,
        fencingToken: input.lease.fencingToken,
        comment,
        ...input.eventMetadata,
        nodeId:input.nodeId,path:current.path,taskId:current.taskId,
      },
      tx,
    );

    return {
      node: updatedNode,
      version,
      mode: input.mode,
      versionIncremented: input.mode === "new_revision",
      replacedStorageKey:
        input.mode === "active_revision" && current.s3Key !== input.storageKey
          ? current.s3Key
          : null,
      sequenceNumber: event.sequenceNumber,
    };
  });

  return result;
}
