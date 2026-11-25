"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readExam, resultsHeld } from "@/lib/organizations/exams";
import { mentoringCtx } from "@/lib/organizations/mentoring-server";
import { bands, daysToGo, overallScore, readScoreLayout, scoreLayoutSchema, sectionScore, seriesSummary, type ScoreLayout } from "@/lib/organizations/mocks";
import { todayInZone } from "@/lib/organizations/zoned-time";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.4 C3 (plan B2.4a): mock series. Staff give an Exam a Score layout and enter marks once; each learner sees
 * only their own (and only once results are released when held), as Latest, Best, the gap to their target and a
 * trend — never an average, rank or anyone else's score; staff see the spread in bands. Tokens never set marks.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const classCtx = mentoringCtx;

type Mock = { id: string; title: string; opens: string | null; layout: ScoreLayout; held: boolean };

/** The class's mocks: Exam assignments with a Score layout, oldest first. */
async function mocks(orgId: string): Promise<Mock[]> {
  const rows = Array.from(await db.execute<{ id: string; title: string; settings: { exam?: unknown } | null }>(sql`
    SELECT id, title, assignment_settings AS settings FROM tasks
    WHERE workspace_id = ${orgId}::uuid AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL AND assignment_settings->'exam'->'scoreLayout' IS NOT NULL`));
  return rows.flatMap((r) => {
    const exam = readExam(r.settings);
    const layout = readScoreLayout(r.settings?.exam);
    return exam && layout ? [{ id: r.id, title: r.title, opens: exam.opensAt ?? null, layout, held: resultsHeld(exam) }] : [];
  }).sort((a, b) => (a.opens ?? "").localeCompare(b.opens ?? ""));
}

/** Give one of the class's Exams its Score layout (staff). */
export async function saveScoreLayoutAction(orgId: string, masterId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx?.staff || !isLooseUuid(masterId)) return DENIED;
  const parsed = scoreLayoutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Name the series and give every section a name and a maximum." };
  const keys = parsed.data.sections.map((s) => s.key);
  if (new Set(keys).size !== keys.length) return { success: false, error: "Each section needs its own key." };
  const done = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE tasks SET assignment_settings = jsonb_set(assignment_settings, '{exam,scoreLayout}', ${JSON.stringify(parsed.data)}::jsonb), updated_at = now()
    WHERE id = ${masterId}::uuid AND workspace_id = ${orgId}::uuid AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL AND assignment_settings ? 'exam'
    RETURNING id`));
  return done.length ? { success: true } : { success: false, error: "Pick one of this class’s exams." };
}

const marksInput = z.array(z.object({ userId: z.string().uuid(), raws: z.record(z.string(), z.number().min(0).nullable()) }).strict()).min(1).max(2000);

/** Enter marks for one mock (staff, never a token): each section's raw mark, at most its maximum. */
export async function saveMockMarksAction(orgId: string, masterId: string, input: unknown): Promise<{ success: true; saved: number } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx?.staff || !isLooseUuid(masterId)) return DENIED;
  const mock = (await mocks(orgId)).find((m) => m.id === masterId);
  if (!mock) return { success: false, error: "Give this exam a Score layout first." };
  const parsed = marksInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the marks." };
  const learners = new Set(Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role = 'member'`)).map((r) => r.id));
  for (const row of parsed.data) {
    if (!learners.has(row.userId)) return { success: false, error: "Only the class’s learners have marks." };
    for (const [k, v] of Object.entries(row.raws)) {
      const s = mock.layout.sections.find((x) => x.key === k);
      if (!s) return { success: false, error: "A mark is for a section this mock doesn’t have." };
      if (v != null && v > s.max) return { success: false, error: `${s.name} is out of ${s.max}.` };
    }
  }
  await db.transaction(async (tx) => {
    for (const row of parsed.data) {
      await tx.execute(sql`INSERT INTO mock_scores (master_id, workspace_id, user_id, raws, entered_by) VALUES (${masterId}::uuid, ${orgId}::uuid, ${row.userId}::uuid, ${JSON.stringify(row.raws)}::jsonb, ${ctx.userId}::uuid)
        ON CONFLICT (master_id, user_id) DO UPDATE SET raws = mock_scores.raws || excluded.raws, entered_by = excluded.entered_by, entered_at = now()`);
    }
  });
  return { success: true, saved: parsed.data.length };
}

const cutsFor = (layout: ScoreLayout) => {
  const max = layout.overall === "sum" ? layout.sections.reduce((n, s) => n + s.max, 0) : Math.max(...layout.sections.map((s) => s.conversion?.length ? Math.max(...s.conversion.map((c) => c[1])) : s.max));
  return [Math.round(max * 0.75 * 2) / 2, Math.round(max * 0.6 * 2) / 2];
};

/** Staff: one series — learners × mocks (overall), their exam and target, sections below target, and bands. */
export async function readScoresAction(orgId: string, series?: string | null) {
  try {
    const ctx = await classCtx(orgId);
    if (!ctx?.staff) return DENIED;
    const all = await mocks(orgId);
    const names = [...new Set(all.map((m) => m.layout.series))];
    const pick = series && names.includes(series) ? series : names[0] ?? null;
    const list = all.filter((m) => m.layout.series === pick);
    const people = Array.from(await db.execute<{ id: string; name: string; exam_date: string | null; targets: Record<string, number> | null }>(sql`
      SELECT m.user_id AS id, coalesce(p.full_name, p.username, 'Learner') AS name, pp.exam_date::text AS exam_date, pp.targets
      FROM workspace_members m JOIN profiles p ON p.id = m.user_id LEFT JOIN prep_profiles pp ON pp.workspace_id = m.workspace_id AND pp.user_id = m.user_id
      WHERE m.workspace_id = ${orgId}::uuid AND m.role = 'member' ORDER BY 2`));
    const scores = list.length ? Array.from(await db.execute<{ master_id: string; user_id: string; raws: Record<string, number | null> }>(sql`
      SELECT master_id, user_id, raws FROM mock_scores WHERE workspace_id = ${orgId}::uuid AND master_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(list.map((m) => m.id))}::jsonb)::uuid)`)) : [];
    const raw = (masterId: string, userId: string) => scores.find((s) => s.master_id === masterId && s.user_id === userId)?.raws ?? null;
    const latest = list[list.length - 1] ?? null;
    // Exams not yet set up as mocks, for Set up a mock.
    const exams = Array.from(await db.execute<{ id: string; title: string }>(sql`
      SELECT id, title FROM tasks WHERE workspace_id = ${orgId}::uuid AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL
        AND assignment_settings ? 'exam' AND assignment_settings->'exam'->'scoreLayout' IS NULL ORDER BY created_at DESC LIMIT 50`));
    return { success: true as const, series: names, picked: pick, exams, mocks: list.map((m) => ({ id: m.id, title: m.title, held: m.held })),
      layout: latest?.layout ?? null,
      learners: people.map((p) => {
        const overall = list.map((m) => { const r = raw(m.id, p.id); return r ? overallScore(m.layout, r) : null; });
        const lr = latest ? raw(latest.id, p.id) : null;
        const below = latest && lr && p.targets ? latest.layout.sections.filter((s) => { const v = sectionScore(lr[s.key], s); const t = p.targets?.[s.key]; return v != null && t != null && v < t; }).map((s) => s.name) : [];
        return { id: p.id, name: p.name, examDate: p.exam_date, target: p.targets?.overall ?? null, overall, below, missing: overall.filter((v) => v == null).length };
      }),
      bands: latest ? bands(people.map((p) => { const r = raw(latest.id, p.id); return r ? overallScore(latest.layout, r) : null; }), cutsFor(latest.layout)) : [] };
  } catch (error) {
    logger.warn("mocks.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the scores." };
  }
}

/** Staff: one mock's marks to enter (the learners, the layout, what's saved). */
export async function readMockMarksAction(orgId: string, masterId: string) {
  const ctx = await classCtx(orgId);
  if (!ctx?.staff || !isLooseUuid(masterId)) return DENIED;
  const mock = (await mocks(orgId)).find((m) => m.id === masterId);
  if (!mock) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; name: string; raws: Record<string, number | null> | null }>(sql`
    SELECT m.user_id AS id, coalesce(p.full_name, p.username, 'Learner') AS name, s.raws FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    LEFT JOIN mock_scores s ON s.master_id = ${masterId}::uuid AND s.user_id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role = 'member' ORDER BY 2`));
  return { success: true as const, title: mock.title, layout: mock.layout, held: mock.held, learners: rows.map((r) => ({ id: r.id, name: r.name, raws: r.raws ?? {} })) };
}

/** My prep (a learner): my exam and targets, and each series' sections as Latest, Best and the gap; released marks only. */
export async function readMyPrepAction(orgId: string) {
  try {
    const ctx = await classCtx(orgId);
    if (!ctx?.learner) return DENIED;
    const [profile] = Array.from(await db.execute<{ exam_name: string | null; exam_date: string | null; targets: Record<string, number> | null; suggested: Record<string, number> | null }>(sql`
      SELECT exam_name, exam_date::text AS exam_date, targets, suggested FROM prep_profiles WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`));
    const targets = profile?.targets ?? {};
    const visible = (await mocks(orgId)).filter((m) => !m.held);
    const mine = visible.length ? Array.from(await db.execute<{ master_id: string; raws: Record<string, number | null> }>(sql`
      SELECT master_id, raws FROM mock_scores WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`)) : [];
    const raw = (id: string) => mine.find((s) => s.master_id === id)?.raws ?? null;
    const series = [...new Set(visible.map((m) => m.layout.series))].map((name) => {
      const list = visible.filter((m) => m.layout.series === name);
      const layout = list[list.length - 1]!.layout;
      return { name, mocks: list.map((m) => m.title),
        sections: layout.sections.map((s) => {
          const values = list.map((m) => { const r = raw(m.id); const sec = m.layout.sections.find((x) => x.key === s.key); return r && sec ? sectionScore(r[s.key], sec) : null; });
          return { key: s.key, name: s.name, target: targets[s.key] ?? null, values, ...seriesSummary(values, targets[s.key] ?? null) };
        }),
        overall: layout.overall === "none" ? null : (() => { const values = list.map((m) => { const r = raw(m.id); return r ? overallScore(m.layout, r) : null; }); return { target: targets.overall ?? null, values, ...seriesSummary(values, targets.overall ?? null) }; })() };
    });
    return { success: true as const, exam: { name: profile?.exam_name ?? null, date: profile?.exam_date ?? null, daysToGo: daysToGo(profile?.exam_date ?? null, todayInZone(ctx.zone)) },
      targets, suggested: profile?.suggested ?? null, series };
  } catch (error) {
    logger.warn("mocks.my_prep_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load your prep." };
  }
}

const prepInput = z.object({ examName: z.string().trim().max(80).nullable().optional(), examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  targets: z.record(z.string().max(24), z.number().min(0).max(10000)).optional() }).strict();

/** My exam, its date and my targets (the learner's own; call 6–7). */
export async function saveMyPrepAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx?.learner) return DENIED;
  const parsed = prepInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check your exam and targets." };
  const d = parsed.data;
  await db.execute(sql`INSERT INTO prep_profiles (workspace_id, user_id, exam_name, exam_date, targets) VALUES (${orgId}::uuid, ${ctx.userId}::uuid, ${d.examName ?? null}, ${d.examDate ?? null}::date, ${JSON.stringify(d.targets ?? {})}::jsonb)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET exam_name = ${d.examName === undefined ? sql`prep_profiles.exam_name` : sql`${d.examName}`},
      exam_date = ${d.examDate === undefined ? sql`prep_profiles.exam_date` : sql`${d.examDate}::date`},
      targets = ${d.targets === undefined ? sql`prep_profiles.targets` : sql`${JSON.stringify(d.targets)}::jsonb`}, updated_at = now()`);
  return { success: true };
}

/** Staff suggest targets; the learner decides (call 6). */
export async function suggestTargetsAction(orgId: string, userId: string, targets: Record<string, number>): Promise<{ success: true } | Failure> {
  const ctx = await classCtx(orgId, true);
  if (!ctx?.staff || !isLooseUuid(userId)) return DENIED;
  const parsed = z.record(z.string().max(24), z.number().min(0).max(10000)).safeParse(targets);
  if (!parsed.success) return { success: false, error: "Check the targets." };
  const [m] = Array.from(await db.execute<{ ok: number }>(sql`SELECT 1 AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role = 'member'`));
  if (!m) return DENIED;
  await db.execute(sql`INSERT INTO prep_profiles (workspace_id, user_id, suggested) VALUES (${orgId}::uuid, ${userId}::uuid, ${JSON.stringify(parsed.data)}::jsonb)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET suggested = excluded.suggested, updated_at = now()`);
  return { success: true };
}
