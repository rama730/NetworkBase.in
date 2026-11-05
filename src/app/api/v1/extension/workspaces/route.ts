import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers } from "@/lib/db/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const rows = await db
      .select({
        id: workspaces.id,
        title: workspaces.title,
        slug: workspaces.slug,
        description: sql<string | null>`SUBSTRING(${workspaces.description} FROM 1 FOR 160)`,
        kind: workspaces.kind,
        status: workspaces.status,
        ownerId: workspaces.ownerId,
        memberRole: workspaceMembers.role,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.projectId, workspaces.id),
          eq(workspaceMembers.userId, user.id),
        ),
      )
      .where(
        and(
          isNull(workspaces.deletedAt),
          or(
            eq(workspaces.ownerId, user.id),
            eq(workspaceMembers.userId, user.id),
          ),
        ),
      )
      .orderBy(desc(workspaces.updatedAt))
      .limit(50);

    return jsonSuccess({
      workspaces: rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        description: row.description,
        kind: row.kind,
        status: row.status,
        role: row.ownerId === user.id ? "owner" : (row.memberRole ?? "member"),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/workspaces",
      fallback: "Couldn’t list workspaces",
    });
  }
}
