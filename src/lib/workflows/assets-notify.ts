import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { taskNodeLinks, tasks, workspaceNodes } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { isAssetMime, newVersionRecipients } from "@/lib/workflows/assets";

/**
 * Report 38.16 W5 (A7.3, call 4): a new version of an asset tells the people assigned to open items that use it
 * ("New version of Logo-dark.svg", Normal). Called after a version is saved; never fails the save.
 */
export async function notifyAssetNewVersion(projectId: string, nodeId: string, version: number, actorId: string | null) {
  try {
    if (version < 2) return;
    const [node] = await db.select({ name: workspaceNodes.name, mimeType: workspaceNodes.mimeType, metadata: workspaceNodes.metadata, taskId: workspaceNodes.taskId }).from(workspaceNodes)
      .where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId), isNull(workspaceNodes.deletedAt))).limit(1);
    if (!node || node.taskId || !(isAssetMime(node.mimeType, node.name) || (node.metadata as { asset?: unknown } | null)?.asset)) return;
    const items = await db.select({ assigneeId: tasks.assigneeId, status: tasks.status }).from(taskNodeLinks).innerJoin(tasks, eq(tasks.id, taskNodeLinks.taskId))
      .where(and(eq(taskNodeLinks.nodeId, nodeId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
    const to = newVersionRecipients(items.map((i) => ({ assigneeId: i.assigneeId, done: i.status === "done" })), actorId ?? "");
    if (!to.length) return;
    const { createNotification } = await import("@/lib/notifications/service");
    for (const recipient of to) {
      await createNotification({ recipientUserId: recipient, actorUserId: actorId, kind: "project_file_activity", category: "projects", importance: "more",
        title: `New version of ${node.name}`, href: `/workspaces/${encodeURIComponent(projectId)}?tab=files&fileId=${encodeURIComponent(nodeId)}`,
        entityRefs: { projectId, fileId: nodeId }, dedupeKey: `asset-version:${nodeId}:${version}:${recipient}` }).catch(() => undefined);
    }
  } catch (error) {
    logger.warn("assets.version_notice_failed", { projectId, nodeId, error: error instanceof Error ? error.message : String(error) });
  }
}
