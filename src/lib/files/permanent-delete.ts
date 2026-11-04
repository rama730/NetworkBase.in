import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import {
  fileVersions,
  workspaceDocuments,
  workspaceNodes,
  workspaces,
  storageAssets,
  taskNodeLinks,
} from "@/lib/db/schema";
import { parseWorkspaceFileKey } from "@/lib/storage/workspace-file-key";
import { logger } from "@/lib/logger";
import { TRASH_RETENTION_DAYS } from "@/lib/files/runtime-budgets";
import { recordNodeEvent } from "./internal-helpers";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const MAX_PURGE_NODES = 500;
const MAX_PURGE_KEYS = 2000;

/** Traverse actual parent relationships, never similarly named paths. */
export async function readFileSubtree(
  tx: Transaction,
  projectId: string,
  nodeId: string,
) {
  const ids = Array.from(
    await tx.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM workspace_nodes WHERE workspace_id = ${projectId}::uuid AND id = ${nodeId}::uuid
      UNION
      SELECT child.id FROM workspace_nodes child JOIN subtree parent ON child.parent_id = parent.id
      WHERE child.workspace_id = ${projectId}::uuid
    ) SELECT id FROM subtree LIMIT ${MAX_PURGE_NODES + 1}
  `),
  );
  if (ids.length > MAX_PURGE_NODES)
    throw new Error(
      "This folder contains more than 500 items. Delete smaller groups from Trash first.",
    );
  return ids.length
    ? tx.query.workspaceNodes.findMany({
        where: and(
          eq(workspaceNodes.projectId, projectId),
          inArray(
            workspaceNodes.id,
            ids.map((row) => row.id),
          ),
        ),
      })
    : [];
}

/** Called under the project's write lock both before consent and before cleanup. */
export async function inspectPermanentDelete(
  tx: Transaction,
  projectId: string,
  nodeId: string,
) {
  const nodes = await readFileSubtree(tx, projectId, nodeId);
  if (!nodes.length) return null;
  if (nodes.some((node) => !node.deletedAt))
    throw new Error("Only items already in Trash can be permanently deleted.");
  if (nodes.some((node) => node.metadata?.isSystem === true))
    throw new Error("System folders cannot be permanently deleted.");
  const ids = nodes.map((node) => node.id);
  const aliases = await tx.query.workspaceNodes.findFirst({
    where: and(
      inArray(workspaceNodes.canonicalNodeId, ids),
      notInArray(workspaceNodes.id, ids),
    ),
    columns: { id: true },
  });
  if (aliases)
    throw new Error(
      "Another file still depends on this original. Remove its dependent copies before permanently deleting it.",
    );
  const versions = await tx.query.fileVersions.findMany({
    where: inArray(fileVersions.nodeId, ids),
    columns: { s3Key: true, assetId: true },
    limit: MAX_PURGE_KEYS + 1,
  });
  if (versions.length > MAX_PURGE_KEYS)
    throw new Error("Too many file versions to delete in one operation.");
  const keys = [
    ...new Set(
      [
        ...nodes.map((node) => node.s3Key),
        ...versions.map((version) => version.s3Key),
      ].filter((key): key is string => !!key),
    ),
  ];
  if (keys.length > MAX_PURGE_KEYS)
    throw new Error("Too many stored objects to delete in one operation.");
  if (keys.some((key) => parseWorkspaceFileKey(key)?.projectId !== projectId))
    throw new Error(
      "A storage key could not be safely verified. No files were deleted.",
    );
  if (
    nodes.some((node) => Boolean(node.s3Key) && !node.assetId)
    || versions.some((version) => Boolean(version.s3Key) && !version.assetId)
  ) {
    throw new Error(
      "Storage registration is still pending for part of this deletion.",
    );
  }
  const assetIds = Array.from(new Set([
    ...nodes.flatMap((node) => node.assetId ? [node.assetId] : []),
    ...versions.flatMap((version) => version.assetId ? [version.assetId] : []),
  ]));
  const [links, docs] = await Promise.all([
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(taskNodeLinks)
      .where(inArray(taskNodeLinks.nodeId, ids)),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceDocuments)
      .where(inArray(workspaceDocuments.linkedNodeId, ids)),
  ]);
  return {
    nodes,
    ids,
    keys,
    assetIds,
    versions: versions.length,
    taskLinks: links[0]?.count ?? 0,
    documentLinks: docs[0]?.count ?? 0,
  };
}

/**
 * A committed tombstone is the durable work item. Domain references are
 * detached atomically and eligible assets are scheduled for the fenced
 * storage worker. No provider I/O runs while database locks are held.
 */
export async function finishPermanentDelete(projectId: string, nodeId: string) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, projectId))
      .for("update");
    const root = await tx.query.workspaceNodes.findFirst({
      where: and(
        eq(workspaceNodes.projectId, projectId),
        eq(workspaceNodes.id, nodeId),
      ),
    });
    if (!root) return { deletedIds: [] as string[] };
    if (root.metadata?.permanentDeleteRoot !== nodeId)
      throw new Error("Permanent deletion was not authorized.");
    const plan = await inspectPermanentDelete(tx, projectId, nodeId);
    if (!plan) return { deletedIds: [] as string[] };
    if (
      plan.nodes.some((node) => node.metadata?.permanentDeleteRoot !== nodeId)
    )
      throw new Error("What would be deleted has changed. Ask the workspace owner.");
    // nodeId must be null: the audit record must survive its target's removal.
    await recordNodeEvent(
      projectId,
      typeof root.metadata.permanentDeleteActor === "string"
        ? root.metadata.permanentDeleteActor
        : null,
      null,
      "permanent_delete",
      {
        rootId: nodeId,
        deletedIds: plan.ids,
        actorId: root.metadata.permanentDeleteActor,
        versions: plan.versions,
        scheduledAssets: plan.assetIds.length,
      },
      tx,
    );
    await tx
      .delete(workspaceNodes)
      .where(
        and(
          eq(workspaceNodes.projectId, projectId),
          inArray(workspaceNodes.id, plan.ids),
        ),
      );
    if (plan.assetIds.length > 0) {
      await scheduleAssetDeletionIfUnreferenced(tx, plan.assetIds, { lastErrorCode: "PERMANENT_DELETE_DETACHED" });
    }
    return { deletedIds: plan.ids };
  });
}


/**
 * Trash empties itself TRASH_RETENTION_DAYS after an item was trashed. This marks the
 * biggest expired subtrees that fit one permanent delete (MAX_PURGE_NODES) with the same
 * tombstone a manual "Delete permanently" leaves; finishPendingFileDeletions removes them.
 * A folder too big for one delete goes in pieces: its children first, itself on a later run.
 * Returns how many subtrees were marked.
 */
export async function markExpiredTrash(limit = 20) {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000);
  const roots = Array.from(await db.execute<{ id: string; workspace_id: string }>(sql`
    WITH RECURSIVE expired AS (
      SELECT id, parent_id, workspace_id FROM workspace_nodes
      WHERE deleted_at < now() - make_interval(days => ${TRASH_RETENTION_DAYS}) AND NOT coalesce(metadata ? 'permanentDeleteRoot', false)
    ), chain AS (
      -- every expired node paired with itself and each expired ancestor
      SELECT id, id AS ancestor FROM expired
      UNION ALL
      SELECT chain.id, up.parent_id FROM chain
        JOIN expired up ON up.id = chain.ancestor
        JOIN expired p ON p.id = up.parent_id
    ), fits AS (
      SELECT e.* FROM expired e
      JOIN (SELECT ancestor, count(*) AS n FROM chain GROUP BY ancestor) s ON s.ancestor = e.id
      WHERE s.n <= ${MAX_PURGE_NODES}
    )
    SELECT f.id, f.workspace_id FROM fits f
    WHERE NOT EXISTS (SELECT 1 FROM fits p WHERE p.id = f.parent_id)
    LIMIT ${limit}
  `));

  let marked = 0;
  for (const root of roots) {
    try {
      const done = await db.transaction(async (tx) => {
        // Same lock finishPermanentDelete takes, so a restore cannot interleave.
        await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, root.workspace_id)).for("update");
        const plan = await inspectPermanentDelete(tx, root.workspace_id, root.id);
        if (!plan) return false;
        // Restored and trashed again since the read, or a deletion already pending inside: next run.
        if (plan.nodes.some((n) => !n.deletedAt || n.deletedAt >= cutoff || n.metadata?.permanentDeleteRoot)) return false;
        await tx
          .update(workspaceNodes)
          .set({
            metadata: sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) || ${JSON.stringify({ permanentDeleteRoot: root.id, permanentDeleteActor: null, permanentDeleteRequestedAt: new Date().toISOString(), permanentDeleteReason: "trash_retention" })}::jsonb`,
          })
          .where(and(eq(workspaceNodes.projectId, root.workspace_id), inArray(workspaceNodes.id, plan.ids)));
        await recordNodeEvent(root.workspace_id, null, root.id, "permanent_delete_requested", { items: plan.ids.length, reason: "trash_retention" }, tx);
        return true;
      });
      if (done) marked++;
    } catch (error) {
      // One blocked subtree (dependent copy, pending upload) must not stop the rest.
      logger.warn("Expired Trash item skipped", {
        projectId: root.workspace_id,
        nodeId: root.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return marked;
}
