import { z } from "zod";
import { jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionRecoverySessions, } from "@/lib/db/schema";
import { batchRenewFileLeases } from "@/lib/files/file-lock-service";
import { validateCsrf } from "@/lib/security/csrf";
import { and, eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const heartbeatSchema = z.object({
  sessionId: z.string().uuid(),
  deviceId: z.string().min(8).max(160),
  activeLeases: z
    .array(
      z.object({
        nodeId: z.string().uuid(),
        projectId: z.string().uuid(),
        leaseId: z.string().uuid(),
        fencingToken: z.number(),
      }),
    )
    .max(500)
    .optional(),
  projectWatermarks: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user || !auth.extensionSessionId) {
      return auth.response ?? jsonError("An active extension session is required", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    const body = await request.json().catch(() => null);
    const parsed = heartbeatSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid heartbeat request", 400, "BAD_REQUEST");
    }

    const now = new Date();

    // 1. Update session heartbeat in a single atomic SQL statement
    await db
      .update(extensionRecoverySessions)
      .set({
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(extensionRecoverySessions.sessionId, parsed.data.sessionId),
          eq(extensionRecoverySessions.userId, user.id),
        ),
      );

    // 2. Batch renew active file leases if provided (Ponytail stdlib: consolidated in 1 hop)
    let renewedLeases: any[] = [];
    if (parsed.data.activeLeases && parsed.data.activeLeases.length > 0) {
      renewedLeases = await batchRenewFileLeases({
        userId: user.id,
        sessionId: parsed.data.sessionId,
        leases: parsed.data.activeLeases,
      });
    }

    // 3. Evaluate project watermarks to detect out-of-sync projects without pulling whole trees
    const invalidatedProjects: string[] = [];
    if (parsed.data.projectWatermarks) {
      const projectIds = Object.keys(parsed.data.projectWatermarks);
      if (projectIds.length > 0) {
        // Query maximum updated_at per project to compare against client watermark
        const watermarkResults = await db.execute<{ projectId: string; maxUpdated: string }>(sql`
          SELECT project_id AS "projectId", COALESCE(MAX(updated_at), '1970-01-01'::timestamptz)::text AS "maxUpdated"
          FROM project_nodes
          WHERE project_id IN (${sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `)})
            AND deleted_at IS NULL
          GROUP BY project_id
        `);

        const serverWatermarks = new Map(
          Array.from(watermarkResults).map((r) => [r.projectId, r.maxUpdated]),
        );

        for (const [pId, clientWm] of Object.entries(parsed.data.projectWatermarks)) {
          const serverWm = serverWatermarks.get(pId);
          if (serverWm && serverWm !== clientWm) {
            invalidatedProjects.push(pId);
          }
        }
      }
    }

    return jsonSuccess({
      status: "ok",
      timestamp: now.getTime(),
      renewedLeases,
      invalidatedProjects,
    });
  } catch (error) {
    return jsonError("Heartbeat processing failed", 500, "INTERNAL_ERROR");
  }
}
