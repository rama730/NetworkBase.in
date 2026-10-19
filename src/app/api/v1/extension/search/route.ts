import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  assertProjectFileReadAccess,
  visibleFileNodesSql,
} from "@/lib/files/internal-helpers";
import { db } from "@/lib/db";
import { projectNodes, fileVersions, profiles } from "@/lib/db/schema";
import { and, eq, isNull, asc, gt, sql } from "drizzle-orm";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");
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
    const access = await assertProjectFileReadAccess(projectId, auth.user.id);
    const pattern = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    const rows = await db
      .select({
        id: projectNodes.id,
        name: projectNodes.name,
        path: projectNodes.path,
        type: projectNodes.type,
        currentVersion: projectNodes.currentVersion,
        contentHash: fileVersions.contentHash,
        size: projectNodes.size,
        updatedAt: projectNodes.updatedAt,
        updatedByName: profiles.fullName,
        updatedByAvatarUrl: profiles.avatarUrl,
      })
      .from(projectNodes)
      .leftJoin(
        fileVersions,
        and(
          eq(fileVersions.nodeId, projectNodes.id),
          eq(fileVersions.version, projectNodes.currentVersion),
        ),
      )
      .leftJoin(profiles, eq(profiles.id, fileVersions.uploadedBy))
      .where(
        and(
          eq(projectNodes.projectId, projectId),
          eq(projectNodes.type, kind),
          isNull(projectNodes.deletedAt),
          visibleFileNodesSql(access),
          sql`${projectNodes.path} ILIKE ${pattern}`,
          after ? gt(projectNodes.id, after) : undefined,
        ),
      )
      .orderBy(asc(projectNodes.id))
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
