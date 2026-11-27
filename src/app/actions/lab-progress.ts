"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { readPosition } from "@/lib/organizations/lab";
import { lab, personOf, supervises } from "@/lib/organizations/lab-progress-access";
import { milestonePlan, supervisionRhythm, type MilestoneState } from "@/lib/organizations/lab-progress";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.6 (plan B6.5b, R5 calls 3–4): supervision and milestones. Supervision notes are private to the person, their
 * supervisor and co-supervisor; a PI who isn't one of them sees only the rhythm (call 3). Milestones come from the lab's
 * template for the person's position, due from their start date (call 4); the supervisor (or the PI) marks one done or
 * moves it with a reason. No ratings, scores or rankings.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const today = () => new Date().toISOString().slice(0, 10);

/** My progress (the person), or a student's (their supervisors and the PI): record, rhythm, milestones; notes only for the pair. */
export async function readProgressAction(orgId: string, who?: string | null) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const userId = who && isLooseUuid(who) ? who : ctx.userId;
  const person = await personOf(ctx, orgId, userId);
  if (!person) return userId === ctx.userId ? { success: true as const, set: false as const, admin: ctx.admin } : DENIED;
  const self = userId === ctx.userId;
  const pair = self || supervises(ctx, person);
  if (!pair && !ctx.pi) return DENIED;
  const [last] = Array.from(await db.execute<{ d: string | null }>(sql`SELECT max(met_on)::text AS d FROM lab_supervision_notes WHERE org_id = ${orgId}::uuid AND student_id = ${userId}::uuid`));
  const names = new Map(Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT id, coalesce(full_name, username, 'Someone') AS name FROM profiles WHERE id = ANY(${`{${[person.supervisor, person.co].filter(Boolean).join(",")}}`}::uuid[])`)).map((r) => [r.id, r.name]));
  const milestones = Array.from(await db.execute<{ key: string; name: string; due_on: string; state: MilestoneState; moved_reason: string | null }>(sql`
    SELECT key, name, due_on::text, state, moved_reason FROM lab_milestones WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid ORDER BY due_on, key`));
  // Call 3: the notes themselves only for the person and their supervisors; a PI outside the pair sees the rhythm only.
  const notes = pair ? Array.from(await db.execute<{ id: string; met_on: string; topics: string; notes: string; next_steps: string; author: string | null }>(sql`
    SELECT n.id, n.met_on::text, n.topics, n.notes, n.next_steps, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = n.author_id) AS author
    FROM lab_supervision_notes n WHERE n.org_id = ${orgId}::uuid AND n.student_id = ${userId}::uuid ORDER BY n.met_on DESC, n.created_at DESC LIMIT 100`)) : [];
  return { success: true as const, set: true as const, self, pair, canDecide: !ctx.blocked && (supervises(ctx, person) || ctx.pi), admin: ctx.admin,
    person: { id: userId, name: person.name ?? "Someone", startDate: person.start, partTime: person.part_time, weeks: person.weeks,
      supervisor: { id: person.supervisor, name: names.get(person.supervisor) ?? "the PI" }, co: person.co ? { id: person.co, name: names.get(person.co) ?? "Someone" } : null },
    rhythm: { lastMet: last?.d ?? null, ...supervisionRhythm(last?.d ?? null, person.start, person.weeks, today()) },
    milestones: milestones.map((m) => ({ key: m.key, name: m.name, dueOn: m.due_on, state: m.state, movedReason: m.moved_reason })),
    notes: notes.map((n) => ({ id: n.id, metOn: n.met_on, topics: n.topics, notes: n.notes, nextSteps: n.next_steps, author: n.author })) };
}

/** Leads (PI and Researchers): each person's next milestone and supervision rhythm — dates only, never notes or rankings. */
export async function readLabProgressAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx?.admin) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; name: string; start: string; weeks: number; last: string | null; next_name: string | null; next_due: string | null }>(sql`
    SELECT lp.user_id AS id, coalesce(p.full_name, p.username, 'Someone') AS name, lp.start_date::text AS start, lp.supervision_weeks AS weeks,
      (SELECT max(met_on)::text FROM lab_supervision_notes n WHERE n.org_id = lp.org_id AND n.student_id = lp.user_id) AS last,
      (SELECT name FROM lab_milestones x WHERE x.org_id = lp.org_id AND x.user_id = lp.user_id AND x.state <> 'done' ORDER BY due_on LIMIT 1) AS next_name,
      (SELECT due_on::text FROM lab_milestones x WHERE x.org_id = lp.org_id AND x.user_id = lp.user_id AND x.state <> 'done' ORDER BY due_on LIMIT 1) AS next_due
    FROM lab_progress lp JOIN profiles p ON p.id = lp.user_id
    JOIN workspace_members m ON m.workspace_id = lp.org_id AND m.user_id = lp.user_id AND m.completed_at IS NULL
    WHERE lp.org_id = ${orgId}::uuid ORDER BY 2 LIMIT 300`));
  const people = Array.from(await db.execute<{ id: string; name: string; lead: boolean }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name, m.role IN ('owner', 'admin') AS lead FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 300`));
  const t = today();
  return { success: true as const, people: people.map(({ id, name }) => ({ id, name })), leads: people.filter((p) => p.lead).map(({ id, name }) => ({ id, name })), rows: rows.map((r) => ({ id: r.id, name: r.name, startDate: r.start, next: r.next_name ? { name: r.next_name, dueOn: r.next_due! } : null,
    ...supervisionRhythm(r.last, r.start, r.weeks, t), lastMet: r.last })) };
}

const setupSchema = z.object({ startDate: z.string().date(), partTime: z.boolean(), coSupervisorId: z.string().uuid().nullable(), weeks: z.number().int().min(1).max(12) }).strict();

/**
 * Set up a person's progress (PI and Researchers): start date, part-time, co-supervisor, rhythm. Milestones are made from
 * the template for their position; a new start date or part-time moves the ones nobody moved or finished.
 */
export async function setProgressAction(orgId: string, userId: string, input: unknown): Promise<{ success: true; milestones: number } | Failure> {
  const ctx = await lab(orgId);
  const parsed = setupSchema.safeParse(input);
  if (!ctx?.admin || !isLooseUuid(userId)) return DENIED;
  if (!parsed.success) return { success: false, error: "Give a start date and a rhythm of 1 to 12 weeks." };
  const s = parsed.data;
  const [m] = Array.from(await db.execute<{ prefs: unknown }>(sql`
    SELECT view_prefs AS prefs FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role <> 'viewer' AND completed_at IS NULL`));
  if (!m) return { success: false, error: "Progress is for people in the lab." };
  // Security review: a co-supervisor reads the private log, so only the PI or the person's supervisor names or changes one.
  const [before] = Array.from(await db.execute<{ co: string | null }>(sql`SELECT co_supervisor_id AS co FROM lab_progress WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid`));
  const coChanges = (before?.co ?? null) !== s.coSupervisorId;
  if (coChanges && !(ctx.pi || (ctx.reports[userId] ?? ctx.owner) === ctx.userId)) return { success: false, error: "Only the PI or the person’s supervisor names a co-supervisor." };
  if (s.coSupervisorId) {
    const [co] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${s.coSupervisorId}::uuid
      AND role IN ('owner', 'admin') AND completed_at IS NULL) AS ok`));
    if (!co?.ok || s.coSupervisorId === userId) return { success: false, error: "A co-supervisor is the PI or one of the lab’s Researchers." };
  }
  const steps = ctx.settings.milestones[readPosition(m.prefs).position ?? ""] ?? [];
  const plan = milestonePlan(steps, s.startDate, s.partTime);
  await db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO lab_progress (org_id, user_id, start_date, part_time, co_supervisor_id, supervision_weeks) VALUES
      (${orgId}::uuid, ${userId}::uuid, ${s.startDate}::date, ${s.partTime}, ${s.coSupervisorId}::uuid, ${s.weeks})
      ON CONFLICT (org_id, user_id) DO UPDATE SET start_date = EXCLUDED.start_date, part_time = EXCLUDED.part_time, co_supervisor_id = EXCLUDED.co_supervisor_id,
        supervision_weeks = EXCLUDED.supervision_weeks, updated_at = now()`);
    for (const p of plan) {
      await tx.execute(sql`INSERT INTO lab_milestones (org_id, user_id, key, name, due_on) VALUES (${orgId}::uuid, ${userId}::uuid, ${p.key}, ${p.name}, ${p.dueOn}::date)
        ON CONFLICT (org_id, user_id, key) DO UPDATE SET due_on = EXCLUDED.due_on, name = EXCLUDED.name
        WHERE lab_milestones.state = 'upcoming' AND lab_milestones.moved_reason IS NULL`);
    }
  });
  if (coChanges && s.coSupervisorId) {
    await createNotification({ recipientUserId: userId, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: "You have a new co-supervisor, who can read your supervision log", href: `/org/${encodeURIComponent(ctx.slug)}`, entityRefs: { projectId: orgId, projectSlug: ctx.slug },
      dedupeKey: `lab-co:${orgId}:${userId}:${s.coSupervisorId}` }).catch(() => undefined);
  }
  return { success: true, milestones: plan.length };
}

const noteSchema = z.object({ metOn: z.string().date(), topics: z.string().trim().max(2000), notes: z.string().trim().max(10000), nextSteps: z.string().trim().max(2000) }).strict();

/** Add to the running supervision log (the person or their supervisors). Resets the "supervision due" notice. */
export async function addSupervisionNoteAction(orgId: string, studentId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = noteSchema.safeParse(input);
  if (!ctx || ctx.blocked || !isLooseUuid(studentId) || !parsed.success) return DENIED;
  const person = await personOf(ctx, orgId, studentId);
  if (!person || !(studentId === ctx.userId || supervises(ctx, person))) return DENIED;
  const n = parsed.data;
  if (!n.topics && !n.notes && !n.nextSteps) return { success: false, error: "Write at least one line." };
  if (n.metOn > today()) return { success: false, error: "A supervision note is for a meeting that happened." };
  await db.execute(sql`INSERT INTO lab_supervision_notes (org_id, student_id, met_on, topics, notes, next_steps, author_id)
    VALUES (${orgId}::uuid, ${studentId}::uuid, ${n.metOn}::date, ${n.topics}, ${n.notes}, ${n.nextSteps}, ${ctx.userId}::uuid)`);
  await db.execute(sql`UPDATE lab_progress SET supervision_notice_at = NULL WHERE org_id = ${orgId}::uuid AND user_id = ${studentId}::uuid`);
  return { success: true };
}

/** Hand in a milestone (the person): it waits for their supervisor, who is told. */
export async function handInMilestoneAction(orgId: string, key: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || typeof key !== "string") return DENIED;
  const [m] = Array.from(await db.execute<{ name: string }>(sql`
    UPDATE lab_milestones SET state = 'handed_in', handed_in_at = now() WHERE org_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND key = ${key} AND state = 'upcoming' RETURNING name`));
  if (!m) return DENIED;
  const person = await personOf(ctx, orgId, ctx.userId);
  for (const u of new Set([person?.supervisor, person?.co].filter((x): x is string => Boolean(x) && x !== ctx.userId))) {
    await createNotification({ recipientUserId: u, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `${person?.name ?? "Someone"} handed in ${m.name}`, href: `/org/${encodeURIComponent(ctx.slug)}`, entityRefs: { projectId: orgId, projectSlug: ctx.slug },
      dedupeKey: `lab-milestone-in:${orgId}:${ctx.userId}:${key}:${u}` }).catch(() => undefined);
  }
  return { success: true };
}

const decideSchema = z.union([z.object({ done: z.literal(true) }).strict(), z.object({ moveTo: z.string().date(), reason: z.string().trim().min(1).max(300) }).strict()]);

/** The supervisor, co-supervisor or PI marks a milestone done, or moves it with a reason (e.g. time away). */
export async function decideMilestoneAction(orgId: string, userId: string, key: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = decideSchema.safeParse(input);
  if (!ctx || ctx.blocked || !isLooseUuid(userId) || typeof key !== "string") return DENIED;
  if (!parsed.success) return { success: false, error: "Moving a milestone needs a new date and a reason." };
  const person = await personOf(ctx, orgId, userId);
  if (!person || userId === ctx.userId || !(supervises(ctx, person) || ctx.pi)) return DENIED;
  const d = parsed.data;
  const [r] = Array.from(await db.execute<{ key: string }>("done" in d
    ? sql`UPDATE lab_milestones SET state = 'done', done_at = now(), done_by = ${ctx.userId}::uuid WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND key = ${key} AND state <> 'done' RETURNING key`
    : sql`UPDATE lab_milestones SET due_on = ${d.moveTo}::date, moved_reason = ${d.reason}, state = 'upcoming', notice_30_at = NULL, notice_7_at = NULL
        WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND key = ${key} AND state <> 'done' RETURNING key`));
  return r ? { success: true } : DENIED;
}
