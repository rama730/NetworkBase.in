"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { awardPicks, advance, demoDaySchema, feedbackSchema, readDemoDay, runOfShow, type DemoDay } from "@/lib/organizations/demo-day";
import { mentoringCtx, mentorsOf } from "@/lib/organizations/mentoring-server";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.6 C4 (plan B2.5b): demo day in the cohort. Everyone in the class sees the details, the Run of show and the
 * announced awards; staff set it up, run it (Next team, Skip) and announce; judges (class members the staff choose)
 * leave feedback per team and pick per award — never marks, totals or a leaderboard; a mentor never judges their own
 * mentees' team. Teams read the feedback on their own work.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function teams(classId: string) {
  return Array.from(await db.execute<{ id: string; title: string; slug: string | null }>(sql`
    SELECT w.id, coalesce(nullif(w.workflow_settings->'capstone'->'showcase'->>'title', ''), w.title) AS title, w.slug FROM workspaces w
    WHERE w.parent_id = ${classId}::uuid AND w.deleted_at IS NULL AND w.kind = 'workspace'
      AND EXISTS (SELECT 1 FROM workspace_workflows f WHERE f.workspace_id = w.id AND f.workflow = 'capstone' AND f.hidden_at IS NULL) ORDER BY w.title`));
}
async function day(classId: string) {
  const [r] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${classId}::uuid`));
  return readDemoDay(r?.settings);
}
async function save(classId: string, next: DemoDay) {
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('demoDay', ${JSON.stringify(next)}::jsonb) WHERE id = ${classId}::uuid`);
}
/** A judge acts with read access (outside judges join as Viewers); a token never judges. */
async function judgeCtx(classId: string) {
  const auth: { tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ tokenKind: "none" }));
  if (auth.tokenKind != null) return null;
  return mentoringCtx(classId);
}

/** Teams a judge may judge: not one with a member they mentor (call 9). */
async function judgeable(classId: string, judgeId: string, teamId: string) {
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${teamId}::uuid UNION SELECT owner_id FROM workspaces WHERE id = ${teamId}::uuid`));
  for (const m of members) if ((await mentorsOf(classId, m.id)).some((x) => x.id === judgeId)) return false;
  return true;
}

export async function readDemoDayAction(classId: string) {
  const ctx = await mentoringCtx(classId);
  if (!ctx) return DENIED;
  const d = await day(classId);
  const list = await teams(classId);
  const show = runOfShow(d, list);
  const announced = Object.entries(d.announced).flatMap(([award, teamId]) => { const t = list.find((x) => x.id === teamId); return t ? [{ award, team: t.title }] : []; });
  const isJudge = d.judges.includes(ctx.userId);
  const base = { success: true as const, staff: ctx.staff, isJudge, date: d.date, start: d.start, place: d.place, link: d.link, show, current: d.current, announced, awards: d.awards };
  let judging = null;
  if (isJudge) {
    const mine = Array.from(await db.execute<{ team_id: string; scores: Record<string, number | null>; note: string | null }>(sql`
      SELECT team_id, scores, note FROM demo_feedback WHERE workspace_id = ${classId}::uuid AND judge_id = ${ctx.userId}::uuid`));
    const picks = Array.from(await db.execute<{ award: string; team_id: string }>(sql`SELECT award, team_id FROM demo_picks WHERE workspace_id = ${classId}::uuid AND judge_id = ${ctx.userId}::uuid`));
    const rows = [];
    for (const t of show) {
      const f = mine.find((x) => x.team_id === t.id);
      rows.push({ id: t.id, title: t.title, own: !(await judgeable(classId, ctx.userId, t.id)), scores: f?.scores ?? {}, note: f?.note ?? "" });
    }
    judging = { teams: rows, picks: Object.fromEntries(picks.map((p) => [p.award, p.team_id])) };
  }
  let setup = null;
  if (ctx.staff) {
    const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
      SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
      WHERE m.workspace_id = ${classId}::uuid ORDER BY 2`));
    const picks = Array.from(await db.execute<{ award: string; teamId: string }>(sql`SELECT award, team_id AS "teamId" FROM demo_picks WHERE workspace_id = ${classId}::uuid`));
    setup = { judges: d.judges, people, pitch: d.pitch, questions: d.questions, picks: awardPicks(picks, d.awards).map((a) => ({ ...a, picks: a.picks.map((p) => ({ ...p, team: list.find((t) => t.id === p.teamId)?.title ?? "—" })) })) };
  }
  return { ...base, judging, setup };
}

const setupInput = demoDaySchema.pick({ date: true, start: true, place: true, link: true, pitch: true, questions: true, order: true, judges: true, awards: true }).partial().strict();

/** Staff set the day up: date, place, link, slot lengths, the order, judges (class members) and the awards. */
export async function saveDemoDayAction(classId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(classId, true);
  if (!ctx?.staff) return DENIED;
  const parsed = setupInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the demo day details." };
  if (parsed.data.judges?.length) {
    const members = new Set(Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${classId}::uuid`)).map((r) => r.id));
    if (parsed.data.judges.some((j) => !members.has(j))) return { success: false, error: "Judges join the class first (outside judges as Viewers)." };
  }
  await save(classId, { ...(await day(classId)), ...parsed.data });
  return { success: true };
}

/** Next team or Skip (staff, on the day). */
export async function advanceRunAction(classId: string): Promise<{ success: true; current: number } | Failure> {
  const ctx = await mentoringCtx(classId, true);
  if (!ctx?.staff) return DENIED;
  const d = await day(classId);
  const current = advance(d.current, runOfShow(d, await teams(classId)).length);
  await save(classId, { ...d, current });
  return { success: true, current };
}

/** A judge's feedback on one team (feedback, never a mark); not on a team they mentor. */
export async function saveFeedbackAction(classId: string, teamId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await judgeCtx(classId);
  if (!ctx || !isLooseUuid(teamId)) return DENIED;
  const d = await day(classId);
  if (!d.judges.includes(ctx.userId)) return DENIED;
  if (!(await teams(classId)).some((t) => t.id === teamId)) return { success: false, error: "Pick one of this demo day’s teams." };
  if (!(await judgeable(classId, ctx.userId, teamId))) return { success: false, error: "Mentors don’t judge their own teams." };
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Scores are 1 to 5." };
  await db.execute(sql`INSERT INTO demo_feedback (team_id, workspace_id, judge_id, scores, note) VALUES (${teamId}::uuid, ${classId}::uuid, ${ctx.userId}::uuid, ${JSON.stringify(parsed.data.scores)}::jsonb, ${parsed.data.note || null})
    ON CONFLICT (team_id, judge_id) DO UPDATE SET scores = excluded.scores, note = excluded.note, updated_at = now()`);
  return { success: true };
}

/** A judge picks a team per award (or clears it). */
export async function pickAwardAction(classId: string, award: string, teamId: string | null): Promise<{ success: true } | Failure> {
  const ctx = await judgeCtx(classId);
  if (!ctx) return DENIED;
  const d = await day(classId);
  if (!d.judges.includes(ctx.userId) || !d.awards.includes(award)) return DENIED;
  if (!teamId) { await db.execute(sql`DELETE FROM demo_picks WHERE workspace_id = ${classId}::uuid AND award = ${award} AND judge_id = ${ctx.userId}::uuid`); return { success: true }; }
  if (!isLooseUuid(teamId) || !(await teams(classId)).some((t) => t.id === teamId)) return { success: false, error: "Pick one of this demo day’s teams." };
  if (!(await judgeable(classId, ctx.userId, teamId))) return { success: false, error: "Mentors don’t judge their own teams." };
  await db.execute(sql`INSERT INTO demo_picks (workspace_id, award, judge_id, team_id) VALUES (${classId}::uuid, ${award}, ${ctx.userId}::uuid, ${teamId}::uuid)
    ON CONFLICT (workspace_id, award, judge_id) DO UPDATE SET team_id = excluded.team_id, created_at = now()`);
  return { success: true };
}

/** Staff announce an award's team (or take it back); it shows on the Showcase and to the class. */
export async function announceAwardAction(classId: string, award: string, teamId: string | null): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(classId, true);
  if (!ctx?.staff) return DENIED;
  const d = await day(classId);
  if (!d.awards.includes(award)) return DENIED;
  if (teamId && !(await teams(classId)).some((t) => t.id === teamId)) return { success: false, error: "Pick one of this demo day’s teams." };
  const announced = { ...d.announced };
  if (teamId) announced[award] = teamId; else delete announced[award];
  await save(classId, { ...d, announced });
  return { success: true };
}

/** A team reads the feedback on its own work (judges named as "A judge"; no totals). */
export async function readTeamFeedbackAction(teamId: string) {
  if (!isLooseUuid(teamId)) return DENIED;
  const auth: { user: { id: string } | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  if (!auth.user) return DENIED;
  const a = await getWorkspaceAccessById(teamId, auth.user.id);
  if (!a.canRead || !(a.isOwner || a.isMember)) return DENIED;
  const rows = Array.from(await db.execute<{ scores: Record<string, number | null>; note: string | null }>(sql`SELECT scores, note FROM demo_feedback WHERE team_id = ${teamId}::uuid ORDER BY updated_at`));
  return { success: true as const, feedback: rows.map((r) => ({ scores: r.scores, note: r.note })) };
}

