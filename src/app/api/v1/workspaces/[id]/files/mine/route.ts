import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { nodeStars, workspaceNodeEvents, workspaceNodes } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { orgFileAccessSql } from "@/lib/files/internal-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Your files in a workspace (report C3): `kind=starred` (0087, shared with the Files tab) or `kind=recent` (the files
 * you changed most recently, from the file history), as `nb file list --starred` and `nb file recent` show them.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    const kind = new URL(request.url).searchParams.get("kind");
    if (!UUID.test(id) || (kind !== "starred" && kind !== "recent")) return jsonError("kind is starred or recent", 400, "BAD_REQUEST");
    const access = await getWorkspaceAccessById(id, auth.user.id);
    if (!canReadWorkspaceTab(access, "files")) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    const userId = auth.user.id;
    const visible = and(eq(workspaceNodes.projectId, id), isNull(workspaceNodes.deletedAt), eq(workspaceNodes.type, "file"), orgFileAccessSql(access));
    const columns = { id: workspaceNodes.id, path: workspaceNodes.path, name: workspaceNodes.name, size: workspaceNodes.size, currentVersion: workspaceNodes.currentVersion };
    let files: Array<{ id: string; path: string; name: string; size: number | null; currentVersion: number | null; at: Date | string }>;
    if (kind === "starred") {
      files = await db.select({ ...columns, at: nodeStars.createdAt }).from(nodeStars)
        .innerJoin(workspaceNodes, eq(workspaceNodes.id, nodeStars.nodeId))
        .where(and(eq(nodeStars.userId, userId), visible)).orderBy(asc(workspaceNodes.path)).limit(200);
    } else {
      const mine = db.select({ nodeId: workspaceNodeEvents.nodeId, at: sql<Date>`max(${workspaceNodeEvents.createdAt})`.as("at") }).from(workspaceNodeEvents)
        .where(and(eq(workspaceNodeEvents.projectId, id), eq(workspaceNodeEvents.actorId, userId), sql`${workspaceNodeEvents.createdAt} > now() - interval '30 days'`))
        .groupBy(workspaceNodeEvents.nodeId).as("mine");
      files = await db.select({ ...columns, at: mine.at }).from(mine).innerJoin(workspaceNodes, eq(workspaceNodes.id, mine.nodeId))
        .where(visible).orderBy(desc(mine.at)).limit(20);
    }
    return jsonSuccess({ kind, files: files.map((f) => ({ nodeId: f.id, path: f.path, name: f.name, size: f.size, currentVersion: f.currentVersion, at: f.at })) }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/files/mine", fallback: "Couldn’t list your files" });
  }
}
