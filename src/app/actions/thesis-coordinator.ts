"use server";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.6 W5 (plan B1.8c): the coordinator's table on a class's Workspaces tab — each thesis workspace's student,
 * title, supervisor, next milestone, words and last supervision. Class staff only; numbers, never thesis text (call).
 */
export async function readThesisCoordinatorAction(orgId: string) {
  try {
    const { userId } = await getViewerAuthContext();
    if (!userId || !isLooseUuid(orgId)) return { success: false as const, error: "You can’t do that here." };
    const a = await getWorkspaceAccessById(orgId, userId);
    if (a.project?.kind !== "organization" || !a.canRead || !(a.isOwner || a.memberRole === "admin")) return { success: false as const, error: "You can’t do that here." };
    const { thesisRows, NO_SUPERVISION_DAYS } = await import("@/lib/workflows/thesis-server");
    const { readWorkspaceFileText } = await import("@/lib/files/content-reader");
    const readText = async (workspaceId: string, nodeId: string) => {
      const w = await getWorkspaceAccessById(workspaceId, userId);
      return w.project && w.canRead ? readWorkspaceFileText({ ...w, project: w.project }, workspaceId, nodeId) : "";
    };
    return { success: true as const, rows: await thesisRows(orgId, readText), flagDays: NO_SUPERVISION_DAYS };
  } catch (error) {
    logger.warn("thesis.coordinator_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the theses." };
  }
}
