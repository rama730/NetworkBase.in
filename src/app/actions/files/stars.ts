"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { nodeStars, workspaceNodes } from "@/lib/db/schema";
import { setNodeStar } from "@/lib/domain/task-meta";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "./_constants";

async function viewerId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to continue");
  return user.id;
}

/** Your starred files in a workspace (report C3): the Files tab and `nb file list --starred` share them (0087). */
export async function listMyNodeStarsAction(projectId: string): Promise<string[]> {
  if (!UUID_RE.test(projectId)) return [];
  const userId = await viewerId();
  const rows = await db.select({ nodeId: nodeStars.nodeId }).from(nodeStars)
    .innerJoin(workspaceNodes, eq(workspaceNodes.id, nodeStars.nodeId))
    .where(and(eq(nodeStars.userId, userId), eq(workspaceNodes.projectId, projectId), isNull(workspaceNodes.deletedAt)));
  return rows.map((r) => r.nodeId);
}

/** Star or unstar files; `nodeIds` up to 200 at once (the first sync uploads stars this browser had). */
export async function setNodeStarsAction(projectId: string, nodeIds: string[], starred: boolean): Promise<{ success: boolean }> {
  const ids = nodeIds.filter((id) => UUID_RE.test(id)).slice(0, 200);
  if (!UUID_RE.test(projectId) || !ids.length) return { success: false };
  const userId = await viewerId();
  // Only files in this workspace; anything else is skipped quietly (a stale browser star).
  const known = new Set((await db.select({ id: workspaceNodes.id }).from(workspaceNodes)
    .where(and(eq(workspaceNodes.projectId, projectId), inArray(workspaceNodes.id, ids), isNull(workspaceNodes.deletedAt)))).map((r) => r.id));
  for (const id of ids) if (known.has(id)) await setNodeStar(userId, projectId, id, starred);
  return { success: true };
}
