import { and, asc, eq, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceSprintEvents, workspaceSprints } from "@/lib/db/schema";
import { notifyOrgSprintBlocked, notifyOrgSprintStarted } from "@/lib/organizations/sprint-notify";

/** Starts one planning sprint unless its project already has an active one. */
export async function startSprint(sprintId: string, projectId: string, now: Date, actorId: string | null, source: "schedule" | "manual") {
  const started = await db.transaction(async (tx) => {
    const active = await tx.query.workspaceSprints.findFirst({
      where: and(eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.status, "active")),
      columns: { id: true },
    });
    if (active) return false;

    const [updated] = await tx
      .update(workspaceSprints)
      .set({ status: "active", startedAt: now, updatedAt: now })
      .where(and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.status, "planning")))
      .returning({ id: workspaceSprints.id });
    if (!updated) return false;

    await tx.insert(workspaceSprintEvents).values({
      projectId,
      sprintId,
      actorId,
      eventType: "started",
      payload: { source },
      createdAt: now,
    });
    return true;
  });
  if (started) await notifyOrgSprintStarted(sprintId, projectId, actorId);
  return started;
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
    .select({ id: workspaceSprints.id, projectId: workspaceSprints.projectId })
    .from(workspaceSprints)
    .where(
      and(
        eq(workspaceSprints.status, "planning"),
        eq(workspaceSprints.autoStart, true),
        lte(workspaceSprints.startDate, now),
        // Archived, suspended or deleting orgs (and child projects archived with them) start nothing (report §30.5).
        sql`NOT app_private.nb_workspace_read_only(${workspaceSprints.projectId})`,
        ...(projectId ? [eq(workspaceSprints.projectId, projectId)] : []),
      ),
    )
    .orderBy(asc(workspaceSprints.startDate), asc(workspaceSprints.id))
    .limit(limit);

  let started = 0;
  for (const candidate of due) {
    if (await startSprint(candidate.id, candidate.projectId, now, null, "schedule")) started += 1;
    // An org sprint blocked by one still active: admins hear once (report §26 C).
    else await notifyOrgSprintBlocked(candidate.id, candidate.projectId);
  }
  return { scanned: due.length, started };
}
