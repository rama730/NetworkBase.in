"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { mentorCheckins, mentorUseful, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { mentoringSchema, planLine, prepDone, prepSchema, readMentoring, rhythm, suggestMatches, usefulSummary, type UsefulAnswer } from "@/lib/organizations/mentoring";
import { notifyOrg, orgHref, orgLabel } from "@/lib/organizations/notify";
import { typeProfile } from "@/lib/organizations/type-profile";
import { todayInZone } from "@/lib/organizations/zoned-time";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.5 C5 (plan B2.3a): mentoring in a class. Mentor groups are sections of kind "mentor"; their TAs are the
 * mentors. Check-ins are private to the pair — the learner and their group's mentors; staff see an entry only when
 * the learner shares it (call). Useful answers show as totals from 5. Tokens never write here (agents never answer
 * Useful).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function classCtx(orgId: string, write = false) {
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

/** Mentor groups with their mentors (the group's TAs) and learners. */
async function groups(orgId: string) {
  const rows = Array.from(await db.execute<{ id: string; name: string; user_id: string | null; role: string | null; person: string | null; joined: string | null }>(sql`
    SELECT s.id, s.name, m.user_id, m.role, coalesce(p.full_name, p.username) AS person, wm.joined_at::text AS joined
    FROM class_sections s LEFT JOIN class_section_members m ON m.section_id = s.id LEFT JOIN profiles p ON p.id = m.user_id
    LEFT JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = m.user_id
    WHERE s.workspace_id = ${orgId}::uuid AND s.kind = 'mentor' ORDER BY s.position, s.name, 5`));
  const map = new Map<string, { id: string; name: string; mentors: Array<{ id: string; name: string }>; learners: Array<{ id: string; name: string; joined: string | null }> }>();
  for (const r of rows) {
    const g = map.get(r.id) ?? { id: r.id, name: r.name, mentors: [], learners: [] };
    if (r.user_id && r.role === "ta") g.mentors.push({ id: r.user_id, name: r.person ?? "Mentor" });
    if (r.user_id && r.role === "student") g.learners.push({ id: r.user_id, name: r.person ?? "Learner", joined: r.joined });
    map.set(r.id, g);
  }
  return [...map.values()];
}

/** Whether `userId` mentors `learnerId` here (a TA of the learner's mentor group). */
async function mentors(orgId: string, userId: string, learnerId: string) {
  const [r] = await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM class_section_members t JOIN class_section_members l ON l.section_id = t.section_id
      JOIN class_sections s ON s.id = t.section_id AND s.kind = 'mentor'
      WHERE t.workspace_id = ${orgId}::uuid AND t.user_id = ${userId}::uuid AND t.role = 'ta' AND l.user_id = ${learnerId}::uuid AND l.role = 'student') AS ok`);
  return Boolean(r?.ok);
}

export async function readMentoringAction(orgId: string) {
  try {
    const ctx = await classCtx(orgId);
    if (!ctx) return DENIED;
    if (!ctx.settings.on) return { success: true as const, on: false as const, canSet: ctx.teacher };
    const today = todayInZone(ctx.zone);
    const all = await groups(orgId);
    const last = new Map(Array.from(await db.execute<{ learner_id: string; last: string | null; held: number }>(sql`
      SELECT learner_id, max(on_date)::text AS last, count(*)::int AS held FROM mentor_checkins
      WHERE workspace_id = ${orgId}::uuid AND on_date <= ${today}::date GROUP BY learner_id`)).map((r) => [r.learner_id, r]));
    const pair = (l: { id: string; name: string; joined: string | null }) => {
      const r = last.get(l.id);
      return { id: l.id, name: l.name, last: r?.last ?? null, held: r?.held ?? 0, rhythm: rhythm(r?.last ?? null, l.joined, ctx.settings.rhythmDays, today) };
    };
    const plan = { everyWeeks: ctx.settings.everyWeeks, minutes: ctx.settings.minutes, checkins: ctx.settings.checkins };
    // My mentor (learners) and My mentees (mentors).
    const mine = all.find((g) => g.learners.some((l) => l.id === ctx.userId));
    const me = mine ? pair(mine.learners.find((l) => l.id === ctx.userId)!) : null;
    const myMentor = ctx.learner ? { mentors: mine?.mentors ?? [], plan: me ? planLine(plan, me.held) : null, last: me?.last ?? null, rhythm: me?.rhythm ?? null } : null;
    const mentees = all.filter((g) => g.mentors.some((m) => m.id === ctx.userId)).flatMap((g) => g.learners.map(pair));
    // Staff: mentor cards (rhythm, Useful totals from 5), learners off rhythm, and who isn't matched yet. Never notes.
    let staff = null;
    if (ctx.staff) {
      const answers = Array.from(await db.execute<{ mentor_id: string | null; answer: UsefulAnswer }>(sql`SELECT mentor_id, answer FROM mentor_useful WHERE workspace_id = ${orgId}::uuid`));
      const matched = new Set(all.flatMap((g) => g.learners.map((l) => l.id)));
      const unmatched = Array.from(await db.execute<{ id: string; name: string }>(sql`
        SELECT m.user_id AS id, coalesce(p.full_name, p.username, 'Learner') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
        WHERE m.workspace_id = ${orgId}::uuid AND m.role = 'member' ORDER BY 2`)).filter((u) => !matched.has(u.id));
      staff = {
        cards: all.map((g) => {
          const pairs = g.learners.map(pair);
          return { id: g.id, name: g.name, mentors: g.mentors, learners: pairs.length, onRhythm: pairs.filter((p) => p.rhythm.on).length,
            off: pairs.filter((p) => !p.rhythm.on).map((p) => ({ name: p.name, days: p.rhythm.days })),
            useful: usefulSummary(answers.filter((a) => g.mentors.some((m) => m.id === a.mentor_id)).map((a) => a.answer)) };
        }),
        unmatched, suggestions: suggestMatches(all.map((g) => ({ id: g.id, size: g.learners.length })), unmatched),
      };
    }
    return { success: true as const, on: true as const, canSet: ctx.teacher, settings: ctx.settings, myMentor, mentees, staff };
  } catch (error) {
    logger.warn("mentoring.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load mentoring." };
  }
}

export async function saveMentoringSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx?.teacher) return DENIED;
  const parsed = mentoringSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the mentoring plan." };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ mentoring: parsed.data })}::jsonb` }).where(eq(workspaces.id, orgId));
  return { success: true };
}

const matchInput = z.array(z.object({ userId: z.string().uuid(), groupId: z.string().uuid() }).strict()).min(1).max(500);

/** Match mentors (call): staff place learners in mentor groups (one each; moving replaces the old group). */
export async function matchMentorsAction(orgId: string, input: unknown): Promise<{ success: true; matched: number } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx?.staff || !ctx.settings.on) return DENIED;
  const parsed = matchInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the matches." };
  const all = await groups(orgId);
  const ok = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role = 'member'`)).map((r) => r.id);
  for (const m of parsed.data) if (!all.some((g) => g.id === m.groupId) || !ok.includes(m.userId)) return { success: false, error: "Match learners of this class to its mentor groups." };
  await db.transaction(async (tx) => {
    for (const m of parsed.data) {
      await tx.execute(sql`DELETE FROM class_section_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${m.userId}::uuid AND kind = 'mentor' AND role = 'student'`);
      await tx.execute(sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind) VALUES (${m.groupId}::uuid, ${orgId}::uuid, ${m.userId}::uuid, 'student', 'mentor')`);
    }
  });
  const org = await orgLabel(orgId);
  if (org) {
    for (const m of parsed.data) {
      const g = all.find((x) => x.id === m.groupId)!;
      const names = g.mentors.map((x) => x.name).join(" and ") || "your mentor";
      // Layer 15: matched is Important to the learner, Normal to the mentor.
      await notifyOrg({ orgId, eventKey: "org.class_changed", actorId: ctx.userId, to: [m.userId], title: `Your mentor in ${org.title} is ${names}`, href: orgHref(org), sourceEventId: `mentor:${m.groupId}:${m.userId}` });
    }
  }
  return { success: true, matched: parsed.data.length };
}

/** A pair's check-ins, newest first (null: my own). The pair reads everything; staff read only entries the learner shared. */
export async function readCheckinsAction(orgId: string, who: string | null) {
  try {
    const ctx = await classCtx(orgId);
    const learnerId = who ?? ctx?.userId ?? "";
    if (!ctx || !isLooseUuid(learnerId)) return DENIED;
    const pairMember = ctx.userId === learnerId || (await mentors(orgId, ctx.userId, learnerId));
    if (!pairMember && !ctx.staff) return DENIED;
    const rows = await db.select().from(mentorCheckins).where(and(eq(mentorCheckins.projectId, orgId), eq(mentorCheckins.learnerId, learnerId))).orderBy(desc(mentorCheckins.onDate)).limit(100);
    const answered = new Set((await db.select({ id: mentorUseful.checkinId }).from(mentorUseful).where(eq(mentorUseful.projectId, orgId))).map((r) => r.id));
    const visible = pairMember ? rows : rows.filter((r) => r.sharedAt);
    return { success: true as const, learnerId, isLearner: ctx.userId === learnerId, isMentor: pairMember && ctx.userId !== learnerId, usefulOn: ctx.settings.useful, today: todayInZone(ctx.zone),
      entries: visible.map((r) => ({ id: r.id, date: r.onDate, prep: (r.prep ?? null) as { since?: string; stuck?: string; asks?: string } | null, prepDone: Boolean(r.prepDoneAt), notes: r.notes,
        shared: Boolean(r.sharedAt), answered: ctx.userId === learnerId ? answered.has(r.id) : undefined })) };
  } catch (error) {
    logger.warn("mentoring.checkins_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the check-ins." };
  }
}

const entryInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().max(20000).optional(), prep: prepSchema.optional() }).strict();

/** Add or edit a dated entry: the pair only; Prep is the learner's. */
export async function saveCheckinAction(orgId: string, learnerId: string, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx || !isLooseUuid(learnerId)) return DENIED;
  const isLearner = ctx.userId === learnerId;
  if (!isLearner && !(await mentors(orgId, ctx.userId, learnerId))) return DENIED;
  const parsed = entryInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the entry." };
  if (parsed.data.prep && !isLearner) return { success: false, error: "Prep is the learner’s to write." };
  const now = new Date();
  const set: Partial<typeof mentorCheckins.$inferInsert> = { updatedAt: now };
  if (parsed.data.notes !== undefined) set.notes = parsed.data.notes.trim() || null;
  if (parsed.data.prep) { set.prep = parsed.data.prep; set.prepDoneAt = prepDone(parsed.data.prep) ? now : null; }
  const [row] = await db.insert(mentorCheckins).values({ projectId: orgId, learnerId, onDate: parsed.data.date, createdBy: ctx.userId, ...set })
    .onConflictDoUpdate({ target: [mentorCheckins.projectId, mentorCheckins.learnerId, mentorCheckins.onDate], set }).returning({ id: mentorCheckins.id });
  return { success: true, id: row!.id };
}

/** The learner shares one entry with the class's staff (or takes it back). */
export async function shareCheckinAction(orgId: string, checkinId: string, share: boolean): Promise<{ success: true } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx || !isLooseUuid(checkinId)) return DENIED;
  const done = await db.update(mentorCheckins).set({ sharedAt: share ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(mentorCheckins.id, checkinId), eq(mentorCheckins.projectId, orgId), eq(mentorCheckins.learnerId, ctx.userId))).returning({ id: mentorCheckins.id });
  return done.length ? { success: true } : DENIED;
}

/** Was this useful? — the learner, once per check-in that has happened. */
export async function answerUsefulAction(orgId: string, checkinId: string, answer: UsefulAnswer, note?: string | null): Promise<{ success: true } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx || !isLooseUuid(checkinId) || !["very", "somewhat", "not_really"].includes(answer) || !ctx.settings.useful) return DENIED;
  const [c] = await db.select({ learnerId: mentorCheckins.learnerId, date: mentorCheckins.onDate }).from(mentorCheckins).where(and(eq(mentorCheckins.id, checkinId), eq(mentorCheckins.projectId, orgId))).limit(1);
  if (!c || c.learnerId !== ctx.userId) return DENIED;
  if (c.date > todayInZone(ctx.zone)) return { success: false, error: "Answer after the check-in." };
  const [g] = await db.execute<{ mentor_id: string | null }>(sql`
    SELECT t.user_id AS mentor_id FROM class_section_members l JOIN class_section_members t ON t.section_id = l.section_id AND t.role = 'ta'
    WHERE l.workspace_id = ${orgId}::uuid AND l.user_id = ${ctx.userId}::uuid AND l.role = 'student' AND l.kind = 'mentor' LIMIT 1`);
  const inserted = await db.insert(mentorUseful).values({ checkinId, projectId: orgId, mentorId: g?.mentor_id ?? null, answer, note: String(note ?? "").trim().slice(0, 500) || null })
    .onConflictDoNothing().returning({ id: mentorUseful.checkinId });
  return inserted.length ? { success: true } : { success: false, error: "You’ve answered for this check-in." };
}
