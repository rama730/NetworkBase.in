"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { DEFAULT_LEVELS, markTotal, readMarking, readRubric, readRubrics, type MarkDraft } from "@/lib/organizations/marks";
import { readSectionSettings } from "@/lib/organizations/sections";
import { needsAgreement, readExam, resultsHeld } from "@/lib/organizations/exams";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.8 W7 (plan B1.5a): marking. Staff who review a copy mark it (a TA only the copies routed to them when the
 * class says so, call 9); the mark is a hidden draft until Approve; Return keeps it hidden (call 5); the student sees
 * their own mark once it's visible; AI agents never set or change marks (call 8).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function viewer() {
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  // Security review: any token (agent, device or personal) only reads its own visible marks; writes and staff views
  // need a person signed in to the app (a cookie session has no token kind).
  return { userId: auth.user?.id ?? null, isAgent: auth.tokenKind != null };
}

type CopyRow = { copy_id: string; master_id: string; org_id: string; title: string; assignee_id: string | null; approved: boolean; settings: unknown; org_settings: unknown; excused: boolean };

async function loadCopy(copyId: string) {
  if (!isLooseUuid(copyId)) return null;
  const [row] = Array.from(await db.execute<CopyRow>(sql`
    SELECT c.id AS copy_id, m.id AS master_id, m.workspace_id AS org_id, m.title, c.assignee_id, (c.status = 'done' AND c.review_status = 'none' AND c.completion_source = 'review') AS approved, m.assignment_settings AS settings, w.org_settings,
      c.excused_at IS NOT NULL AS excused
    FROM tasks c JOIN tasks m ON m.id = c.assignment_id JOIN workspaces w ON w.id = m.workspace_id
    WHERE c.id = ${copyId}::uuid AND c.deleted_at IS NULL AND m.deleted_at IS NULL`));
  return row ?? null;
}

/** Staff who may mark this copy: the owner, or an admin (TA) the copy is routed to when "TAs work only with their section". */
async function canMark(copy: CopyRow, userId: string) {
  const a = await getWorkspaceAccessById(copy.org_id, userId);
  if (!a.canWrite || !(a.isOwner || a.memberRole === "admin")) return false;
  if (a.isOwner || !readSectionSettings(copy.org_settings).taOnlyOwn) return true;
  const { reviewsCopySql } = await import("@/lib/organizations/sections-server");
  const [row] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT ${reviewsCopySql(userId)} AS ok FROM tasks c JOIN tasks m ON m.id = c.assignment_id WHERE c.id = ${copy.copy_id}::uuid`));
  return Boolean(row?.ok);
}

async function isOwnCopy(copyId: string, userId: string) {
  const [row] = Array.from(await db.execute<{ mine: boolean }>(sql`
    SELECT (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid)) AS mine
    FROM tasks c WHERE c.id = ${copyId}::uuid`));
  return Boolean(row?.mine);
}

type Adjustment = { total: number; reason: string; by: string; at: string };
type MarkRow = { total: string; out_of: string; levels: Record<string, number>; comment: string | null; marker: string | null; marked_at: string; visible_at: string | null; adjustments: Record<string, Adjustment> | null;
  marker_id: string | null; second_total: string | null; second_marker: string | null; agreed_at: string | null };
async function readMark(copyId: string) {
  const [row] = Array.from(await db.execute<MarkRow>(sql`
    SELECT a.total::text, a.out_of::text, a.levels, a.comment, coalesce(p.full_name, p.username) AS marker, a.marked_at::text, a.visible_at::text, a.adjustments,
      a.marker_id, a.second_total::text, (SELECT coalesce(q.full_name, q.username) FROM profiles q WHERE q.id = a.second_marker_id) AS second_marker, a.agreed_at::text
    FROM assignment_marks a LEFT JOIN profiles p ON p.id = a.marker_id WHERE a.copy_id = ${copyId}::uuid`));
  return row ? { total: Number(row.total), outOf: Number(row.out_of), levels: row.levels ?? {}, comment: row.comment, marker: row.marker, markedAt: row.marked_at, visible: Boolean(row.visible_at),
    adjustments: row.adjustments ?? {}, markerId: row.marker_id,
    second: row.second_total == null ? null : { total: Number(row.second_total), marker: row.second_marker, agreed: Boolean(row.agreed_at) } } : null;
}

/** A team copy's people (B1.5b Adjust for one person); empty for a one-person copy. */
async function teamOf(copyId: string) {
  return Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT tm.user_id AS id, coalesce(p.full_name, p.username, 'Member') AS name FROM task_team_members tm JOIN profiles p ON p.id = tm.user_id
    WHERE tm.task_id = ${copyId}::uuid ORDER BY 2`));
}

/** The Marking panel (review queue): the assignment's marking, the draft or mark, and the class's comment bank. */
export async function readMarkingAction(copyId: string) {
  try {
    const { userId, isAgent } = await viewer();
    const copy = userId && !isAgent ? await loadCopy(copyId) : null;
    if (!copy || !userId || !(await canMark(copy, userId))) return DENIED;
    const bank = (copy.org_settings as { commentBank?: unknown } | null)?.commentBank;
    const [progress] = Array.from(await db.execute<{ marked: number; total: number }>(sql`
      SELECT (SELECT count(*)::int FROM assignment_marks WHERE master_id = ${copy.master_id}::uuid) AS marked,
        (SELECT count(*)::int FROM tasks WHERE assignment_id = ${copy.master_id}::uuid AND deleted_at IS NULL AND excused_at IS NULL) AS total`));
    const exam = readExam(copy.settings);
    const secondRole = exam?.secondMarker && (await inSecondSample(copy, exam.secondSample ?? "all")) ? (exam.secondMarker === userId ? "second" as const : "first" as const) : null;
    return { success: true as const, marking: readMarking(copy.settings), mark: await readMark(copyId), excused: copy.excused, progress: progress ?? { marked: 0, total: 0 }, team: await teamOf(copyId), secondRole,
      commentBank: Array.isArray(bank) ? (bank as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 40) : [] };
  } catch (error) {
    logger.warn("marks.read_failed", { copyId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the marking." };
  }
}

const draftInput = z.object({ levels: z.record(z.string(), z.number().int().min(0).max(5)).optional(), total: z.number().min(0).max(100_000).optional(), comment: z.string().trim().max(2000).nullable().optional() });

/** Save the mark as you click (a hidden draft until Approve). Agents are refused (call 8); each change is kept. */
export async function saveMarkAction(copyId: string, input: MarkDraft): Promise<{ success: true; total: number; outOf: number } | Failure> {
  const { userId, isAgent } = await viewer();
  if (isAgent) return { success: false, error: "AI agents can’t set or change marks; a person does." };
  const copy = userId ? await loadCopy(copyId) : null;
  if (!copy || !userId || !(await canMark(copy, userId))) return DENIED;
  if (copy.excused) return { success: false, error: "Excused work has no mark." };
  const exam = readExam(copy.settings);
  if (exam?.secondMarker === userId && (await inSecondSample(copy, exam.secondSample ?? "all"))) return { success: false, error: "You’re the second marker on this one: give the second mark." };
  const parsed = draftInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the mark." };
  const marking = readMarking(copy.settings);
  const result = markTotal(marking, parsed.data);
  if ("error" in result) return { success: false, error: result.error };
  await db.execute(sql`
    INSERT INTO assignment_marks (copy_id, master_id, workspace_id, total, out_of, levels, comment, marker_id, marked_at, visible_at)
    VALUES (${copyId}::uuid, ${copy.master_id}::uuid, ${copy.org_id}::uuid, ${result.total}, ${result.outOf}, ${JSON.stringify(parsed.data.levels ?? {})}::jsonb,
      ${parsed.data.comment ?? null}, ${userId}::uuid, now(), CASE WHEN ${copy.approved && !resultsHeld(readExam(copy.settings))} THEN now() ELSE NULL END)
    ON CONFLICT (copy_id) DO UPDATE SET total = EXCLUDED.total, out_of = EXCLUDED.out_of, levels = EXCLUDED.levels, comment = EXCLUDED.comment,
      marker_id = EXCLUDED.marker_id, marked_at = now(),
      history = assignment_marks.history || jsonb_build_array(jsonb_build_object('total', assignment_marks.total, 'by', assignment_marks.marker_id, 'at', assignment_marks.marked_at))`);
  return { success: true, total: result.total, outOf: result.outOf };
}

/** The student's own result (visible marks only); staff who review the copy see the draft too. */
export async function readMyMarkAction(copyId: string) {
  const { userId, isAgent } = await viewer();
  const copy = userId ? await loadCopy(copyId) : null;
  if (!copy || !userId) return DENIED;
  const staff = !isAgent && (await canMark(copy, userId));
  if (!staff && !(await isOwnCopy(copyId, userId))) return DENIED;
  const mark = await readMark(copyId);
  const marking = readMarking(copy.settings);
  if (!mark || (!staff && !mark.visible)) return { success: true as const, mark: null, marking: marking.mode === "none" ? null : marking };
  if (staff) return { success: true as const, mark, marking };
  const own = mark.adjustments[userId];
  return { success: true as const, mark: { ...mark, adjustments: {}, second: null, markerId: null, ...(own ? { total: own.total, adjustedReason: own.reason } : {}) }, marking };
}

/**
 * Adjust for one person (B1.5b, report 30.8 call: team copies): a team copy has one mark for every member; staff can
 * set a different total for one member, with a reason. A null total takes the adjustment away. Each change is kept.
 */
export async function adjustMarkAction(copyId: string, memberId: string, total: number | null, reason: string): Promise<{ success: true } | Failure> {
  const { userId, isAgent } = await viewer();
  if (isAgent) return { success: false, error: "AI agents can’t set or change marks; a person does." };
  const copy = userId && isLooseUuid(memberId) ? await loadCopy(copyId) : null;
  if (!copy || !userId || !(await canMark(copy, userId))) return DENIED;
  if (!(await teamOf(copyId)).some((m) => m.id === memberId)) return { success: false, error: "They aren’t on this team." };
  const mark = await readMark(copyId);
  if (!mark) return { success: false, error: "Mark the team first." };
  const why = String(reason ?? "").trim().slice(0, 200);
  if (total !== null && (!Number.isFinite(total) || total < 0 || total > mark.outOf)) return { success: false, error: `Give a mark from 0 to ${mark.outOf}.` };
  if (total !== null && !why) return { success: false, error: "Say why this person’s mark is different." };
  const entry = total === null ? null : { total: Math.round(total * 100) / 100, reason: why, by: userId, at: new Date().toISOString() };
  await db.execute(sql`
    UPDATE assignment_marks SET adjustments = ${entry ? sql`adjustments || jsonb_build_object(${memberId}::text, ${JSON.stringify(entry)}::jsonb)` : sql`adjustments - ${memberId}::text`},
      history = history || jsonb_build_array(jsonb_build_object('adjusted', ${memberId}::text, 'total', ${entry?.total ?? null}::numeric, 'by', ${userId}::uuid, 'at', now()))
    WHERE copy_id = ${copyId}::uuid`);
  return { success: true };
}

/** B1.6c: every copy, or a 10% sample (at least one) picked the same way each time. */
async function inSecondSample(copy: CopyRow, sample: "all" | "sample") {
  if (sample === "all") return true;
  const [row] = Array.from(await db.execute<{ ok: boolean }>(sql`
    SELECT ${copy.copy_id}::uuid IN (SELECT id FROM tasks WHERE assignment_id = ${copy.master_id}::uuid AND deleted_at IS NULL AND excused_at IS NULL
      ORDER BY md5(id::text) LIMIT greatest(1, ceil((SELECT count(*) FROM tasks WHERE assignment_id = ${copy.master_id}::uuid AND deleted_at IS NULL AND excused_at IS NULL) * 0.1))) AS ok`));
  return Boolean(row?.ok);
}

/**
 * Second marking (B1.6c, report 30.5 layer 5): the second marker gives their own total on a sampled copy after the
 * first mark; more than 10% apart needs agreement, and both markers are told (Normal).
 */
export async function saveSecondMarkAction(copyId: string, total: number): Promise<{ success: true; needsAgreement: boolean } | Failure> {
  const { userId, isAgent } = await viewer();
  if (isAgent) return { success: false, error: "AI agents can’t set or change marks; a person does." };
  const copy = userId ? await loadCopy(copyId) : null;
  if (!copy || !userId || !(await canMark(copy, userId))) return DENIED;
  const exam = readExam(copy.settings);
  if (exam?.secondMarker !== userId || !(await inSecondSample(copy, exam.secondSample ?? "all"))) return DENIED;
  const mark = await readMark(copyId);
  if (!mark) return { success: false, error: "The first mark comes first." };
  if (!Number.isFinite(total) || total < 0 || total > mark.outOf) return { success: false, error: `Give a mark from 0 to ${mark.outOf}.` };
  const second = Math.round(total * 100) / 100;
  await db.execute(sql`UPDATE assignment_marks SET second_total = ${second}, second_marker_id = ${userId}::uuid, second_at = now(), agreed_at = NULL WHERE copy_id = ${copyId}::uuid`);
  const disagree = needsAgreement(mark.total, second, mark.outOf);
  if (disagree && mark.markerId) {
    const { notifyOrg, orgHref } = await import("@/lib/organizations/notify");
    await notifyOrg({ orgId: copy.org_id, eventKey: "assignments.marks_agreement", actorId: userId, to: [mark.markerId, userId], title: `${copy.title}: marks need agreement`,
      href: orgHref({ slug: null, id: copy.org_id }, `?tab=tasks&taskScope=review&assignment=${copy.master_id}&review=${copyId}`), sourceEventId: `${copyId}:agreement:${second}`, refs: { taskId: copyId } }).catch(() => undefined);
  }
  return { success: true, needsAgreement: disagree };
}

/** Agree on one final mark (either marker); it becomes the mark and Needs agreement clears. */
export async function agreeMarkAction(copyId: string, total: number): Promise<{ success: true } | Failure> {
  const { userId, isAgent } = await viewer();
  if (isAgent) return { success: false, error: "AI agents can’t set or change marks; a person does." };
  const copy = userId ? await loadCopy(copyId) : null;
  if (!copy || !userId || !(await canMark(copy, userId))) return DENIED;
  const mark = await readMark(copyId);
  if (!mark?.second) return { success: false, error: "There’s no second mark to agree on." };
  if (userId !== mark.markerId && userId !== readExam(copy.settings)?.secondMarker) return { success: false, error: "Only the two markers agree the mark." };
  if (!Number.isFinite(total) || total < 0 || total > mark.outOf) return { success: false, error: `Give a mark from 0 to ${mark.outOf}.` };
  await db.execute(sql`
    UPDATE assignment_marks SET total = ${Math.round(total * 100) / 100}, agreed_at = now(),
      history = history || jsonb_build_array(jsonb_build_object('total', total, 'second', second_total, 'agreed', ${total}::numeric, 'by', ${userId}::uuid, 'at', now()))
    WHERE copy_id = ${copyId}::uuid`);
  return { success: true };
}

/** Settings → Marking (the Teacher): rubrics (new, edit, archive) and the comment bank. */
export async function saveRubricAction(orgId: string, input: { id?: string; name: string; criteria: Array<{ id?: string; name: string; levels?: Array<{ label: string; points: number; text?: string }> }> }): Promise<{ success: true; id: string } | Failure> {
  const { userId, isAgent } = await viewer();
  if (!userId || isAgent || !isLooseUuid(orgId)) return DENIED;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!a.isOwner || !a.canWrite) return DENIED;
  const { randomUUID } = await import("node:crypto");
  const rubric = readRubric({ id: input.id && isLooseUuid(input.id) ? input.id : randomUUID(), name: String(input.name ?? "").trim() || "Rubric",
    criteria: (input.criteria ?? []).map((c) => ({ id: c.id || randomUUID(), name: String(c.name ?? "").trim(), levels: c.levels?.length ? c.levels : DEFAULT_LEVELS })).filter((c) => c.name) });
  if (!rubric) return { success: false, error: "Add at least one criterion with a name." };
  const [row] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid`));
  const list = readRubrics(row?.settings);
  const next = list.some((r) => r.id === rubric.id) ? list.map((r) => (r.id === rubric.id ? rubric : r)) : [...list, rubric];
  if (next.length > 50) return { success: false, error: "Up to 50 rubrics." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || ${JSON.stringify({ rubrics: next })}::jsonb WHERE id = ${orgId}::uuid`);
  return { success: true, id: rubric.id };
}

export async function archiveRubricAction(orgId: string, rubricId: string, archived: boolean): Promise<{ success: true } | Failure> {
  const { userId, isAgent } = await viewer();
  if (!userId || isAgent || !isLooseUuid(orgId)) return DENIED;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!a.isOwner || !a.canWrite) return DENIED;
  const [row] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid`));
  const next = readRubrics(row?.settings).map((r) => (r.id === rubricId ? { ...r, archived } : r));
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || ${JSON.stringify({ rubrics: next })}::jsonb WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** The class's rubrics and comment bank (staff). */
export async function readMarkingSettingsAction(orgId: string) {
  const { userId, isAgent } = await viewer();
  if (!userId || isAgent || !isLooseUuid(orgId)) return DENIED;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!(a.isOwner || a.memberRole === "admin")) return DENIED;
  const [row] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid`));
  const bank = (row?.settings as { commentBank?: unknown } | null)?.commentBank;
  const commentBank = Array.isArray(bank) ? (bank as unknown[]).filter((x): x is string => typeof x === "string") : [];
  // B1.5b (report 30.8 layer 2): an empty comment bank is seeded from your recent return reasons in this class.
  const suggested = commentBank.length ? [] : Array.from(await db.execute<{ reason: string }>(sql`
    SELECT reason FROM (SELECT DISTINCT ON (e.payload->>'reason') e.payload->>'reason' AS reason, e.created_at FROM task_activity_events e
      WHERE e.actor_id = ${userId}::uuid AND e.workspace_id = ${orgId}::uuid AND e.event_type = 'changes_requested' AND coalesce(e.payload->>'reason', '') <> ''
      ORDER BY e.payload->>'reason', e.created_at DESC) r ORDER BY created_at DESC LIMIT 10`)).map((r) => r.reason.slice(0, 200));
  return { success: true as const, teacher: a.isOwner, rubrics: readRubrics(row?.settings), commentBank, suggested };
}

export async function saveCommentBankAction(orgId: string, lines: string[]): Promise<{ success: true } | Failure> {
  const { userId, isAgent } = await viewer();
  if (!userId || isAgent || !isLooseUuid(orgId)) return DENIED;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!(a.isOwner || a.memberRole === "admin") || !a.canWrite) return DENIED;
  const clean = [...new Set((Array.isArray(lines) ? lines : []).map((l) => String(l).trim().slice(0, 200)).filter(Boolean))].slice(0, 40);
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || ${JSON.stringify({ commentBank: clean })}::jsonb WHERE id = ${orgId}::uuid`);
  return { success: true };
}
