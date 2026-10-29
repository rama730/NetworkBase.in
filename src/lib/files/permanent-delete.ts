import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import {
  fileVersions,
  projectDocs,
  projectNodes,
  projects,
  storageAssets,
  taskNodeLinks,
} from "@/lib/db/schema";
import { parseProjectFileKey } from "@/lib/storage/workspace-file-key";
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
      SELECT id FROM project_nodes WHERE project_id = ${projectId}::uuid AND id = ${nodeId}::uuid
      UNION
      SELECT child.id FROM project_nodes child JOIN subtree parent ON child.parent_id = parent.id
      WHERE child.project_id = ${projectId}::uuid
    ) SELECT id FROM subtree LIMIT ${MAX_PURGE_NODES + 1}
  `),
  );
  if (ids.length > MAX_PURGE_NODES)
    throw new Error(
      "This folder contains more than 500 items. Delete smaller groups from Trash first.",
    );
  return ids.length
    ? tx.query.projectNodes.findMany({
        where: and(
          eq(projectNodes.projectId, projectId),
          inArray(
            projectNodes.id,
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
  const aliases = await tx.query.projectNodes.findFirst({
    where: and(
      inArray(projectNodes.canonicalNodeId, ids),
      notInArray(projectNodes.id, ids),
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
  if (keys.some((key) => parseProjectFileKey(key)?.projectId !== projectId))
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
      .from(projectDocs)
      .where(inArray(projectDocs.linkedNodeId, ids)),
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
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    const root = await tx.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.id, nodeId),
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
      .delete(projectNodes)
      .where(
        and(
          eq(projectNodes.projectId, projectId),
          inArray(projectNodes.id, plan.ids),
        ),
      );
    if (plan.assetIds.length > 0) {
      await scheduleAssetDeletionIfUnreferenced(tx, plan.assetIds, { lastErrorCode: "PERMANENT_DELETE_DETACHED" });
    }
    return { deletedIds: plan.ids };
  });
}
