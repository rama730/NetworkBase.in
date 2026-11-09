import { and, asc, eq, gt, isNull, notLike } from "drizzle-orm";
import { z } from "zod";

import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import { fileVersions, workspaceNodes } from "@/lib/db/schema";
import { assertWorkspaceFileReadAccess, visibleFileNodesSql } from "@/lib/files/internal-helpers";
import { WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 5000;

/**
 * Every file the caller may see, with its version and hash, in pages of 5,000 (report A2.5, A12.8,
 * finding 64). The CLI compares this with its local state to decide what to pull and push, in a few
 * requests instead of a search loop that stopped after five pages. Task working files (/.system) are
 * listed per task, not here (A1.4).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    const query = z
      .object({ projectId: z.string().uuid(), after: z.string().uuid().optional() })
      .safeParse({ projectId: id, after: new URL(request.url).searchParams.get("cursor") ?? undefined });
    if (!query.success) return jsonError("Invalid workspace or cursor", 400, "BAD_REQUEST");
    const { projectId, after } = query.data;

    const access = await assertWorkspaceFileReadAccess(projectId, auth.user.id);
    const rows = await db
      .select({
        nodeId: workspaceNodes.id,
        path: workspaceNodes.path,
        version: workspaceNodes.currentVersion,
        contentHash: fileVersions.contentHash,
        size: workspaceNodes.size,
        updatedAt: workspaceNodes.updatedAt,
      })
      .from(workspaceNodes)
      .leftJoin(fileVersions, and(eq(fileVersions.nodeId, workspaceNodes.id), eq(fileVersions.version, workspaceNodes.currentVersion)))
      .where(
        and(
          eq(workspaceNodes.projectId, projectId),
          eq(workspaceNodes.type, "file"),
          isNull(workspaceNodes.deletedAt),
          notLike(workspaceNodes.path, "/.system%"),
          visibleFileNodesSql(access),
          after ? gt(workspaceNodes.id, after) : undefined,
        ),
      )
      .orderBy(asc(workspaceNodes.id))
      .limit(PAGE + 1);

    const files = rows.slice(0, PAGE);
    return jsonSuccess(
      {
        files,
        nextCursor: rows.length > PAGE ? files[files.length - 1]!.nodeId : null,
        canWrite: access.canWrite,
        limits: { largestFileBytes: WORKSPACE_UPLOAD_MAX_FILE_BYTES },
      },
      undefined,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/manifest", fallback: "Couldn’t list workspace files" });
  }
}
