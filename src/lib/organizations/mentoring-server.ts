import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { mentorObjectives, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { readMentoring, rhythm, type ObjectiveStatus } from "@/lib/organizations/mentoring";
import { todayInZone } from "@/lib/organizations/zoned-time";
import { typeProfile } from "@/lib/organizations/type-profile";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.5 C5 (plan B2.3): who's who in a class's mentoring, shared by its actions. Writes need a person signed in
 * to the app (a token never writes here).
 */
export async function mentoringCtx(orgId: string, write = false) {
  if (!isLooseUuid(orgId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id ?? null;
  if (!userId || (write && auth.tokenKind != null)) return null;
  const [c] = await db.select({ kind: workspaces.kind, orgType: workspaces.orgType, orgLevel: workspaces.orgLevel, settings: workspaces.orgSettings, zone: workspaces.timeZone, title: workspaces.title })
    .from(workspaces).where(and(eq(workspaces.id, orgId), isNull(workspaces.deletedAt))).limit(1);
  if (c?.kind !== "organization" || c.orgLevel || !typeProfile(c.orgType).schools) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!a.canRead || !(a.isOwner || a.isMember) || (write && !a.canWrite)) return null;
  return { userId, teacher: a.isOwner, staff: a.isOwner || a.memberRole === "admin", learner: !a.isOwner && a.memberRole === "member", settings: readMentoring(c.settings), zone: c.zone, title: c.title };
}

/**
 * When `userId` mentors `learnerId` here, the start of their pairing (else null): the mentor still a TA (admin) of the
 * class, the learner still a member, from the later of the two group rows.
 */
export async function pairedSince(orgId: string, userId: string, learnerId: string): Promise<Date | null> {
  const [r] = await db.execute<{ since: string | null }>(sql`
    SELECT max(greatest(l.created_at, t.created_at))::text AS since FROM class_section_members t JOIN class_section_members l ON l.section_id = t.section_id
      JOIN class_sections s ON s.id = t.section_id AND s.kind = 'mentor'
      JOIN workspace_members tw ON tw.workspace_id = t.workspace_id AND tw.user_id = t.user_id AND tw.role = 'admin'
      JOIN workspace_members lw ON lw.workspace_id = l.workspace_id AND lw.user_id = l.user_id AND lw.role = 'member'
    WHERE t.workspace_id = ${orgId}::uuid AND t.user_id = ${userId}::uuid AND t.role = 'ta' AND l.user_id = ${learnerId}::uuid AND l.role = 'student'`);
  return r?.since ? new Date(r.since) : null;
}

/** A learner's current mentors (the TAs of their mentor group who are still admins). */
export async function mentorsOf(orgId: string, learnerId: string) {
  return Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT t.user_id AS id, coalesce(p.full_name, p.username, 'Mentor') AS name FROM class_section_members l
      JOIN class_section_members t ON t.section_id = l.section_id AND t.role = 'ta'
      JOIN class_sections s ON s.id = l.section_id AND s.kind = 'mentor'
      JOIN workspace_members tw ON tw.workspace_id = t.workspace_id AND tw.user_id = t.user_id AND tw.role = 'admin'
      JOIN profiles p ON p.id = t.user_id
    WHERE l.workspace_id = ${orgId}::uuid AND l.user_id = ${learnerId}::uuid AND l.role = 'student' ORDER BY 2`));
}

/** Staff: objectives by status per learner, counts only (never titles), for the mentor cards. */
export async function objectiveCounts(orgId: string, learnerIds: string[]) {
  if (!learnerIds.length) return new Map<string, Record<ObjectiveStatus, number>>();
  const rows = await db.select({ learnerId: mentorObjectives.learnerId, status: mentorObjectives.status, n: sql<number>`count(*)::int` }).from(mentorObjectives)
    .where(and(eq(mentorObjectives.projectId, orgId), inArray(mentorObjectives.learnerId, learnerIds))).groupBy(mentorObjectives.learnerId, mentorObjectives.status);
  const out = new Map<string, Record<ObjectiveStatus, number>>();
  for (const r of rows) {
    const o = out.get(r.learnerId) ?? { on_track: 0, at_risk: 0, done: 0 };
    o[r.status as ObjectiveStatus] = r.n;
    out.set(r.learnerId, o);
  }
  return out;
}

/**
 * The hourly step (report 31.5 layer 15): a Prep reminder the day before a check-in (Normal, once), and Off rhythm once
 * per spell to the learner and their mentors (Normal). Classes with Mentoring on only.
 */
export async function notifyMentoring(now = new Date()) {
  const classes = Array.from(await db.execute<{ id: string; slug: string | null; title: string; zone: string | null; settings: unknown }>(sql`
    SELECT id, slug, title, time_zone AS zone, org_settings AS settings FROM workspaces
    WHERE kind = 'organization' AND deleted_at IS NULL AND (org_settings->'mentoring'->>'on')::boolean IS TRUE LIMIT 500`));
  let sent = 0;
  const send = (to: string, title: string, href: string, dedupeKey: string, projectId: string, slug: string | null) =>
    createNotification({ recipientUserId: to, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more", title, href, entityRefs: { projectId, projectSlug: slug }, dedupeKey })
      .then(() => { sent += 1; }).catch((error) => logger.error("mentoring.notice_failed", { error: error instanceof Error ? error.message : String(error) }));
  for (const c of classes) {
    const settings = readMentoring(c.settings);
    const today = todayInZone(c.zone, now);
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const href = `/org/${encodeURIComponent(c.slug || c.id)}`;
    const prep = Array.from(await db.execute<{ id: string; learner_id: string }>(sql`
      SELECT id, learner_id FROM mentor_checkins WHERE workspace_id = ${c.id}::uuid AND on_date = ${tomorrow}::date AND prep_done_at IS NULL`));
    for (const p of prep) await send(p.learner_id, `${c.title}: fill in Prep for tomorrow’s check-in`, href, `mentor-prep:${p.id}`, c.id, c.slug);
    const pairs = Array.from(await db.execute<{ learner_id: string; joined: string; last: string | null; mentors: string[] }>(sql`
      SELECT l.user_id AS learner_id, l.created_at::text AS joined,
        (SELECT max(on_date)::text FROM mentor_checkins k WHERE k.workspace_id = l.workspace_id AND k.learner_id = l.user_id AND k.on_date <= ${today}::date) AS last,
        coalesce((SELECT jsonb_agg(t.user_id) FROM class_section_members t WHERE t.section_id = l.section_id AND t.role = 'ta'), '[]'::jsonb) AS mentors
      FROM class_section_members l JOIN class_sections s ON s.id = l.section_id AND s.kind = 'mentor'
      JOIN workspace_members w ON w.workspace_id = l.workspace_id AND w.user_id = l.user_id AND w.role = 'member'
      WHERE l.workspace_id = ${c.id}::uuid AND l.role = 'student'`));
    for (const p of pairs) {
      const r = rhythm(p.last, p.joined, settings.rhythmDays, today);
      if (r.on) continue;
      for (const to of new Set([p.learner_id, ...(p.mentors ?? [])])) await send(to, `${c.title}: no check-in in ${r.days} days`, href, `mentor-rhythm:${c.id}:${p.learner_id}:${p.last ?? p.joined.slice(0, 10)}`, c.id, c.slug);
    }
  }
  return { sent };
}

