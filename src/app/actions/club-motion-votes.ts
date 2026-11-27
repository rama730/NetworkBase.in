"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { readClubMeetings } from "@/lib/organizations/club";
import { closeMotionVotes, clubQuorum, notifyAll, staying } from "@/lib/organizations/club-server";
import { normalizeWorkspaceDocSettings } from "@/lib/workspaces/doc";
import { clubLike } from "@/lib/organizations/kits";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 36.4 (plan B7.3c, L3 call 4): a seconded motion at the club's General meeting or AGM can go to an online vote: a
 * secret ballot of members staying this Season (For, Against, Abstain) that closes only at its time. The ballot row has
 * no voter; a separate row records that the person voted. Quorum is fixed when it opens; turnout is a count, never names.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!clubLike(w?.type, w?.settings, "clubMeetings") || !a.canRead || !(a.isOwner || a.isMember)) return null;
  return { userId, w, officer: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, blocked: Boolean(a.writeBlocked) };
}

/** Send a seconded, not yet voted motion to an online vote that closes at a set time (officers; 1 hour to 30 days ahead). */
export async function sendMotionToVoteAction(orgId: string, docSlug: string, motionId: string, closesAt: string): Promise<{ success: true; id: string } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer || typeof docSlug !== "string" || typeof motionId !== "string" || typeof closesAt !== "string") return DENIED;
  const at = Date.parse(closesAt);
  if (!Number.isFinite(at) || at < Date.now() + 3_600_000 || at > Date.now() + 30 * 86_400_000) return { success: false, error: "Close the vote between an hour and 30 days from now." };
  const [d] = Array.from(await db.execute<{ id: string; settings: unknown }>(sql`SELECT id, settings FROM workspace_documents WHERE workspace_id = ${orgId}::uuid AND slug = ${docSlug}`));
  const s = normalizeWorkspaceDocSettings(d?.settings);
  const m = s.motions?.find((x) => x.id === motionId);
  if (!d || s.section !== "meetings" || !(s.kind === "general" || s.kind === "agm") || s.approvedAt || !m || m.result) return DENIED;
  if (!m.secondedBy) return { success: false, error: "A motion needs a seconder before the vote." };
  const q = await clubQuorum(orgId);
  const threshold = m.amendment ? readClubMeetings(ctx.w.settings).amendThreshold : 0.5;
  const [made] = Array.from(await db.execute<{ id: string }>(sql`
    INSERT INTO club_motion_votes (org_id, doc_id, motion_id, text, amendment, threshold, needed, eligible, closes_at, created_by)
    VALUES (${orgId}::uuid, ${d.id}::uuid, ${motionId}, ${m.text}, ${m.amendment ? JSON.stringify(m.amendment) : null}::jsonb, ${threshold}, ${q.needed}, ${q.staying}, ${new Date(at).toISOString()}::timestamptz, ${ctx.userId}::uuid)
    ON CONFLICT DO NOTHING RETURNING id`));
  if (!made) return { success: false, error: "This motion is already being voted on online." };
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND ${staying(ctx.w.settings)} LIMIT 2000`));
  await notifyAll(orgId, ctx.w.slug ?? orgId, members.map((x) => ({ to: x.id, title: `Online vote open: ${m.text}` })), ctx.userId, `club-motion-vote-open:${made.id}`);
  return { success: true, id: made.id };
}

/** Online votes (members): open ones with my state and turnout as a count, and the last 60 days' results. */
export async function readMotionVotesAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx) return DENIED;
  await closeMotionVotes(new Date(), orgId);
  const rows = Array.from(await db.execute<{ id: string; text: string; amendment: { article: string; text: string | null } | null; closes_at: string; state: string; result: { for: number; against: number; abstain: number; result: string } | null;
    eligible: number; needed: number; turnout: number; voted: boolean; can: boolean }>(sql`
    SELECT v.id, v.text, v.amendment, v.closes_at, v.state, v.result, v.eligible, v.needed,
      (SELECT count(*)::int FROM club_motion_voted x WHERE x.vote_id = v.id) AS turnout,
      EXISTS (SELECT 1 FROM club_motion_voted x WHERE x.vote_id = v.id AND x.user_id = ${ctx.userId}::uuid) AS voted,
      EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = v.org_id AND m.user_id = ${ctx.userId}::uuid AND m.joined_at <= v.created_at AND ${staying(ctx.w.settings)}) AS can
    FROM club_motion_votes v WHERE v.org_id = ${orgId}::uuid AND (v.state = 'open' OR v.closed_at > now() - interval '60 days') ORDER BY v.state DESC, v.closes_at LIMIT 50`));
  return { success: true as const, votes: rows.map((r) => ({ id: r.id, text: r.text, amendment: r.amendment, closesAt: new Date(r.closes_at).toISOString(), open: r.state === "open",
    turnout: r.turnout, eligible: r.eligible, needed: r.needed, voted: r.voted, canVote: r.can && !ctx.blocked, result: r.result })) };
}

/** Vote For, Against or Abstain (members staying this Season), once, before it closes. */
export async function castMotionVoteAction(orgId: string, voteId: string, choice: string): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(voteId) || !["for", "against", "abstain"].includes(choice)) return DENIED;
  const out = await db.transaction(async (tx) => {
    const [v] = Array.from(await tx.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM club_motion_votes v WHERE v.id = ${voteId}::uuid AND v.org_id = ${orgId}::uuid AND v.state = 'open' AND v.closes_at > now()
        -- Security review: the electorate is fixed when the vote opens (members who joined later don't vote).
        AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND joined_at <= v.created_at AND ${staying(ctx.w.settings)}) FOR SHARE`));
    if (!v) return "closed" as const;
    const voted = Array.from(await tx.execute(sql`INSERT INTO club_motion_voted (vote_id, user_id) VALUES (${voteId}::uuid, ${ctx.userId}::uuid) ON CONFLICT DO NOTHING RETURNING user_id`));
    if (!voted.length) return "twice" as const;
    await tx.execute(sql`INSERT INTO club_motion_ballots (vote_id, choice) VALUES (${voteId}::uuid, ${choice})`);
    return "ok" as const;
  });
  if (out === "twice") return { success: false, error: "You’ve voted on this motion." };
  if (out === "closed") return { success: false, error: "This vote is closed, or isn’t yours to vote in." };
  return { success: true };
}
