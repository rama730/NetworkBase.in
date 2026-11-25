"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { createNotification } from "@/lib/notifications/service";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.6 S5 calls 6–8 (plan B3.5c): observations are feedback, not grades. Book one with notice (2 school days),
 * with a focus the observed teacher sees; after the lesson the observer writes Strengths and One next step; the
 * observed teacher reads it first, then their line manager may (never for a peer observation kept "just between
 * us"). Reading it adds it to the observed teacher's development log. Leaders see counts. Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const NOTICE_SCHOOL_DAYS = 2;

async function school(schoolId: string, write = false) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id;
  if (!userId || auth.tokenKind != null) return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown; slug: string | null }>(sql`SELECT org_level AS level, org_settings AS settings, slug FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canRead || !(a.isOwner || (a.isMember && a.memberRole !== "viewer")) || (write && !a.canWrite)) return null;
  const reportsTo = (((w.settings as { staffGrowth?: { reportsTo?: unknown } } | null)?.staffGrowth?.reportsTo ?? {}) as Record<string, string>);
  return { userId, leader: a.isOwner || a.memberRole === "admin", reportsTo, slug: w.slug };
}

/** School days (Mon–Fri) strictly between today and `day`, plus `day` itself when it's a weekday. */
function schoolDaysUntil(today: string, day: string) {
  let n = 0;
  for (let d = Date.parse(`${today}T00:00:00Z`) + 86_400_000; d <= Date.parse(`${day}T00:00:00Z`); d += 86_400_000) { const w = new Date(d).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

const bookSchema = z.object({ observedId: z.string().uuid(), day: z.string().date(), slotId: z.string().uuid().nullable().optional(), focus: z.string().trim().min(1, "Say what the observation looks at.").max(300),
  justBetweenUs: z.boolean().default(false) }).strict();

/** Book an observation of a colleague, with notice; the observed teacher sees the focus. */
export async function bookObservationAction(schoolId: string, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx) return DENIED;
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the observation." };
  const o = parsed.data;
  if (o.observedId === ctx.userId) return { success: false, error: "Observe a colleague, not yourself." };
  const [staff] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = ${schoolId}::uuid AND owner_id = ${o.observedId}::uuid)
    OR EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND user_id = ${o.observedId}::uuid AND role <> 'viewer') AS ok`));
  if (!staff?.ok) return { success: false, error: "Pick someone on the school’s staff." };
  const today = new Date().toISOString().slice(0, 10);
  if (schoolDaysUntil(today, o.day) < NOTICE_SCHOOL_DAYS) return { success: false, error: "Book at least 2 school days ahead." };
  if (o.slotId) {
    const [s] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM school_timetable_slots WHERE id = ${o.slotId}::uuid AND workspace_id = ${schoolId}::uuid AND teacher_id = ${o.observedId}::uuid) AS ok`));
    if (!s?.ok) return { success: false, error: "Pick one of their lessons." };
  }
  const [row] = Array.from(await db.execute<{ id: string }>(sql`INSERT INTO staff_observations (workspace_id, observer_id, observed_id, slot_id, day, focus, just_between_us)
    VALUES (${schoolId}::uuid, ${ctx.userId}::uuid, ${o.observedId}::uuid, ${o.slotId ?? null}, ${o.day}::date, ${o.focus}, ${o.justBetweenUs}) RETURNING id`));
  await createNotification({ recipientUserId: o.observedId, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
    title: `Observation booked for ${o.day}: ${o.focus}`, href: `/org/${encodeURIComponent(ctx.slug ?? schoolId)}?tab=sprints`, entityRefs: { projectId: schoolId, projectSlug: ctx.slug },
    dedupeKey: `observation:${row!.id}:booked` }).catch(() => undefined);
  return { success: true, id: row!.id };
}

const writeSchema = z.object({ strengths: z.string().trim().min(1, "Write the strengths.").max(3000), nextStep: z.string().trim().min(1, "Write one next step.").max(1000) }).strict();

/** After the lesson, the observer writes Strengths and One next step (feedback only); the observed teacher is told. */
export async function writeObservationAction(schoolId: string, id: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || !isLooseUuid(id)) return DENIED;
  const parsed = writeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the feedback." };
  const today = new Date().toISOString().slice(0, 10);
  const [row] = Array.from(await db.execute<{ observed_id: string; focus: string }>(sql`
    UPDATE staff_observations SET strengths = ${parsed.data.strengths}, next_step = ${parsed.data.nextStep}, state = 'written'
    WHERE id = ${id}::uuid AND workspace_id = ${schoolId}::uuid AND observer_id = ${ctx.userId}::uuid AND day <= ${today}::date AND read_at IS NULL RETURNING observed_id, focus`));
  if (!row) return { success: false, error: "Write it after the lesson, before it’s been read." };
  await createNotification({ recipientUserId: row.observed_id, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
    title: `Your observation feedback is ready: ${row.focus}`, href: `/org/${encodeURIComponent(ctx.slug ?? schoolId)}?tab=sprints`, entityRefs: { projectId: schoolId, projectSlug: ctx.slug },
    dedupeKey: `observation:${id}:written` }).catch(() => undefined);
  return { success: true };
}

/** The observed teacher reads it first; it then goes into their development log. */
export async function readObservationAction(schoolId: string, id: string): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || !isLooseUuid(id)) return DENIED;
  const [row] = Array.from(await db.execute<{ focus: string; day: string }>(sql`
    UPDATE staff_observations SET read_at = now() WHERE id = ${id}::uuid AND workspace_id = ${schoolId}::uuid AND observed_id = ${ctx.userId}::uuid AND state = 'written' AND read_at IS NULL
    RETURNING focus, day::text`));
  if (!row) return DENIED;
  await db.execute(sql`INSERT INTO staff_growth (workspace_id, user_id, kind, year, title, created_by) VALUES (${schoolId}::uuid, ${ctx.userId}::uuid, 'log', ${row.day.slice(0, 4)}, ${`Observed: ${row.focus}`.slice(0, 200)}, ${ctx.userId}::uuid)`);
  return { success: true };
}

type Obs = { id: string; day: string; focus: string; strengths: string | null; next_step: string | null; just_between_us: boolean; state: string; read_at: string | null; observer: string | null; observed: string | null; observer_id: string; observed_id: string };
/**
 * My observations: ones I'll give (and write), ones of me (the feedback once written), and — for a line manager —
 * written observations of people who report to me after they've read them, never "just between us" ones.
 */
export async function readObservationsAction(schoolId: string) {
  const ctx = await school(schoolId);
  if (!ctx) return DENIED;
  // Only people still on the staff: a stale Reports to opens nothing.
  const onStaff = new Set(Array.from(await db.execute<{ id: string }>(sql`SELECT owner_id AS id FROM workspaces WHERE id = ${schoolId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND role <> 'viewer'`)).map((r) => r.id));
  const reports = Object.entries(ctx.reportsTo).filter(([p, m]) => m === ctx.userId && onStaff.has(p)).map(([p]) => p);
  const rows = Array.from(await db.execute<Obs>(sql`
    SELECT o.id, o.day::text, o.focus, o.strengths, o.next_step, o.just_between_us, o.state, o.read_at::text, o.observer_id, o.observed_id,
      coalesce(a.full_name, a.username) AS observer, coalesce(b.full_name, b.username) AS observed
    FROM staff_observations o JOIN profiles a ON a.id = o.observer_id JOIN profiles b ON b.id = o.observed_id
    WHERE o.workspace_id = ${schoolId}::uuid AND (o.observer_id = ${ctx.userId}::uuid OR o.observed_id = ${ctx.userId}::uuid
      OR (o.observed_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(reports)}::jsonb)::uuid) AND o.read_at IS NOT NULL AND NOT o.just_between_us))
    ORDER BY o.day DESC LIMIT 200`));
  const shape = (o: Obs, feedback: boolean) => ({ id: o.id, day: o.day, focus: o.focus, observer: o.observer ?? "Staff", observed: o.observed ?? "Staff", state: o.state, read: Boolean(o.read_at),
    justBetweenUs: o.just_between_us, strengths: feedback ? o.strengths : null, nextStep: feedback ? o.next_step : null });
  const [counts] = ctx.leader ? Array.from(await db.execute<{ booked: number; written: number; read: number }>(sql`
    SELECT count(*)::int AS booked, count(*) FILTER (WHERE state = 'written')::int AS written, count(*) FILTER (WHERE read_at IS NOT NULL)::int AS read FROM staff_observations WHERE workspace_id = ${schoolId}::uuid`)) : [];
  return { success: true as const,
    giving: rows.filter((o) => o.observer_id === ctx.userId).map((o) => shape(o, true)),
    ofMe: rows.filter((o) => o.observed_id === ctx.userId).map((o) => shape(o, o.state === "written")),
    myReports: rows.filter((o) => o.observer_id !== ctx.userId && o.observed_id !== ctx.userId).map((o) => shape(o, true)),
    counts: counts ? { booked: Number(counts.booked), written: Number(counts.written), read: Number(counts.read) } : null };
}
