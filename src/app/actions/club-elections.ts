"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { readPositions, tally } from "@/lib/organizations/club";
import { giveRoles } from "@/lib/organizations/club-server";
import { clubLike } from "@/lib/organizations/kits";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 36.3 (plan B7.2b, L2 calls 4–7): a club's election for its elected positions. The President starts it and names
 * a returning officer, who can't stand; members nominate (themselves or others) and the nominee accepts with a statement;
 * the returning officer opens and closes voting. A ballot is secret: its row holds the choice and no voter, and a separate
 * row records only that the person voted, which is also what stops a second vote. Ties go to a run-off between the tied.
 * Turnout is a count, never names.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
type Phase = "nominations" | "voting" | "results";
type Election = { id: string; created_at: string; season: string; phase: Phase; ro: string | null; show_counts: boolean; rounds: Record<string, { round: number; tied: string[] }>; results: Record<string, { winner: string | null; counts?: Record<string, number>; abstained?: number }> | null };

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!clubLike(w?.type, w?.settings, "positions") || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, w, president: a.isOwner && !a.writeBlocked, blocked: Boolean(a.writeBlocked), positions: readPositions(w.settings).positions.filter((p) => p.filled === "election") };
}

async function current(tx: Pick<typeof db, "execute">, orgId: string, lock = false) {
  const [e] = Array.from(await tx.execute<Election>(sql`
    SELECT id, created_at, season, phase, returning_officer_id AS ro, show_counts, rounds, results FROM club_elections WHERE org_id = ${orgId}::uuid
    ORDER BY (phase <> 'results') DESC, created_at DESC LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`));
  return e ?? null;
}

const activeMember = (orgId: string, userId: string) => sql`EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL)`;

async function tell(to: string[], actor: string, title: string, orgId: string, slug: string, key: string) {
  for (const u of new Set(to)) {
    if (u === actor) continue;
    await createNotification({ recipientUserId: u, actorUserId: actor, kind: "project_task_activity", category: "tasks", importance: "more", title,
      href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `${key}:${u}` }).catch(() => undefined);
  }
}

/** The election (members): phase, positions with candidates and statements, my nominations and votes, turnout, results. */
export async function readElectionAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx) return DENIED;
  const e = await current(db, orgId);
  if (!e) return { success: true as const, election: null, president: ctx.president, positions: ctx.positions.map((p) => ({ id: p.id, label: p.label })) };
  const cands = Array.from(await db.execute<{ position_id: string; user_id: string; state: string; statement: string; name: string }>(sql`
    SELECT c.position_id, c.user_id, c.state, c.statement, coalesce(p.full_name, p.username, 'Member') AS name FROM club_candidates c JOIN profiles p ON p.id = c.user_id
    WHERE c.election_id = ${e.id}::uuid ORDER BY c.created_at`));
  const voted = new Set(Array.from(await db.execute<{ position_id: string; round: number }>(sql`
    SELECT position_id, round FROM club_voted WHERE election_id = ${e.id}::uuid AND user_id = ${ctx.userId}::uuid`)).map((v) => `${v.position_id}:${v.round}`));
  const [elig] = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL
    AND joined_at <= ${e.created_at}::timestamptz`));
  const turnout = Array.from(await db.execute<{ position_id: string; round: number; n: number }>(sql`
    SELECT position_id, round, count(*)::int AS n FROM club_voted WHERE election_id = ${e.id}::uuid GROUP BY position_id, round`));
  const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 1000`));
  const names = new Map(people.map((p) => [p.id, p.name]));
  const isRo = e.ro === ctx.userId;
  return { success: true as const, president: ctx.president, me: ctx.userId, people, eligible: elig?.n ?? 0,
    election: { id: e.id, season: e.season, phase: e.phase, ro: e.ro ? { id: e.ro, name: names.get(e.ro) ?? "Someone" } : null, isRo, showCounts: e.show_counts },
    positions: ctx.positions.map((p) => {
      const round = e.rounds[p.id]?.round ?? 1;
      const tied = e.rounds[p.id]?.tied ?? null;
      const standing = cands.filter((c) => c.position_id === p.id && c.state === "standing" && (!tied || tied.includes(c.user_id)));
      const r = e.results?.[p.id];
      return { id: p.id, label: p.label, round, runoff: Boolean(tied),
        candidates: standing.map((c) => ({ id: c.user_id, name: c.name, statement: c.statement })),
        // Nominations waiting for an answer: only the nominee and the returning officer see them.
        pending: cands.filter((c) => c.position_id === p.id && c.state === "nominated" && (c.user_id === ctx.userId || isRo)).map((c) => ({ id: c.user_id, name: c.name })),
        mine: cands.find((c) => c.position_id === p.id && c.user_id === ctx.userId)?.state ?? null,
        voted: voted.has(`${p.id}:${round}`), turnout: turnout.find((t) => t.position_id === p.id && t.round === round)?.n ?? 0,
        result: e.phase === "results" || r ? (r ? { winner: r.winner ? { id: r.winner, name: names.get(r.winner) ?? cands.find((c) => c.user_id === r.winner)?.name ?? "Someone" } : null,
          counts: e.show_counts && r.counts ? Object.entries(r.counts).map(([id, n]) => ({ name: names.get(id) ?? cands.find((c) => c.user_id === id)?.name ?? "Someone", n })) : null } : null) : null };
    }) };
}

const startSchema = z.object({ season: z.string().trim().min(1).max(20), returningOfficerId: z.string().uuid(), showCounts: z.boolean() }).strict();

/** The President starts an election (one open at a time) and names the returning officer. */
export async function startElectionAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  const parsed = startSchema.safeParse(input);
  if (!ctx?.president) return DENIED;
  if (!parsed.success) return { success: false, error: "Name the Season and a returning officer." };
  if (!ctx.positions.length) return { success: false, error: "No positions are filled by election." };
  const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT ${activeMember(orgId, parsed.data.returningOfficerId)} AS ok`));
  if (!ok?.ok) return { success: false, error: "The returning officer is a member of the club." };
  const [made] = Array.from(await db.execute<{ id: string }>(sql`
    INSERT INTO club_elections (org_id, season, returning_officer_id, show_counts, created_by) VALUES (${orgId}::uuid, ${parsed.data.season}, ${parsed.data.returningOfficerId}::uuid, ${parsed.data.showCounts}, ${ctx.userId}::uuid)
    ON CONFLICT DO NOTHING RETURNING id`));
  if (!made) return { success: false, error: "An election is already running." };
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL LIMIT 2000`)).map((m) => m.id);
  await tell(members, ctx.userId, `Nominations are open for ${ctx.w.title}'s ${parsed.data.season} committee`, orgId, ctx.w.slug ?? orgId, `club-election-open:${made.id}`);
  return { success: true };
}

/** Nominate (any member, during nominations): yourself or another member; they accept to stand. Never the returning officer. */
export async function nominateAction(orgId: string, positionId: string, userId: string): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(userId) || !ctx.positions.some((p) => p.id === positionId)) return DENIED;
  const e = await current(db, orgId);
  if (!e || e.phase !== "nominations") return { success: false, error: "Nominations are closed." };
  if (userId === e.ro) return { success: false, error: "The returning officer can’t stand." };
  const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT ${activeMember(orgId, userId)} AS ok`));
  if (!ok?.ok) return { success: false, error: "Candidates are members of the club." };
  const [made] = Array.from(await db.execute<{ ok: number }>(sql`
    INSERT INTO club_candidates (election_id, position_id, user_id, nominated_by) VALUES (${e.id}::uuid, ${positionId}, ${userId}::uuid, ${ctx.userId}::uuid) ON CONFLICT DO NOTHING RETURNING 1 AS ok`));
  if (made) await tell([userId], ctx.userId, `You were nominated for ${ctx.positions.find((p) => p.id === positionId)!.label}: accept to stand`, orgId, ctx.w.slug ?? orgId, `club-nominated:${e.id}:${positionId}`);
  return { success: true };
}

/** The nominee accepts (with a statement) or declines; a candidate can update their statement or withdraw during nominations. */
export async function answerNominationAction(orgId: string, positionId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  const parsed = z.object({ stand: z.boolean(), statement: z.string().trim().max(2000) }).strict().safeParse(input);
  if (!ctx || ctx.blocked || !parsed.success) return DENIED;
  const e = await current(db, orgId);
  if (!e || e.phase !== "nominations") return { success: false, error: "Nominations are closed." };
  const [r] = Array.from(await db.execute<{ ok: number }>(sql`
    UPDATE club_candidates SET state = ${parsed.data.stand ? "standing" : "withdrawn"}, statement = ${parsed.data.statement}
    WHERE election_id = ${e.id}::uuid AND position_id = ${positionId} AND user_id = ${ctx.userId}::uuid AND state IN ('nominated', 'standing') RETURNING 1 AS ok`));
  return r ? { success: true } : DENIED;
}

/** The returning officer opens voting (nominations close). */
export async function openVotingAction(orgId: string): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx || ctx.blocked) return DENIED;
  const [e] = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE club_elections SET phase = 'voting' WHERE org_id = ${orgId}::uuid AND phase = 'nominations' AND returning_officer_id = ${ctx.userId}::uuid RETURNING id`));
  if (!e) return DENIED;
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL LIMIT 2000`)).map((m) => m.id);
  await tell(members, ctx.userId, `Voting is open for ${ctx.w.title}'s committee`, orgId, ctx.w.slug ?? orgId, `club-election-vote:${e.id}`);
  return { success: true };
}

/**
 * Vote (each member, once per position per round): a choice among the candidates, or Abstain. The voted row (no choice)
 * and the ballot row (no voter) are written together; the voted row's key refuses a second vote.
 */
export async function voteAction(orgId: string, positionId: string, choice: string | null): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx || ctx.blocked || !ctx.positions.some((p) => p.id === positionId) || (choice !== null && !isLooseUuid(choice))) return DENIED;
  const out = await db.transaction(async (tx) => {
    const e = await current(tx, orgId);
    if (!e || e.phase !== "voting" || e.results?.[positionId]) return "closed";
    const round = e.rounds[positionId]?.round ?? 1;
    const tied = e.rounds[positionId]?.tied ?? null;
    if (choice) {
      const [c] = Array.from(await tx.execute<{ ok: number }>(sql`
        SELECT 1 AS ok FROM club_candidates WHERE election_id = ${e.id}::uuid AND position_id = ${positionId} AND user_id = ${choice}::uuid AND state = 'standing'`));
      if (!c || (tied && !tied.includes(choice))) return "denied";
    }
    // Security review: the electorate is fixed when the election starts (members who joined later don't vote).
    const [member] = Array.from(await tx.execute(sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid
      AND role <> 'viewer' AND completed_at IS NULL AND joined_at <= ${e.created_at}::timestamptz`));
    if (!member) return "denied";
    const [v] = Array.from(await tx.execute<{ ok: number }>(sql`
      INSERT INTO club_voted (election_id, position_id, round, user_id) VALUES (${e.id}::uuid, ${positionId}, ${round}, ${ctx.userId}::uuid) ON CONFLICT DO NOTHING RETURNING 1 AS ok`));
    if (!v) return "already";
    await tx.execute(sql`INSERT INTO club_ballots (election_id, position_id, round, choice_id) VALUES (${e.id}::uuid, ${positionId}, ${round}, ${choice}::uuid)`);
    return "ok";
  });
  if (out === "closed") return { success: false, error: "Voting isn’t open for this position." };
  if (out === "already") return { success: false, error: "You’ve voted for this position." };
  return out === "ok" ? { success: true } : DENIED;
}

/**
 * The returning officer closes this round: each position is counted; a winner is recorded, a tie opens a run-off round
 * between the tied (voting stays open for those), and when nothing is tied the election moves to results. Winners hold
 * their position for the election's Season (roles switch at the handover, B7.2c).
 */
export async function closeVotingAction(orgId: string): Promise<{ success: true; runoffs: number } | Failure> {
  const ctx = await club(orgId);
  if (!ctx || ctx.blocked) return DENIED;
  const out = await db.transaction(async (tx) => {
    const e = await current(tx, orgId, true);
    if (!e || e.phase !== "voting" || e.ro !== ctx.userId) return null;
    const results = { ...(e.results ?? {}) };
    const rounds = { ...e.rounds };
    let runoffs = 0;
    for (const p of ctx.positions) {
      if (results[p.id]) continue;
      const round = rounds[p.id]?.round ?? 1;
      const standing = Array.from(await tx.execute<{ id: string }>(sql`
        SELECT user_id AS id FROM club_candidates WHERE election_id = ${e.id}::uuid AND position_id = ${p.id} AND state = 'standing'`)).map((c) => c.id)
        .filter((id) => !rounds[p.id]?.tied || rounds[p.id]!.tied.includes(id));
      const ballots = Array.from(await tx.execute<{ choice: string | null }>(sql`
        SELECT choice_id AS choice FROM club_ballots WHERE election_id = ${e.id}::uuid AND position_id = ${p.id} AND round = ${round}`)).map((b) => b.choice);
      const t = tally(ballots, standing);
      if (t.tied.length) { rounds[p.id] = { round: round + 1, tied: t.tied }; runoffs += 1; continue; }
      results[p.id] = { winner: t.winner, counts: t.counts, abstained: t.abstained };
    }
    const done = runoffs === 0;
    await tx.execute(sql`UPDATE club_elections SET rounds = ${JSON.stringify(rounds)}::jsonb, results = ${JSON.stringify(results)}::jsonb,
      phase = ${done ? "results" : "voting"}, closed_at = ${done ? sql`now()` : sql`NULL`} WHERE id = ${e.id}::uuid`);
    if (done) {
      const made: string[] = [];
      for (const p of ctx.positions) {
        const w = results[p.id]?.winner;
        if (!w) continue;
        const [t] = Array.from(await tx.execute<{ id: string }>(sql`
          INSERT INTO club_position_terms (org_id, position_id, position_label, season, user_id, holder_name, how, state, accepted_at)
          SELECT ${orgId}::uuid, ${p.id}, ${p.label}, ${e.season}, ${w}::uuid, coalesce(pr.full_name, pr.username, 'Member'), 'election', 'holding', now() FROM profiles pr WHERE pr.id = ${w}::uuid
          ON CONFLICT DO NOTHING RETURNING id`));
        if (t) made.push(t.id);
      }
      // B7.2c: winners for the Season under way (a by-election) take their role now; a later Season's at the handover.
      const committee = readPositions(ctx.w.settings);
      if (e.season === committee.season) await giveRoles(tx, orgId, made, committee.positions.filter((p) => p.gives === "coordinator").map((p) => p.id));
    }
    return { runoffs, id: e.id, done };
  });
  if (!out) return DENIED;
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL LIMIT 2000`)).map((m) => m.id);
  await tell(members, ctx.userId, out.done ? `${ctx.w.title}'s election results are in` : `A run-off is open for ${ctx.w.title}'s election`, orgId, ctx.w.slug ?? orgId,
    `club-election-${out.done ? "results" : "runoff"}:${out.id}:${Date.now()}`);
  return { success: true, runoffs: out.runoffs };
}
