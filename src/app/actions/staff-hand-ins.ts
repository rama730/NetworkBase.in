"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import type { AssignmentTarget } from "@/lib/organizations/assignment-rules";
import { resolveRecipients } from "@/lib/organizations/assignments";
import { clashCheck, deadlineWeeks, type Deadline, type QuietWeek } from "@/lib/organizations/staff-deadlines";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.4 S3 calls 5–6, 8 (plan B3.3c): Settings → Hand-ins (quiet weeks), the clash check while asking (other
 * staff deadlines that week for the same people; it warns, never blocks), and the Deadlines view for the school's
 * leaders — counts per week, never names (no public overdue list).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function school(schoolId: string, leadersOnly: boolean, write = false) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id;
  if (!userId || (write && auth.tokenKind != null)) return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown }>(sql`SELECT org_level AS level, org_settings AS settings FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  const leader = a.canRead && (a.isOwner || a.memberRole === "admin");
  if (w?.level !== "institution" || !a.canRead || (leadersOnly && !leader) || (write && !a.canWrite)) return null;
  return { settings: w.settings, leader };
}

const readQuiet = (settings: unknown): QuietWeek[] => {
  const raw = (settings as { handIns?: { quietWeeks?: unknown } } | null)?.handIns?.quietWeeks;
  return (Array.isArray(raw) ? raw : []).filter((q): q is QuietWeek => Boolean(q && typeof q.name === "string" && typeof q.start === "string" && typeof q.end === "string")).slice(0, 30);
};

/** The school's open and upcoming staff deadlines, with the people each is for (copies, or who it's set to go to). */
async function deadlines(schoolId: string): Promise<Deadline[]> {
  const rows = Array.from(await db.execute<{ id: string; title: string; due: string; people: string[] | null; target: unknown }>(sql`
    SELECT m.id, m.title, m.due_date::date::text AS due, m.assignment_settings->'target' AS target,
      (SELECT jsonb_agg(c.assignee_id) FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL) AS people
    FROM tasks m WHERE m.workspace_id = ${schoolId}::uuid AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL
      AND m.due_date >= now() - interval '7 days' AND m.due_date <= now() + interval '400 days' AND m.assignment_settings->>'closedAt' IS NULL LIMIT 500`));
  const out: Deadline[] = [];
  for (const r of rows) {
    let people = (r.people ?? []).filter(Boolean);
    if (!people.length) people = (await resolveRecipients(db, schoolId, r.target as AssignmentTarget, { dropMissing: true }).catch(() => [])).map((x) => x.assigneeId);
    out.push({ id: r.id, title: r.title, due: r.due, people });
  }
  return out;
}

export async function readHandInSettingsAction(schoolId: string) {
  const ctx = await school(schoolId, false);
  if (!ctx) return DENIED;
  return { success: true as const, canEdit: ctx.leader, quietWeeks: readQuiet(ctx.settings) };
}

const quietSchema = z.array(z.object({ name: z.string().trim().min(1, "Name each quiet week.").max(60), start: z.string().date(), end: z.string().date() })
  .refine((q) => q.end >= q.start, "A quiet week ends after it starts.")).max(30);

/** Settings → Hand-ins: quiet weeks (school leaders). */
export async function saveQuietWeeksAction(schoolId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true, true);
  if (!ctx) return DENIED;
  const parsed = quietSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the quiet weeks." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('handIns', coalesce(org_settings->'handIns', '{}'::jsonb) || jsonb_build_object('quietWeeks', ${JSON.stringify(parsed.data)}::jsonb)) WHERE id = ${schoolId}::uuid`);
  return { success: true };
}

/** The clash check while asking (call 6): never blocks; counts of people, not names. Leaders and admins who ask. */
export async function checkDeadlineClashAction(schoolId: string, due: string, target: unknown) {
  const ctx = await school(schoolId, true);
  if (!ctx || !/^\d{4}-\d{2}-\d{2}$/.test(String(due))) return DENIED;
  const people = (await resolveRecipients(db, schoolId, target as AssignmentTarget, { dropMissing: true }).catch(() => [])).map((r) => r.assigneeId);
  return { success: true as const, ...clashCheck(due, people, await deadlines(schoolId), readQuiet(ctx.settings)) };
}

/** Deadlines (school leaders): staff deadlines by week as counts, heavy weeks and quiet weeks marked. */
export async function readDeadlinesAction(schoolId: string) {
  const ctx = await school(schoolId, true);
  if (!ctx) return DENIED;
  return { success: true as const, weeks: deadlineWeeks(await deadlines(schoolId), readQuiet(ctx.settings)) };
}
