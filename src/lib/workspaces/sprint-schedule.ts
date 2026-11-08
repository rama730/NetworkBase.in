import { and, asc, eq, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceSprintEvents, workspaceSprints, workspaces } from "@/lib/db/schema";
import { notifyOrgSprintBlocked, notifyOrgSprintCompleted, notifyOrgSprintStarted } from "@/lib/organizations/sprint-notify";
import { isSprintReadyToClose } from "@/lib/workspaces/sprint-detail";
import { publishDueAssignments } from "@/lib/organizations/assignment-publish";

/**
 * Starts one planning sprint unless another runs at its level. Board/review report §6: an organization's main sprint
 * (a CO) and one sprint inside it run together; starting a sprint inside starts its main sprint first.
 */
export async function startSprint(sprintId: string, projectId: string, now: Date, actorId: string | null, source: "schedule" | "manual"): Promise<boolean> {
  const [own] = await db.select({ parentSprintId: workspaceSprints.parentSprintId }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, projectId))).limit(1);
  // Only a main sprint in this same workspace makes a level; a team's sprint inside its organization's stands alone here.
  const [main] = own?.parentSprintId ? await db.select({ id: workspaceSprints.id, status: workspaceSprints.status }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.id, own.parentSprintId), eq(workspaceSprints.projectId, projectId))).limit(1) : [];
  const mainId = main?.id ?? null;
  if (main?.status === "planning" && !(await startSprint(main.id, projectId, now, actorId, source))) return false;
  const started = await db.transaction(async (tx) => {
    const active = await tx.query.workspaceSprints.findFirst({
      where: and(eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.status, "active"),
        mainId ? eq(workspaceSprints.parentSprintId, mainId) : sql`(${workspaceSprints.parentSprintId} IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_sprints p WHERE p.id = ${workspaceSprints.parentSprintId} AND p.workspace_id = ${projectId}))`),
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
  if (started) {
    // "When the sprint starts" (decision 125): its scheduled assignments publish with it, before members hear.
    await publishDueAssignments(now, { sprintId });
    await notifyOrgSprintStarted(sprintId, projectId, actorId);
  }
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
        // Audit N71: outside organizations a running sprint blocks the next until someone completes it, so those
        // aren't due; otherwise 100 of them would fill every run and nothing else would ever start.
        sql`NOT EXISTS (SELECT 1 FROM workspace_sprints a JOIN workspaces w ON w.id = a.workspace_id
          WHERE a.workspace_id = ${workspaceSprints.projectId} AND a.status = 'active' AND w.kind <> 'organization')`,
        ...(projectId ? [eq(workspaceSprints.projectId, projectId)] : []),
      ),
    )
    .orderBy(asc(workspaceSprints.startDate), asc(workspaceSprints.id))
    .limit(limit);

  let started = 0;
  for (const candidate of due) {
    if (await startSprint(candidate.id, candidate.projectId, now, null, "schedule")) started += 1;
    else {
      // Sprint handover (report §42.6, decisions 122 and 123, problem 3): in an organization only, an ended sprint
      // completes with nothing moved and the next starts. Other sprints wait for Complete (42.18 #1).
      const handedOver = await completeEndedOrgSprint(candidate.projectId, now);
      if (handedOver && await startSprint(candidate.id, candidate.projectId, now, null, "schedule")) {
        started += 1;
        await notifyOrgSprintCompleted(handedOver, candidate.projectId, null);
      }
      // An org sprint blocked by one still active: admins hear once (report §26 C).
      else await notifyOrgSprintBlocked(candidate.id, candidate.projectId);
    }
  }
  return { scanned: due.length, started };
}

/** Completes an organization's active sprint whose end date has passed; returns its id, or null. Nothing moves. */
async function completeEndedOrgSprint(projectId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: workspaceSprints.id, endDate: workspaceSprints.endDate })
      .from(workspaceSprints).innerJoin(workspaces, eq(workspaces.id, workspaceSprints.projectId))
      .where(and(eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.status, "active"), eq(workspaces.kind, "organization")))
      .limit(1);
    if (!active || !isSprintReadyToClose({ status: "active", endDate: active.endDate?.toISOString() ?? null }, now)) return null;
    const [done] = await tx.update(workspaceSprints).set({ status: "completed", completedAt: now, updatedAt: now })
      .where(and(eq(workspaceSprints.id, active.id), eq(workspaceSprints.status, "active"))).returning({ id: workspaceSprints.id });
    if (!done) return null;
    await tx.insert(workspaceSprintEvents).values({ projectId, sprintId: done.id, actorId: null, eventType: "completed", payload: { unfinished: "keep", source: "handover" }, createdAt: now });
    return done.id;
  });
}
