"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { readMarking, type Rubric } from "@/lib/organizations/marks";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.8 call (plan B1.5c): peer review. On a rubric-marked assignment with text or link hand-ins, each student
 * who has handed in reviews 2 other hand-ins with the same rubric. Names are hidden both ways ("Hand-in A",
 * "Reviewer 1"); it's feedback, not marks. A person signed in to the app does it, never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const PEERS = 2;

async function person() {
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  return auth.tokenKind != null ? null : auth.user?.id ?? null;
}

type Own = { copy_id: string; master_id: string; org_id: string; settings: unknown; handed_in: boolean; excused: boolean; submission_type: string | null };
/** The viewer's own copy (assignee or teammate) and its assignment. */
async function ownCopy(copyId: string, userId: string) {
  if (!isLooseUuid(copyId)) return null;
  const [row] = Array.from(await db.execute<Own>(sql`
    SELECT c.id AS copy_id, m.id AS master_id, m.workspace_id AS org_id, m.assignment_settings AS settings, c.submission IS NOT NULL AS handed_in, c.excused_at IS NOT NULL AS excused,
      m.assignment_settings->>'submissionType' AS submission_type
    FROM tasks c JOIN tasks m ON m.id = c.assignment_id
    WHERE c.id = ${copyId}::uuid AND c.deleted_at IS NULL AND m.deleted_at IS NULL
      AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid))`));
  if (!row) return null;
  const access = await getWorkspaceAccessById(row.org_id, userId);
  return access.canRead ? row : null;
}

/** Peer review is on for an assignment marked with a rubric whose hand-ins are text or a link (files stay private). */
function peerRubric(own: Own): Rubric | null {
  const on = (own.settings as { peerReview?: unknown } | null)?.peerReview === true;
  const marking = readMarking(own.settings);
  return on && marking.mode === "rubric" && (own.submission_type === "text" || own.submission_type === "link") ? marking.rubric : null;
}

/** Your peer reviews to do, and the feedback others left on your hand-in (no names either way). */
export async function readPeerReviewAction(copyId: string) {
  const userId = await person();
  const own = userId ? await ownCopy(copyId, userId) : null;
  if (!own || !userId) return DENIED;
  const rubric = peerRubric(own);
  if (!rubric) return { success: true as const, on: false as const };
  const todo = Array.from(await db.execute<{ id: string; text: string | null; link: string | null; levels: Record<string, number>; comment: string | null; submitted: boolean }>(sql`
    SELECT r.id, c.submission->>'text' AS text, c.submission->>'link' AS link, r.levels, r.comment, r.submitted_at IS NOT NULL AS submitted
    FROM peer_reviews r JOIN tasks c ON c.id = r.copy_id
    WHERE r.master_id = ${own.master_id}::uuid AND r.reviewer_id = ${userId}::uuid ORDER BY r.created_at, r.id`));
  const feedback = Array.from(await db.execute<{ levels: Record<string, number>; comment: string | null }>(sql`
    SELECT levels, comment FROM peer_reviews WHERE copy_id = ${own.copy_id}::uuid AND submitted_at IS NOT NULL ORDER BY submitted_at, id`));
  return { success: true as const, on: true as const, rubric, handedIn: own.handed_in && !own.excused, peers: PEERS,
    todo: todo.map((t, i) => ({ id: t.id, label: `Hand-in ${String.fromCharCode(65 + i)}`, text: t.text, link: t.link, levels: t.levels ?? {}, comment: t.comment, submitted: t.submitted })),
    feedback: feedback.map((f, i) => ({ label: `Reviewer ${i + 1}`, levels: f.levels ?? {}, comment: f.comment })) };
}

/**
 * Start: draw up to 2 other hand-ins of the same assignment (never your own or your team's, not excused), the ones
 * with the fewest reviews first. Once per person per assignment (an advisory lock keeps two clicks from drawing 4).
 */
export async function startPeerReviewsAction(copyId: string): Promise<{ success: true; drawn: number } | Failure> {
  const userId = await person();
  const own = userId ? await ownCopy(copyId, userId) : null;
  if (!own || !userId || !peerRubric(own)) return DENIED;
  if (!own.handed_in || own.excused) return { success: false, error: "Hand in your own work first." };
  const drawn = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`peer:${own.master_id}:${userId}`}))`);
    const [have] = Array.from(await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM peer_reviews WHERE master_id = ${own.master_id}::uuid AND reviewer_id = ${userId}::uuid`));
    const want = PEERS - (have?.n ?? 0);
    if (want <= 0) return 0;
    const rows = Array.from(await tx.execute<{ id: string }>(sql`
      INSERT INTO peer_reviews (master_id, copy_id, reviewer_id, workspace_id)
      SELECT ${own.master_id}::uuid, c.id, ${userId}::uuid, ${own.org_id}::uuid FROM tasks c
      WHERE c.assignment_id = ${own.master_id}::uuid AND c.deleted_at IS NULL AND c.excused_at IS NULL AND c.submission IS NOT NULL
        AND c.assignee_id IS DISTINCT FROM ${userId}::uuid
        AND NOT EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM peer_reviews r WHERE r.copy_id = c.id AND r.reviewer_id = ${userId}::uuid)
      ORDER BY (SELECT count(*) FROM peer_reviews r WHERE r.copy_id = c.id), random() LIMIT ${want}
      ON CONFLICT (copy_id, reviewer_id) DO NOTHING RETURNING id`));
    return rows.length;
  });
  return drawn || (await hasAny(own.master_id, userId)) ? { success: true, drawn } : { success: false, error: "No other hand-ins yet. Try again later." };
}

async function hasAny(masterId: string, userId: string) {
  const [row] = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM peer_reviews WHERE master_id = ${masterId}::uuid AND reviewer_id = ${userId}::uuid`));
  return (row?.n ?? 0) > 0;
}

const input = z.object({ levels: z.record(z.string(), z.number().int().min(0).max(5)), comment: z.string().trim().max(2000).nullable().optional(), submit: z.boolean().optional() });

/** Save your review as you go; Send needs a level for every criterion. A sent review can't be changed. */
export async function savePeerReviewAction(reviewId: string, draft: z.input<typeof input>): Promise<{ success: true } | Failure> {
  const userId = await person();
  const parsed = input.safeParse(draft);
  if (!userId || !isLooseUuid(reviewId) || !parsed.success) return DENIED;
  const [row] = Array.from(await db.execute<{ settings: unknown; org_id: string; submitted: boolean }>(sql`
    SELECT m.assignment_settings AS settings, r.workspace_id AS org_id, r.submitted_at IS NOT NULL AS submitted
    FROM peer_reviews r JOIN tasks m ON m.id = r.master_id WHERE r.id = ${reviewId}::uuid AND r.reviewer_id = ${userId}::uuid AND m.deleted_at IS NULL`));
  if (!row || !(await getWorkspaceAccessById(row.org_id, userId)).canRead) return DENIED;
  if (row.submitted) return { success: false, error: "You’ve sent this review." };
  const marking = readMarking(row.settings);
  if (marking.mode !== "rubric") return DENIED;
  const levels: Record<string, number> = {};
  for (const c of marking.rubric.criteria) {
    const i = parsed.data.levels[c.id];
    if (typeof i === "number" && c.levels[i]) levels[c.id] = i;
    else if (parsed.data.submit) return { success: false, error: `Pick a level for ${c.name}.` };
  }
  await db.execute(sql`
    UPDATE peer_reviews SET levels = ${JSON.stringify(levels)}::jsonb, comment = ${parsed.data.comment ?? null}, submitted_at = CASE WHEN ${Boolean(parsed.data.submit)} THEN now() ELSE NULL END
    WHERE id = ${reviewId}::uuid AND reviewer_id = ${userId}::uuid AND submitted_at IS NULL`);
  return { success: true };
}
