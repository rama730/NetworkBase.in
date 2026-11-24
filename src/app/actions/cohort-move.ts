"use server";

import { and, eq, isNull, sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { tasks, workspaceMembers, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { notifyNewCopies } from "@/lib/organizations/assignment-notify";
import { createCopiesAfterJoin, handedInSql } from "@/lib/organizations/assignments";
import { orgMemberCap } from "@/lib/organizations/join-rules";
import { accountOrgLimit } from "@/lib/organizations/members";
import { notifyOrg, orgHref, orgLabel } from "@/lib/organizations/notify";
import { addWorkspaceMemberInternal, changeWorkspaceMemberRoleInternal } from "@/lib/workspaces/collaborator-lifecycle";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.2 C1 call 7 (plan B2.1c): Move to a later cohort. Finished work stays in the old cohort; open copies
 * there are Excused ("Moved to …"); the learner reads the old cohort as a Viewer and joins a later cohort of the
 * same program. Staff of both cohorts only; a token never moves anyone.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function staffOf(orgId: string, userId: string) {
  const a = await getWorkspaceAccessById(orgId, userId);
  return a.project?.kind === "organization" && a.canWrite && (a.isOwner || a.memberRole === "admin");
}

async function viewer() {
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  return auth.user && auth.tokenKind == null ? auth.user.id : null;
}

const cohortSql = (id: string) => db.select({ id: workspaces.id, title: workspaces.title, ownerId: workspaces.ownerId, start: workspaces.termStart, end: workspaces.termEnd,
  max: workspaces.maxCollaborators, program: sql<string | null>`${workspaces.orgSettings}->>'programId'` }).from(workspaces)
  .where(and(eq(workspaces.id, id), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt))).limit(1);

/** Later cohorts of the same program this person staffs, with seats left (the Move picker). */
export async function readLaterCohortsAction(orgId: string) {
  const me = await viewer();
  if (!me || !isLooseUuid(orgId) || !(await staffOf(orgId, me))) return DENIED;
  const [from] = await cohortSql(orgId);
  if (!from?.program) return { success: true as const, cohorts: [] };
  const rows = Array.from(await db.execute<{ id: string; title: string; start: string | null; max: string | null; members: number }>(sql`
    SELECT w.id, w.title, w.term_start::text AS start, w.max_collaborators AS max,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS members
    FROM workspaces w WHERE w.kind = 'organization' AND w.deleted_at IS NULL AND w.id <> ${orgId}::uuid
      AND w.org_settings->>'programId' = ${from.program} AND w.term_start > ${from.start ?? "1900-01-01"}::date
      AND (w.term_end IS NULL OR w.term_end >= current_date) ORDER BY w.term_start LIMIT 20`));
  const mine = [];
  for (const r of rows) if (await staffOf(r.id, me)) mine.push({ id: r.id, title: r.title, start: r.start, seatsLeft: orgMemberCap(r.max) - r.members });
  return { success: true as const, cohorts: mine };
}

export async function moveToLaterCohortAction(fromId: string, userId: string, toId: string): Promise<{ success: true; excused: number } | Failure> {
  const me = await viewer();
  if (!me || ![fromId, userId, toId].every(isLooseUuid) || !(await staffOf(fromId, me)) || !(await staffOf(toId, me))) return DENIED;
  const [[from], [to]] = await Promise.all([cohortSql(fromId), cohortSql(toId)]);
  if (!from?.program || from.program !== to?.program) return { success: false, error: "Pick a cohort of the same program." };
  if (!from.start || !to.start || to.start <= from.start) return { success: false, error: "Pick a later cohort." };
  const result = await db.transaction(async (tx) => {
    const [m] = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, fromId), eq(workspaceMembers.userId, userId))).limit(1);
    if (m?.role !== "member") return { success: false as const, error: "Only a learner in this cohort can move." };
    const [already] = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, toId), eq(workspaceMembers.userId, userId))).limit(1);
    if (already) return { success: false as const, error: "They’re already in that cohort." };
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(eq(workspaceMembers.projectId, toId));
    if (n >= orgMemberCap(to.max)) return { success: false as const, error: `${to.title} is full.` };
    const limit = await accountOrgLimit(tx, userId, "join");
    if (limit) return { success: false as const, error: limit };
    // Open copies in the old cohort are Excused, never deleted; handed-in work stays as it is.
    const excused = await tx.update(tasks).set({ excusedAt: new Date(), excusedReason: `Moved to ${to.title}`, updatedAt: new Date() })
      .where(and(eq(tasks.projectId, fromId), eq(tasks.assigneeId, userId), sql`${tasks.assignmentId} IS NOT NULL`, isNull(tasks.deletedAt), isNull(tasks.excusedAt),
        sql`NOT ${handedInSql}`, sql`NOT EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id <> ${userId}::uuid)`))
      .returning({ id: tasks.id });
    // Viewer in the old cohort: they keep reading their finished work, get no new copies and leave its lists.
    await changeWorkspaceMemberRoleInternal(tx, { projectId: fromId, actorId: from.ownerId, realActorId: me, targetUserId: userId, nextRole: "viewer" });
    await addWorkspaceMemberInternal(tx, { projectId: toId, userId, role: "member", actorId: to.ownerId, realActorId: me, source: "manual" });
    return { success: true as const, excused: excused.length };
  });
  if (!result.success) return result;
  await createCopiesAfterJoin(toId, [userId]);
  await notifyNewCopies(toId, { userId });
  const org = await orgLabel(toId);
  // Layer 15: moved to a later cohort is Important, to the learner.
  if (org) await notifyOrg({ orgId: toId, eventKey: "org.join_decided", actorId: me, to: [userId], title: `You moved to ${org.title}`, href: orgHref(org), sourceEventId: `moved:${fromId}:${userId}` });
  return result;
}
