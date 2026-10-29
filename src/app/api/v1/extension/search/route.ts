import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  assertWorkspaceFileReadAccess,
  visibleFileNodesSql,
} from "@/lib/files/internal-helpers";
import { db } from "@/lib/db";
import { workspaceNodes, fileVersions, profiles } from "@/lib/db/schema";
import { and, eq, isNull, asc, gt, sql } from "drizzle-orm";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        q: z.string().max(120).default(""),
        kind: z.enum(["file", "folder"]).default("file"),
        after: z.string().uuid().optional(),
      })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      return jsonError("Invalid search query", 400, "BAD_REQUEST");
    const { projectId, q, after, kind } = parsed.data;
    const access = await assertWorkspaceFileReadAccess(projectId, auth.user.id);
    const pattern = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    const rows = await db
      .select({
        id: workspaceNodes.id,
        name: workspaceNodes.name,
        path: workspaceNodes.path,
        type: workspaceNodes.type,
        currentVersion: workspaceNodes.currentVersion,
        contentHash: fileVersions.contentHash,
        size: workspaceNodes.size,
        updatedAt: workspaceNodes.updatedAt,
        updatedByName: profiles.fullName,
        updatedByAvatarUrl: profiles.avatarUrl,
      })
      .from(workspaceNodes)
      .leftJoin(
        fileVersions,
        and(
          eq(fileVersions.nodeId, workspaceNodes.id),
          eq(fileVersions.version, workspaceNodes.currentVersion),
        ),
      )
      .leftJoin(profiles, eq(profiles.id, fileVersions.uploadedBy))
      .where(
        and(
          eq(workspaceNodes.projectId, projectId),
          eq(workspaceNodes.type, kind),
          isNull(workspaceNodes.deletedAt),
          visibleFileNodesSql(access),
          sql`${workspaceNodes.path} ILIKE ${pattern}`,
          after ? gt(workspaceNodes.id, after) : undefined,
        ),
      )
      .orderBy(asc(workspaceNodes.id))
      .limit(101);
    return jsonSuccess({
      scope: "project_filenames",
      query: q,
      files: rows.slice(0, 100),
      nextCursor: rows.length > 100 ? rows[99]!.id : null,
      loadedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/search",
      fallback: "Search failed",
    });
  }
}
