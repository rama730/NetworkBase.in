import { and, asc, eq, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectSprintEvents, projectSprints } from "@/lib/db/schema";

/** Starts one planning sprint unless its project already has an active one. */
export async function startSprint(sprintId: string, projectId: string, now: Date, actorId: string | null, source: "schedule" | "manual") {
  return db.transaction(async (tx) => {
    const active = await tx.query.projectSprints.findFirst({
      where: and(eq(projectSprints.projectId, projectId), eq(projectSprints.status, "active")),
      columns: { id: true },
    });
    if (active) return false;

    const [updated] = await tx
      .update(projectSprints)
      .set({ status: "active", startedAt: now, updatedAt: now })
      .where(and(eq(projectSprints.id, sprintId), eq(projectSprints.projectId, projectId), eq(projectSprints.status, "planning")))
      .returning({ id: projectSprints.id });
    if (!updated) return false;

    await tx.insert(projectSprintEvents).values({
      projectId,
      sprintId,
      actorId,
      eventType: "started",
      payload: { source },
      createdAt: now,
    });
    return true;
  });
}

/**
 * Starts due planning sprints. Safe to call from a cron or a recovery read. Sprints with
 * "Start automatically" off (0243) wait for Start now.
 */
export async function startDueSprints(
  now = new Date(),
  limit = 100,
  projectId?: string,
) {
  const due = await db
    .select({ id: projectSprints.id, projectId: projectSprints.projectId })
    .from(projectSprints)
    .where(
      and(
        eq(projectSprints.status, "planning"),
        eq(projectSprints.autoStart, true),
        lte(projectSprints.startDate, now),
        ...(projectId ? [eq(projectSprints.projectId, projectId)] : []),
      ),
    )
    .orderBy(asc(projectSprints.startDate), asc(projectSprints.id))
    .limit(limit);

  let started = 0;
  for (const candidate of due) {
    if (await startSprint(candidate.id, candidate.projectId, now, null, "schedule")) started += 1;
  }
  return { scanned: due.length, started };
}
