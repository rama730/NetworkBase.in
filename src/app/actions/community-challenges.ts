"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createCopies } from "@/lib/organizations/assignments";
import { pauseActive } from "@/lib/organizations/community";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 34.5 (plan B5.4a, M4 call 1): a community challenge is an Optional assignment. Nobody gets a copy until they
 * Join; a joined copy has no due date of its own (the challenge's closing date lives on the challenge), so it is
 * never Missing or Overdue. Members join until it closes and hand in through the usual hand-in; Leave removes a copy
 * nothing was handed in on. No streaks, points or ranks (call 3). Never a token: agents never join or hand in.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function community(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; pause: { until: string } | null }>(sql`
    SELECT org_type AS type, slug, org_settings->'community'->'pauses'->${userId}::text AS pause FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "community" || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, slug: w.slug ?? orgId, organiser: a.isOwner || a.memberRole === "admin", member: !a.isOwner && a.memberRole === "member", paused: pauseActive(w.pause, new Date()) };
}

/** Tasks → Challenges: open challenges first (closing soonest), then past ones; joined and entry counts; your copy. */
export async function readChallengesAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; title: string; description: string | null; closes: string | null; closed: string | null; joined: number; entries: number; mine: string | null; mine_done: boolean | null }>(sql`
    SELECT m.id, m.title, m.description, m.due_date::text AS closes, m.assignment_settings->>'closedAt' AS closed,
      (SELECT count(*)::int FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL) AS joined,
      (SELECT count(*)::int FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.status = 'done' OR c.review_status = 'pending')) AS entries,
      (SELECT c.id FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND c.assignee_id = ${ctx.userId}::uuid LIMIT 1) AS mine,
      (SELECT c.status = 'done' OR c.review_status = 'pending' FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND c.assignee_id = ${ctx.userId}::uuid LIMIT 1) AS mine_done
    FROM tasks m
    WHERE m.workspace_id = ${orgId}::uuid AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL
      AND m.assignment_settings->'target'->>'mode' = 'optional' AND m.assignment_settings->>'publishedAt' IS NOT NULL
    ORDER BY (m.assignment_settings->>'closedAt' IS NOT NULL OR (m.due_date IS NOT NULL AND m.due_date < now())), m.due_date NULLS LAST LIMIT 100`));
  const now = Date.now();
  return { success: true as const, canStart: ctx.organiser, canJoin: ctx.member, challenges: rows.map((r) => ({ id: r.id, title: r.title, description: r.description,
    closes: r.closes, open: !r.closed && !(r.closes && Date.parse(r.closes) < now), joined: r.joined, entries: r.entries,
    mine: r.mine ? { id: r.mine, handedIn: r.mine_done === true } : null })) };
}

async function openChallenge(executor: Pick<typeof db, "execute">, orgId: string, masterId: string, lock: boolean) {
  const [m] = Array.from(await executor.execute<{ id: string; creator: string | null; closes: string | null; closed: string | null }>(sql`
    SELECT id, creator_id AS creator, due_date::text AS closes, assignment_settings->>'closedAt' AS closed FROM tasks
    WHERE id = ${masterId}::uuid AND workspace_id = ${orgId}::uuid AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL
      AND assignment_settings->'target'->>'mode' = 'optional' AND assignment_settings->>'publishedAt' IS NOT NULL ${lock ? sql`FOR UPDATE` : sql``}`));
  if (!m || m.closed || (m.closes && Date.parse(m.closes) < Date.now())) return null;
  return m;
}

/** Join the challenge (call 1): a copy for you, with no due date of its own. Members only, not while paused, until it closes. */
export async function joinChallengeAction(orgId: string, masterId: string): Promise<{ success: true; copyId: string } | Failure> {
  const ctx = await community(orgId);
  if (!ctx || !isLooseUuid(masterId)) return DENIED;
  if (!ctx.member) return { success: false, error: "Challenges are for the community’s members." };
  if (ctx.paused) return { success: false, error: "You can join when your pause ends." };
  const copyId = await db.transaction(async (tx) => {
    // One copy per person: the lock on the challenge keeps two Joins at once from making two.
    const m = await openChallenge(tx, orgId, masterId, true);
    if (!m) return null;
    const [existing] = Array.from(await tx.execute<{ id: string }>(sql`SELECT id FROM tasks WHERE assignment_id = ${masterId}::uuid AND assignee_id = ${ctx.userId}::uuid AND deleted_at IS NULL LIMIT 1`));
    if (existing) return existing.id;
    await createCopies(tx, masterId, [{ projectId: orgId, assigneeId: ctx.userId }], m.creator ?? ctx.userId);
    const [made] = Array.from(await tx.execute<{ id: string }>(sql`
      UPDATE tasks SET due_date = NULL, updated_at = now() WHERE assignment_id = ${masterId}::uuid AND assignee_id = ${ctx.userId}::uuid AND deleted_at IS NULL RETURNING id`));
    return made?.id ?? null;
  });
  return copyId ? { success: true, copyId } : { success: false, error: "This challenge is closed." };
}

/** Leave (layer 5): removes your copy when nothing was handed in on it; an entry already handed in stays. */
export async function leaveChallengeAction(orgId: string, masterId: string): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx || !isLooseUuid(masterId)) return DENIED;
  const [r] = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE tasks c SET deleted_at = now(), updated_at = now()
    FROM tasks m WHERE m.id = ${masterId}::uuid AND m.workspace_id = ${orgId}::uuid AND m.assignment_settings->'target'->>'mode' = 'optional'
      AND c.assignment_id = m.id AND c.assignee_id = ${ctx.userId}::uuid AND c.deleted_at IS NULL AND c.status <> 'done' AND c.review_status <> 'pending'
    RETURNING c.id`));
  return r ? { success: true } : { success: false, error: "Your entry is handed in, so it stays. Delete it from the entry if you want it gone." };
}
