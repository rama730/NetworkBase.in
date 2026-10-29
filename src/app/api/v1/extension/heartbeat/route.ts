import { z } from "zod";
import { jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionRecoverySessions, } from "@/lib/db/schema";
import { batchRenewFileLeases } from "@/lib/files/file-lock-service";
import { validateCsrf } from "@/lib/security/csrf";
import { and, eq, sql } from "drizzle-orm";
import { canReadProjectTab, getProjectAccessByIds } from "@/lib/data/project-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const MAX_WATERMARK_PROJECTS = 50;
// ponytail: the extension client lives outside this repo, so its cadence is
// unverified; 60/min per user tolerates a few devices at a 2-4s cadence.
// Tighten once the client's interval is pinned.
const HEARTBEATS_PER_MINUTE = 60;

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
        fencingToken: z.number().int().nonnegative(),
      }),
    )
    .max(500)
    .optional(),
  projectWatermarks: z
    .record(z.string().uuid(), z.string().max(64))
    .refine((watermarks) => Object.keys(watermarks).length <= MAX_WATERMARK_PROJECTS, "Too many workspaces")
    .optional(),
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

    // Per-user budget: deviceId is client-chosen, so it cannot partition the limit (VALID-001).
    const budget = await consumeRateLimit(`extension-heartbeat:${user.id}`, HEARTBEATS_PER_MINUTE, 60);
    if (!budget.allowed) return jsonError("Too many heartbeats", 429, "RATE_LIMITED");

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
      // Only projects whose Files the caller may read; others are dropped
      // silently so the response cannot reveal that a project exists (AUTH-004).
      // Task-owned/.system nodes count only for viewers who can read Tasks.
      const access = await getProjectAccessByIds(Object.keys(parsed.data.projectWatermarks), user.id);
      const allNodes: string[] = [];
      const contentNodes: string[] = [];
      for (const [projectId, projectAccess] of Object.entries(access)) {
        if (!canReadProjectTab(projectAccess, "files")) continue;
        (canReadProjectTab(projectAccess, "tasks") ? allNodes : contentNodes).push(projectId);
      }
      const uuids = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
      if (allNodes.length + contentNodes.length > 0) {
        const watermarkResults = await db.execute<{ projectId: string; maxUpdated: string }>(sql`
          SELECT project_id AS "projectId", COALESCE(MAX(updated_at), '1970-01-01'::timestamptz)::text AS "maxUpdated"
          FROM project_nodes
          WHERE deleted_at IS NULL
            AND (
              ${allNodes.length ? sql`project_id IN (${uuids(allNodes)})` : sql`false`}
              OR (${contentNodes.length ? sql`project_id IN (${uuids(contentNodes)})` : sql`false`}
                  AND task_id IS NULL AND path NOT LIKE '/.system%')
            )
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
