import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import {
  projectNodeEvents,
  projectNodes,
  uploadIntents,
} from "@/lib/db/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  assertWorkspaceFileReadAccess,
  visibleFileNodesSql,
} from "@/lib/files/internal-helpers";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const params = new URL(request.url).searchParams;
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        operationId: z.string().min(8).max(200),
      })
      .safeParse(Object.fromEntries(params));
    if (!parsed.success)
      return jsonError("Invalid operation query", 400, "BAD_REQUEST");
    const { projectId, operationId } = parsed.data;
    const access = await assertWorkspaceFileReadAccess(projectId, auth.user.id);
    // Receipts come from the committed event, not a guess based on today's file bytes.
    const rows = await db
      .select({
        path: projectNodes.path,
        nodeId: projectNodeEvents.nodeId,
        metadata: projectNodeEvents.metadata,
        createdAt: projectNodeEvents.createdAt,
      })
      .from(projectNodeEvents)
      .leftJoin(projectNodes, eq(projectNodes.id, projectNodeEvents.nodeId))
      .leftJoin(
        uploadIntents,
        sql`${uploadIntents.id}::text = ${projectNodeEvents.metadata}->>'uploadIntentId'`,
      )
      .where(
        and(
          eq(projectNodeEvents.projectId, projectId),
          eq(projectNodeEvents.actorId, auth.user.id),
          visibleFileNodesSql(access),
          sql`(${projectNodeEvents.metadata}->>'operationId' = ${operationId} OR ${uploadIntents.metadata}->>'operationId' = ${operationId})`,
        ),
      )
      .orderBy(desc(projectNodeEvents.createdAt))
      .limit(50);
    return jsonSuccess({
      operationId,
      receipts: rows.map((row) => ({
        path: row.metadata?.path || row.path,
        nodeId: row.metadata?.nodeId || row.nodeId,
        version: row.metadata?.version,
        contentHash: row.metadata?.hash,
        size: row.metadata?.size,
        createdAt: row.createdAt,
      })),
      state: rows.length ? "committed" : "unconfirmed",
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/operation",
      fallback: "Couldn’t reconcile operation",
    });
  }
}
