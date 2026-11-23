import "server-only";

import { saveContext } from "@/lib/domain/save-context";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { fileVersions, workspaceNodes, type FileVersion } from "@/lib/db/schema";
import { assertOwnedFileLease, type FileLeaseCredentials } from "@/lib/files/file-lock-service";
import { assertWorkspaceWriteAccessTx, recordNodeEvent } from "@/lib/files/internal-helpers";
import { assertMinutesEditable } from "@/lib/workspaces/minutes-lock";

/** The active version moved after the caller read it (Undo checks this). */
export class ActiveVersionChangedError extends Error {}

/**
 * Makes an existing version the active one (2026-11-11): the node points at that version's content and nothing is
 * copied or deleted. Versions only ever grow; saving after going back makes the next number, "based on" this one.
 * Restore in the version panel, Undo of a drop and Undo of a push all end here.
 */
export async function activateFileVersion(input: {
  projectId: string;
  nodeId: string;
  actorUserId: string;
  version: number;
  lease: FileLeaseCredentials;
  /** Only move when the active version is still this one (Undo: nobody saved since). */
  expectActive?: number;
  eventMetadata?: Record<string, unknown>;
}): Promise<{ node: typeof workspaceNodes.$inferSelect; version: FileVersion; previousVersion: number }> {
  return db.transaction(async (tx) => {
    await assertWorkspaceWriteAccessTx(tx, input.projectId, input.actorUserId, { nodeId: input.nodeId });
    await tx.execute(sql`SELECT id FROM workspace_nodes WHERE id = ${input.nodeId} AND workspace_id = ${input.projectId} FOR UPDATE`);
    const node = await tx.query.workspaceNodes.findFirst({
      where: and(eq(workspaceNodes.id, input.nodeId), eq(workspaceNodes.projectId, input.projectId)),
    });
    if (!node || node.deletedAt) throw new Error("File not found");
    if (node.type !== "file") throw new Error("Only file nodes support versions");
    await assertMinutesEditable(input.projectId, input.nodeId, tx);
    await saveContext(tx, { kind: "restore", message: `Use v${input.version} of ${node.name}`, authorId: input.actorUserId });
    await assertOwnedFileLease(tx, { projectId: input.projectId, nodeId: input.nodeId, userId: input.actorUserId, credentials: input.lease });
    if (input.expectActive != null && node.currentVersion !== input.expectActive) {
      throw new ActiveVersionChangedError("Someone saved a newer version since");
    }
    const target = await tx.query.fileVersions.findFirst({
      where: and(eq(fileVersions.nodeId, input.nodeId), eq(fileVersions.version, input.version)),
    });
    if (!target) throw new Error("Version not found");
    const previousVersion = node.currentVersion;
    if (previousVersion === input.version) return { node, version: target, previousVersion };

    const [updated] = await tx
      .update(workspaceNodes)
      .set({ s3Key: target.s3Key, assetId: target.assetId, size: target.size, mimeType: target.mimeType, currentVersion: input.version, updatedAt: new Date() })
      .where(eq(workspaceNodes.id, input.nodeId))
      .returning();
    await recordNodeEvent(input.projectId, input.actorUserId, input.nodeId, "version_activated", {
      from: previousVersion, to: input.version, version: input.version, size: target.size, mimeType: target.mimeType, hash: target.contentHash,
      ...input.eventMetadata, nodeId: input.nodeId, path: node.path, taskId: node.taskId,
    }, tx);
    return { node: updated!, version: target, previousVersion };
  });
}
