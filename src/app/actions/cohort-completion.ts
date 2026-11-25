"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { readAttendanceAction } from "@/app/actions/attendance";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { cohortCompletions, profileContributions, profiles, workspaceMembers, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { completionDecision, completionLine, completionOpen, completionRule } from "@/lib/organizations/completion";
import { notifyOrg, orgLabel } from "@/lib/organizations/notify";
import { todayInZone } from "@/lib/organizations/zoned-time";
import { endProfileWorkspaceContributionMembership, markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.2 C1 calls 5–6 (plan B2.1b): a cohort's completion. Staff see every learner against the rule and record
 * it from the end date, overriding with a reason; a learner sees only their own. Completed verifies the learner's
 * profile entry for the cohort ("Completed · Verified"); no certificates.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function cohort(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const [c] = await db.select({ id: workspaces.id, title: workspaces.title, kind: workspaces.kind, orgLevel: workspaces.orgLevel, termEnd: workspaces.termEnd, zone: workspaces.timeZone })
    .from(workspaces).where(and(eq(workspaces.id, orgId), isNull(workspaces.deletedAt))).limit(1);
  if (c?.kind !== "organization" || c.orgLevel) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!a.canRead || !(a.isOwner || a.isMember)) return null;
  return { c, userId, staff: a.isOwner || a.memberRole === "admin", learner: !a.isOwner && a.memberRole === "member", canWrite: a.canWrite };
}

/** Each learner's required and approved assignments: copies of the cohort's published assignments, excused ones aside. */
async function assignmentCounts(orgId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, { required: number; approved: number }>();
  const rows = await db.execute<{ user_id: string; required: number; approved: number }>(sql`
    SELECT u.id AS user_id, count(c.id) FILTER (WHERE c.excused_at IS NULL)::int AS required,
           count(c.id) FILTER (WHERE c.excused_at IS NULL AND c.status = 'done')::int AS approved
    FROM unnest(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(userIds)}::jsonb))::uuid[]) AS u(id)
    LEFT JOIN tasks c ON c.deleted_at IS NULL AND c.assignment_id IN (
        SELECT m.id FROM tasks m WHERE m.workspace_id = ${orgId}::uuid AND m.kind = 'assignment' AND m.assignment_id IS NULL
          AND m.deleted_at IS NULL AND (m.assignment_settings->>'publishedAt') IS NOT NULL)
      AND (c.assignee_id = u.id OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = u.id))
    GROUP BY u.id`);
  return new Map(Array.from(rows).map((r) => [r.user_id, { required: r.required, approved: r.approved }]));
}

async function learnersWithRule(orgId: string, people: Array<{ id: string; name: string }>) {
  // B2.2b (report 31.3): a self-paced class completes by its path — every step done — without attendance.
  const { pathCounts, selfPaced } = await import("@/lib/workflows/path-server");
  if (await selfPaced(db, orgId)) {
    const counts = await pathCounts(orgId, people.map((p) => p.id));
    return people.map((p) => {
      const n = counts.get(p.id) ?? { required: 0, approved: 0 };
      return { ...p, ...n, attendance: null, minimum: null, ...completionRule({ ...n, attendance: null, minimum: null }) };
    });
  }
  const [counts, att] = await Promise.all([assignmentCounts(orgId, people.map((p) => p.id)), readAttendanceAction(orgId)]);
  const minimum = att.success && att.settings.on ? att.settings.minimum : null;
  const percent = new Map(att.success ? att.students.map((s) => [s.id, s.percent]) : []);
  return people.map((p) => {
    const n = counts.get(p.id) ?? { required: 0, approved: 0 };
    const attendance = percent.get(p.id) ?? null;
    return { ...p, ...n, attendance, minimum, ...completionRule({ ...n, attendance, minimum }) };
  });
}

export async function readCompletionAction(orgId: string) {
  try {
    const ctx = await cohort(orgId);
    if (!ctx || !(ctx.staff || ctx.learner)) return DENIED;
    const people = await db.select({ id: workspaceMembers.userId, fullName: profiles.fullName, username: profiles.username }).from(workspaceMembers)
      .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "member"), ...(ctx.staff ? [] : [eq(workspaceMembers.userId, ctx.userId)])));
    const learners = await learnersWithRule(orgId, people.map((p) => ({ id: p.id, name: p.fullName || p.username || "Learner" })));
    const records = new Map((await db.select().from(cohortCompletions).where(eq(cohortCompletions.projectId, orgId))).map((r) => [r.userId, r]));
    const rows = learners.map((l) => {
      const r = records.get(l.id);
      return { ...l, record: r ? { completed: r.completed, byRule: r.byRule, reason: r.overrideReason, decidedAt: r.decidedAt.toISOString() } : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const all = [...records.values()];
    return { success: true as const, staff: ctx.staff, canRecord: ctx.staff && ctx.canWrite, termEnd: ctx.c.termEnd,
      open: completionOpen(ctx.c.termEnd, todayInZone(ctx.c.zone)), learners: rows,
      line: ctx.staff ? completionLine(all.filter((r) => r.completed).length, all.length) : null };
  } catch (error) {
    logger.warn("completion.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load completion." };
  }
}

const decisionsInput = z.array(z.object({ userId: z.string().uuid(), completed: z.boolean(), reason: z.string().max(500).nullable().optional() }).strict()).min(1).max(2000);

/**
 * Record completion: staff only, from the end date. Each decision is checked against the rule on the server; going
 * against it needs a reason. Completed verifies the profile entry; changing it back to Not completed takes that away.
 */
export async function recordCompletionAction(orgId: string, input: unknown): Promise<{ success: true; completed: number; notCompleted: number } | Failure> {
  // As with marks: a token (agent, device or personal) never records completion; a person signed in to the app does.
  const auth: { tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ tokenKind: "none" }));
  if (auth.tokenKind != null) return DENIED;
  const ctx = await cohort(orgId);
  if (!ctx?.staff || !ctx.canWrite) return DENIED;
  if (!completionOpen(ctx.c.termEnd, todayInZone(ctx.c.zone))) return { success: false, error: "Completion opens on the cohort’s end date." };
  const parsed = decisionsInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the decisions." };
  const ids = [...new Set(parsed.data.map((d) => d.userId))];
  const people = await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "member"), inArray(workspaceMembers.userId, ids)));
  if (people.length !== ids.length) return { success: false, error: "Only the cohort’s learners can be recorded." };
  const rule = new Map((await learnersWithRule(orgId, people.map((p) => ({ id: p.id, name: "" })))).map((l) => [l.id, l.meets]));
  const rows: Array<typeof cohortCompletions.$inferInsert> = [];
  for (const d of parsed.data) {
    const check = completionDecision(rule.get(d.userId) ?? false, d.completed, d.reason);
    if (!check.ok) return { success: false, error: check.error };
    rows.push({ projectId: orgId, userId: d.userId, completed: d.completed, byRule: check.byRule, overrideReason: check.reason, decidedBy: ctx.userId, decidedAt: new Date() });
  }
  const before = new Map((await db.select({ userId: cohortCompletions.userId, completed: cohortCompletions.completed }).from(cohortCompletions)
    .where(and(eq(cohortCompletions.projectId, orgId), inArray(cohortCompletions.userId, ids)))).map((r) => [r.userId, r.completed]));
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(cohortCompletions).values(rows).onConflictDoUpdate({ target: [cohortCompletions.projectId, cohortCompletions.userId], set: {
      completed: sql`excluded.completed`, byRule: sql`excluded.by_rule`, overrideReason: sql`excluded.override_reason`, decidedBy: sql`excluded.decided_by`, decidedAt: sql`excluded.decided_at` } });
    for (const r of rows) {
      if (r.completed && !before.get(r.userId)) {
        // Call 6: the learner's entry for this cohort reads "Completed · ✓ Verified · Marked completed by …".
        // B2.3b (report 31.5 call 11): an approved mentor's note goes on the entry.
        const [mn] = await tx.execute<{ body: string }>(sql`SELECT body FROM mentor_notes WHERE workspace_id = ${orgId}::uuid AND learner_id = ${r.userId}::uuid AND approved_at IS NOT NULL`);
        await endProfileWorkspaceContributionMembership(tx, { profileId: r.userId, projectId: orgId, verifiedBy: ctx.userId, endedAt: now,
          ending: { reason: "completed", by: ctx.userId, note: mn ? `Mentor: ${mn.body}` : `Completed ${ctx.c.title}` } });
        await tx.update(profileContributions).set({ verifiedAt: now, verifiedBy: ctx.userId, verificationRevokedReason: null })
          .where(and(eq(profileContributions.profileId, r.userId), eq(profileContributions.projectId, orgId), isNull(profileContributions.deletedAt)));
      } else if (!r.completed && before.get(r.userId)) {
        await tx.update(profileContributions).set({ endedAt: null, endReason: null, endedBy: null, endNote: null, verifiedAt: null, verifiedBy: null, updatedAt: now })
          .where(and(eq(profileContributions.profileId, r.userId), eq(profileContributions.projectId, orgId), eq(profileContributions.endReason, "completed"), isNull(profileContributions.deletedAt)));
        await markProfileCollaborationSummaryStale(r.userId, tx);
      }
    }
  });
  const newlyCompleted = rows.filter((r) => r.completed && !before.get(r.userId)).map((r) => r.userId);
  const org = await orgLabel(orgId);
  if (org && newlyCompleted.length) {
    // Layer 15: Completed is Important, to the learner.
    await notifyOrg({ orgId, eventKey: "credit.changed", actorId: ctx.userId, to: newlyCompleted, title: `You completed ${org.title}`, href: "/profile", sourceEventId: `completed:${orgId}:${now.getTime()}` });
  }
  return { success: true, completed: rows.filter((r) => r.completed).length, notCompleted: rows.filter((r) => !r.completed).length };
}


/** Overview line for staff (layer 6): one count, no rule work. */
export async function readCompletionLineAction(orgId: string) {
  const ctx = await cohort(orgId);
  if (!ctx?.staff) return null;
  const [r] = await db.select({ completed: sql<number>`count(*) FILTER (WHERE ${cohortCompletions.completed})::int`, recorded: sql<number>`count(*)::int` })
    .from(cohortCompletions).where(eq(cohortCompletions.projectId, orgId));
  return completionLine(r?.completed ?? 0, r?.recorded ?? 0);
}
