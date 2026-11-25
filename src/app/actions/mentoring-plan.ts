"use server";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { mentorCheckins, mentorConcerns, mentorNotes, mentorObjectives, mentorSlots, profileContributions, profiles } from "@/lib/db/schema";
import { canAddObjective, freeSlots, OBJECTIVE_MAX } from "@/lib/organizations/mentoring";
import { mentoringCtx, mentorsOf, pairedSince } from "@/lib/organizations/mentoring-server";
import { notifyOrg, orgHref, orgLabel } from "@/lib/organizations/notify";
import { todayInZone, zonedInputToIso } from "@/lib/organizations/zoned-time";
import { markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.5 C5 (plan B2.3b): objectives (up to 3 open, kept to the pair), a mentor's weekly slots and Book a time,
 * concerns (private and logged, to the Teacher), and the mentor's note on the learner's completion entry (shown only
 * once the learner approves). The Teacher sees objective counts and concerns, never check-in notes.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const BOOK_DAYS = 14;

/** The learner, or a mentor of theirs: the people an objective or a note belongs to. */
async function pair(orgId: string, who: string | null, write = false) {
  const ctx = await mentoringCtx(orgId, write);
  if (!ctx || !ctx.settings.on) return null;
  const learnerId = who ?? ctx.userId;
  if (!isLooseUuid(learnerId)) return null;
  const isLearner = learnerId === ctx.userId && ctx.learner;
  if (!isLearner && !(await pairedSince(orgId, ctx.userId, learnerId))) return null;
  return { ctx, learnerId, isLearner };
}

export async function readObjectivesAction(orgId: string, who: string | null) {
  const p = await pair(orgId, who);
  if (!p) return DENIED;
  const rows = await db.select({ id: mentorObjectives.id, title: mentorObjectives.title, status: mentorObjectives.status }).from(mentorObjectives)
    .where(and(eq(mentorObjectives.projectId, orgId), eq(mentorObjectives.learnerId, p.learnerId))).orderBy(asc(mentorObjectives.createdAt));
  return { success: true as const, objectives: rows, canAdd: canAddObjective(rows.filter((r) => r.status !== "done").length) };
}

const objectiveInput = z.object({ id: z.string().uuid().optional(), title: z.string().trim().min(1).max(200).optional(), status: z.enum(["on_track", "at_risk", "done"]).optional() }).strict();

/** Add one (up to 3 open) or change its title or status; either of the pair. */
export async function saveObjectiveAction(orgId: string, who: string | null, input: unknown): Promise<{ success: true } | Failure> {
  const p = await pair(orgId, who, true);
  if (!p) return DENIED;
  const parsed = objectiveInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Name the objective." };
  const { id, title, status } = parsed.data;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`objectives:${orgId}:${p.learnerId}`}))`);
    const open = (await tx.select({ id: mentorObjectives.id }).from(mentorObjectives)
      .where(and(eq(mentorObjectives.projectId, orgId), eq(mentorObjectives.learnerId, p.learnerId), ne(mentorObjectives.status, "done"), ...(id ? [ne(mentorObjectives.id, id)] : [])))).length;
    if (!id) {
      if (!title) return { success: false as const, error: "Name the objective." };
      if (!canAddObjective(open)) return { success: false as const, error: `Up to ${OBJECTIVE_MAX} objectives at a time. Mark one Done first.` };
      await tx.insert(mentorObjectives).values({ projectId: orgId, learnerId: p.learnerId, title });
      return { success: true as const };
    }
    if (status && status !== "done" && !canAddObjective(open)) return { success: false as const, error: `Up to ${OBJECTIVE_MAX} objectives at a time.` };
    const done = await tx.update(mentorObjectives).set({ ...(title ? { title } : {}), ...(status ? { status } : {}), updatedAt: new Date() })
      .where(and(eq(mentorObjectives.id, id), eq(mentorObjectives.projectId, orgId), eq(mentorObjectives.learnerId, p.learnerId))).returning({ id: mentorObjectives.id });
    return done.length ? { success: true as const } : DENIED;
  });
}

/** A mentor's weekly times (any TA of a mentor group). */
export async function readMySlotsAction(orgId: string) {
  const ctx = await mentoringCtx(orgId);
  if (!ctx?.staff || !ctx.settings.on) return DENIED;
  const rows = await db.select({ weekday: mentorSlots.weekday, start: mentorSlots.startTime }).from(mentorSlots)
    .where(and(eq(mentorSlots.projectId, orgId), eq(mentorSlots.mentorId, ctx.userId))).orderBy(asc(mentorSlots.weekday), asc(mentorSlots.startTime));
  return { success: true as const, slots: rows, zone: ctx.zone };
}

const slotsInput = z.array(z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict()).max(40);

export async function saveMySlotsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(orgId, true);
  if (!ctx?.staff || !ctx.settings.on) return DENIED;
  const parsed = slotsInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Times are a day and HH:MM." };
  const unique = [...new Map(parsed.data.map((s) => [`${s.weekday}-${s.start}`, s])).values()];
  await db.transaction(async (tx) => {
    await tx.delete(mentorSlots).where(and(eq(mentorSlots.projectId, orgId), eq(mentorSlots.mentorId, ctx.userId)));
    if (unique.length) await tx.insert(mentorSlots).values(unique.map((s) => ({ projectId: orgId, mentorId: ctx.userId, weekday: s.weekday, startTime: s.start })));
  });
  return { success: true };
}

async function mentorFree(orgId: string, mentorId: string, zone: string | null) {
  const slots = await db.select({ weekday: mentorSlots.weekday, start: mentorSlots.startTime }).from(mentorSlots).where(and(eq(mentorSlots.projectId, orgId), eq(mentorSlots.mentorId, mentorId)));
  if (!slots.length) return [];
  // Booked: any check-in with a time for a learner this mentor mentors.
  const booked = Array.from(await db.execute<{ at: string }>(sql`
    SELECT c.starts_at::text AS at FROM mentor_checkins c WHERE c.workspace_id = ${orgId}::uuid AND c.starts_at > now()
      AND c.learner_id IN (SELECT l.user_id FROM class_section_members t JOIN class_section_members l ON l.section_id = t.section_id AND l.role = 'student'
        WHERE t.workspace_id = ${orgId}::uuid AND t.user_id = ${mentorId}::uuid AND t.role = 'ta' AND t.kind = 'mentor')`)).map((r) => r.at);
  return freeSlots(slots, booked, todayInZone(zone), BOOK_DAYS, (local) => zonedInputToIso(local, zone));
}

/** Book a time (learner): each mentor's free times for the next 2 weeks, and the learner's next booked check-in. */
export async function readBookingAction(orgId: string) {
  const ctx = await mentoringCtx(orgId);
  if (!ctx?.learner || !ctx.settings.on) return DENIED;
  const ms = await mentorsOf(orgId, ctx.userId);
  const [next] = await db.select({ at: mentorCheckins.startsAt }).from(mentorCheckins)
    .where(and(eq(mentorCheckins.projectId, orgId), eq(mentorCheckins.learnerId, ctx.userId), sql`${mentorCheckins.startsAt} > now()`)).orderBy(asc(mentorCheckins.startsAt)).limit(1);
  const mentors = [];
  for (const m of ms) mentors.push({ ...m, free: await mentorFree(orgId, m.id, ctx.zone) });
  return { success: true as const, mentors, next: next?.at?.toISOString() ?? null, minutes: ctx.settings.minutes, zone: ctx.zone };
}

/** Book one of a mentor's free times; it becomes that day's check-in entry, with its time. */
export async function bookCheckinAction(orgId: string, mentorId: string, startsAt: string): Promise<{ success: true; startsAt: string; minutes: number; mentor: string; ics: string } | Failure> {
  const ctx = await mentoringCtx(orgId, true);
  if (!ctx?.learner || !ctx.settings.on || !isLooseUuid(mentorId)) return DENIED;
  const mentor = (await mentorsOf(orgId, ctx.userId)).find((m) => m.id === mentorId);
  if (!mentor) return DENIED;
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return { success: false, error: "Pick one of the times shown." };
  const result = await db.transaction(async (tx) => {
    // Two learners can't take the same time: one lock per mentor's time.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mentor-slot:${mentorId}:${at.toISOString()}`}))`);
    if (!(await mentorFree(orgId, mentorId, ctx.zone)).includes(at.toISOString())) return { success: false as const, error: "That time was just taken. Pick another." };
    const date = todayInZone(ctx.zone, at);
    await tx.insert(mentorCheckins).values({ projectId: orgId, learnerId: ctx.userId, onDate: date, startsAt: at, createdBy: ctx.userId })
      .onConflictDoUpdate({ target: [mentorCheckins.projectId, mentorCheckins.learnerId, mentorCheckins.onDate], set: { startsAt: at, updatedAt: new Date() } });
    return { success: true as const };
  });
  if (!result.success) return result;
  const org = await orgLabel(orgId);
  // Layer 15: booked is Normal to both.
  if (org) await notifyOrg({ orgId, eventKey: "org.class_changed", actorId: ctx.userId, to: [mentorId], title: `A check-in was booked for ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`, href: orgHref(org), sourceEventId: `booked:${ctx.userId}:${at.toISOString()}` });
  // Layer 6: a .ics file after booking.
  const { icsCalendar } = await import("@/lib/workflows/meetings");
  const ics = icsCalendar([{ uid: `checkin-${ctx.userId}-${at.getTime()}@networkbase.in`, title: `Check-in with ${mentor.name}`, startsAt: at.toISOString(), lengthMinutes: ctx.settings.minutes,
    url: org ? `https://networkbase.in${orgHref(org)}` : "https://networkbase.in" }]);
  return { success: true, startsAt: at.toISOString(), minutes: ctx.settings.minutes, mentor: mentor.name, ics };
}

const concernInput = z.object({ aboutId: z.string().uuid().nullable().optional(), body: z.string().trim().min(1).max(2000) }).strict();

/** Raise a concern (call): a mentor about a mentee, or a learner, privately to the Teacher; it's kept. */
export async function raiseConcernAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(orgId, true);
  if (!ctx || !ctx.settings.on) return DENIED;
  const parsed = concernInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Write the concern." };
  const aboutId = parsed.data.aboutId ?? null;
  if (aboutId && !(aboutId === ctx.userId || (await pairedSince(orgId, ctx.userId, aboutId)) || (ctx.learner && (await mentorsOf(orgId, ctx.userId)).some((m) => m.id === aboutId)))) return DENIED;
  if (!ctx.learner && !aboutId) return { success: false, error: "Say which mentee it’s about." };
  await db.insert(mentorConcerns).values({ projectId: orgId, fromId: ctx.userId, aboutId, body: parsed.data.body });
  const org = await orgLabel(orgId);
  const [owner] = Array.from(await db.execute<{ id: string }>(sql`SELECT owner_id AS id FROM workspaces WHERE id = ${orgId}::uuid`));
  // Layer 15: a concern is Important to the instructor; its words stay in the app.
  if (org && owner) await notifyOrg({ orgId, eventKey: "org.class_changed", actorId: ctx.userId, to: [owner.id], title: `A mentoring concern was raised in ${org.title}`, href: orgHref(org, "?tab=members"), sourceEventId: `concern:${ctx.userId}:${Date.now()}` });
  return { success: true };
}

/** Concerns (the Teacher only), newest first. */
export async function readConcernsAction(orgId: string) {
  const ctx = await mentoringCtx(orgId);
  if (!ctx?.teacher) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; body: string; at: string; from_name: string | null; about_name: string | null }>(sql`
    SELECT c.id, c.body, c.created_at::text AS at, coalesce(f.full_name, f.username) AS from_name, coalesce(a.full_name, a.username) AS about_name
    FROM mentor_concerns c LEFT JOIN profiles f ON f.id = c.from_id LEFT JOIN profiles a ON a.id = c.about_id
    WHERE c.workspace_id = ${orgId}::uuid ORDER BY c.created_at DESC LIMIT 100`));
  return { success: true as const, concerns: rows.map((r) => ({ id: r.id, body: r.body, at: r.at, from: r.from_name, about: r.about_name })) };
}

/** The mentor's note on the learner's completion entry: a mentor writes it, the learner approves it (call). */
export async function readMentorNoteAction(orgId: string, who: string | null) {
  const p = await pair(orgId, who);
  if (!p) return DENIED;
  const [n] = await db.select({ body: mentorNotes.body, approvedAt: mentorNotes.approvedAt, mentorId: mentorNotes.mentorId }).from(mentorNotes)
    .where(and(eq(mentorNotes.projectId, orgId), eq(mentorNotes.learnerId, p.learnerId))).limit(1);
  const [m] = n?.mentorId ? await db.select({ name: profiles.fullName, username: profiles.username }).from(profiles).where(eq(profiles.id, n.mentorId)).limit(1) : [];
  return { success: true as const, isLearner: p.isLearner, note: n ? { body: n.body, approved: Boolean(n.approvedAt), by: m?.name || m?.username || "Mentor" } : null };
}

export async function saveMentorNoteAction(orgId: string, learnerId: string, body: string): Promise<{ success: true } | Failure> {
  const p = await pair(orgId, learnerId, true);
  if (!p || p.isLearner) return DENIED;
  const clean = String(body ?? "").trim().slice(0, 500);
  if (!clean) return { success: false, error: "Write the note." };
  // A new or changed note waits for the learner's approval again.
  await db.insert(mentorNotes).values({ projectId: orgId, learnerId, mentorId: p.ctx.userId, body: clean })
    .onConflictDoUpdate({ target: [mentorNotes.projectId, mentorNotes.learnerId], set: { body: clean, mentorId: p.ctx.userId, approvedAt: null } });
  return { success: true };
}

/** The learner approves the note; their completion entry (if any) carries it from then on. */
export async function approveMentorNoteAction(orgId: string, approve: boolean): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(orgId, true);
  if (!ctx?.learner) return DENIED;
  const [n] = await db.update(mentorNotes).set({ approvedAt: approve ? new Date() : null })
    .where(and(eq(mentorNotes.projectId, orgId), eq(mentorNotes.learnerId, ctx.userId))).returning({ body: mentorNotes.body });
  if (!n) return DENIED;
  const set = approve ? { endNote: `Mentor: ${n.body}`.slice(0, 500) } : { endNote: `Completed ${ctx.title}` };
  const updated = await db.update(profileContributions).set({ ...set, updatedAt: new Date() })
    .where(and(eq(profileContributions.profileId, ctx.userId), eq(profileContributions.projectId, orgId), eq(profileContributions.endReason, "completed"))).returning({ id: profileContributions.id });
  if (updated.length) await markProfileCollaborationSummaryStale(ctx.userId);
  return { success: true };
}
