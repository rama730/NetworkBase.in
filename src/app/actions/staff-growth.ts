"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.6 S5 calls 3–5, 8 (plan B3.5a–b): Settings → Staff growth (Reports to, the review headings) and each
 * person's growth record — up to 3 goals a year, the year review (self-reflection, then the line manager's part,
 * then a development plan; no ratings, scores or pay) and the development log. A record is read by the person and
 * their line manager only; the school's leaders see counts. Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
export type GrowthKind = "goal" | "review" | "log";

async function school(schoolId: string, write = false) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id;
  if (!userId || auth.tokenKind != null) return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown }>(sql`SELECT org_level AS level, org_settings AS settings FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canRead || !(a.isOwner || (a.isMember && a.memberRole !== "viewer")) || (write && !a.canWrite)) return null;
  return { userId, leader: a.isOwner || a.memberRole === "admin", settings: w.settings };
}

export const DEFAULT_REVIEW_HEADINGS = ["Teaching and learning", "Working with colleagues", "Professional growth"];
const growthOf = (settings: unknown) => {
  const g = ((settings as { staffGrowth?: Record<string, unknown> } | null)?.staffGrowth ?? {}) as Record<string, unknown>;
  const reportsTo = (g.reportsTo && typeof g.reportsTo === "object" ? g.reportsTo : {}) as Record<string, string>;
  const headings = Array.isArray(g.headings) && g.headings.length ? (g.headings as string[]) : DEFAULT_REVIEW_HEADINGS;
  return { reportsTo, headings };
};

async function staff(schoolId: string) {
  return Array.from(await db.execute<{ id: string; name: string | null }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username) AS name FROM profiles p
    WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${schoolId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND role <> 'viewer') ORDER BY 2`))
    .map((s) => ({ id: s.id, name: s.name ?? "Staff" }));
}

/** Settings → Staff growth (leaders): Reports to for each person, and the review headings. */
export async function readStaffGrowthSettingsAction(schoolId: string) {
  const ctx = await school(schoolId);
  if (!ctx?.leader) return DENIED;
  return { success: true as const, ...growthOf(ctx.settings), staff: await staff(schoolId) };
}

const settingsSchema = z.object({ reportsTo: z.record(z.string().uuid(), z.string().uuid()), headings: z.array(z.string().trim().min(1).max(60)).min(1, "Keep at least one heading.").max(8) }).strict();
export async function saveStaffGrowthSettingsAction(schoolId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx?.leader) return DENIED;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the staff growth settings." };
  const ids = new Set((await staff(schoolId)).map((s) => s.id));
  if (Object.entries(parsed.data.reportsTo).some(([who, manager]) => !ids.has(who) || !ids.has(manager) || who === manager)) return { success: false, error: "Reports to is someone else on the staff." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('staffGrowth', ${JSON.stringify(parsed.data)}::jsonb) WHERE id = ${schoolId}::uuid`);
  return { success: true };
}

/** Who may read `person`'s record: the person and their line manager. */
const canSee = (ctx: { userId: string; settings: unknown }, person: string) => person === ctx.userId || growthOf(ctx.settings).reportsTo[person] === ctx.userId;

/** My growth (or, for a line manager, a person who reports to me): goals, the year review, the development log. */
export async function readGrowthAction(schoolId: string, person: string | null, year: string) {
  const ctx = await school(schoolId);
  const who = person ?? ctx?.userId ?? "";
  if (!ctx || !isLooseUuid(who) || !/^\d{4}$/.test(year) || !canSee(ctx, who)) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; kind: GrowthKind; title: string; body: Record<string, string> | null; created_at: string; by: string | null }>(sql`
    SELECT g.id, g.kind, g.title, g.body, g.created_at::text, coalesce(p.full_name, p.username) AS by FROM staff_growth g LEFT JOIN profiles p ON p.id = g.created_by
    WHERE g.workspace_id = ${schoolId}::uuid AND g.user_id = ${who}::uuid AND g.year = ${year} ORDER BY g.kind, g.created_at`));
  const { reportsTo, headings } = growthOf(ctx.settings);
  const reports = Object.entries(reportsTo).filter(([, m]) => m === ctx.userId).map(([p]) => p);
  const names = new Map((await staff(schoolId)).map((s) => [s.id, s.name]));
  return { success: true as const, person: who, personName: names.get(who) ?? "Staff", mine: who === ctx.userId, headings,
    manager: reportsTo[who] ? names.get(reportsTo[who]!) ?? null : null, myReports: reports.map((p) => ({ id: p, name: names.get(p) ?? "Staff" })),
    goals: rows.filter((r) => r.kind === "goal"), review: rows.find((r) => r.kind === "review") ?? null, log: rows.filter((r) => r.kind === "log") };
}

const entrySchema = z.object({ kind: z.enum(["goal", "review", "log"]), year: z.string().regex(/^\d{4}$/), title: z.string().trim().min(1, "Give it a title.").max(200),
  body: z.record(z.string().max(60), z.string().max(5000)).default({}) }).strict();

/**
 * Add a goal or log entry, or write the year review. The person writes their own goals, log and self-reflection;
 * the line manager writes the manager's part of the review (and can add to the log). No ratings or scores: only words.
 */
export async function saveGrowthAction(schoolId: string, person: string | null, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  const who = person ?? ctx?.userId ?? "";
  if (!ctx || !isLooseUuid(who) || !canSee(ctx, who)) return DENIED;
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the entry." };
  const e = parsed.data;
  const self = who === ctx.userId;
  if (e.kind === "goal") {
    if (!self) return { success: false, error: "Goals are the person’s own." };
    const [{ n } = { n: 0 }] = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM staff_growth WHERE workspace_id = ${schoolId}::uuid AND user_id = ${who}::uuid AND year = ${e.year} AND kind = 'goal'`));
    if (Number(n) >= 3) return { success: false, error: "Up to 3 goals a year." };
  }
  if (e.kind === "review") {
    // Self-reflection and the development plan are the person's; the manager's part is the line manager's.
    const allowed = self ? ["reflection", "plan"] : ["manager"];
    if (Object.keys(e.body).some((k) => !allowed.includes(k))) return { success: false, error: self ? "Your line manager writes their part." : "The person writes their own reflection and plan." };
    await db.execute(sql`INSERT INTO staff_growth (workspace_id, user_id, kind, year, title, body, created_by) VALUES (${schoolId}::uuid, ${who}::uuid, 'review', ${e.year}, ${e.title}, ${JSON.stringify(e.body)}::jsonb, ${ctx.userId}::uuid)
      ON CONFLICT (workspace_id, user_id, year) WHERE kind = 'review' DO UPDATE SET body = staff_growth.body || EXCLUDED.body, updated_at = now()`);
    return { success: true };
  }
  await db.execute(sql`INSERT INTO staff_growth (workspace_id, user_id, kind, year, title, body, created_by) VALUES (${schoolId}::uuid, ${who}::uuid, ${e.kind}, ${e.year}, ${e.title}, ${JSON.stringify(e.body)}::jsonb, ${ctx.userId}::uuid)`);
  return { success: true };
}

/** Leaders see counts only (call 8): people with goals, reviews written, log entries — never what's in them. */
export async function readGrowthCountsAction(schoolId: string, year: string) {
  const ctx = await school(schoolId);
  if (!ctx?.leader || !/^\d{4}$/.test(year)) return DENIED;
  const [c] = Array.from(await db.execute<{ with_goals: number; reviews: number; logs: number }>(sql`
    SELECT count(DISTINCT user_id) FILTER (WHERE kind = 'goal')::int AS with_goals, count(*) FILTER (WHERE kind = 'review')::int AS reviews, count(*) FILTER (WHERE kind = 'log')::int AS logs
    FROM staff_growth WHERE workspace_id = ${schoolId}::uuid AND year = ${year}`));
  return { success: true as const, staff: (await staff(schoolId)).length, withGoals: Number(c?.with_goals ?? 0), reviews: Number(c?.reviews ?? 0), logs: Number(c?.logs ?? 0) };
}
