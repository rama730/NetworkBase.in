"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { positionsSettingsSchema, readPositions } from "@/lib/organizations/club";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 36.3 (plan B7.2a, L2 calls 1–3, 8–9): a club's positions and this Season's committee. Anyone who can read the
 * club sees This Season's committee (position, name, photo); the President sets positions and appoints; an appointment
 * waits for the holder's yes and then gives the role the position names (Coordinator). Ending a term takes it back unless
 * another position still gives it. The presidency itself moves only through the built ownership transfer. Every term is
 * kept as the committee history.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; owner: string; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, owner_id AS owner, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "club" || !a.canRead) return null;
  return { userId, w, president: Boolean(userId) && a.isOwner && !a.writeBlocked, officer: Boolean(userId) && (a.isOwner || a.memberRole === "admin"),
    member: Boolean(userId) && (a.isOwner || a.isMember), blocked: Boolean(a.writeBlocked), settings: readPositions(w.settings) };
}

/** This Season's committee (everyone who can read the club), past Seasons (members), and what the viewer can do. */
export async function readCommitteeAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx) return DENIED;
  const { season, positions } = ctx.settings;
  const terms = Array.from(await db.execute<{ id: string; position_id: string; position_label: string; season: string; user_id: string | null; holder_name: string; how: string; state: string;
    avatar: string | null; username: string | null }>(sql`
    SELECT t.id, t.position_id, t.position_label, t.season, t.user_id, t.holder_name, t.how, t.state, p.avatar_url AS avatar, p.username
    FROM club_position_terms t LEFT JOIN profiles p ON p.id = t.user_id AND p.deleted_at IS NULL
    WHERE t.org_id = ${orgId}::uuid AND t.state IN ('offered', 'holding', 'ended') ORDER BY t.season DESC, t.created_at LIMIT 500`));
  const current = terms.filter((t) => t.season === season && t.state !== "ended");
  const people = ctx.president ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 500`)) : [];
  // Security review: the documents this person may read (as Documents does): drafts and leaders-only pages for officers only.
  const allDocs = ctx.member ? Array.from(await db.execute<{ id: string; slug: string; name: string }>(sql`
    SELECT d.id, d.slug, regexp_replace(d.filename, '\.md$', '', 'i') AS name FROM workspace_documents d WHERE d.workspace_id = ${orgId}::uuid
      AND (${ctx.officer} OR ((coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft' OR d.settings->'org'->>'owner' = ${ctx.userId ?? ""}::text)
        AND coalesce(d.settings->>'visibilityOverride', '') <> 'leaders_only'))
    ORDER BY d.filename LIMIT 200`)) : [];
  const docs = ctx.officer ? allDocs.map(({ id, name }) => ({ id, name })) : [];
  return { success: true as const, season, president: ctx.president, officer: ctx.officer, me: ctx.userId, people, docs,
    positions: positions.map((p) => {
      const t = current.find((x) => x.position_id === p.id && (x.state === "holding" || ctx.officer || x.user_id === ctx.userId));
      return { ...p, docId: ctx.member ? p.docId : null, docSlug: ctx.member ? allDocs.find((x) => x.id === p.docId)?.slug ?? null : null,
        holder: t ? { termId: t.id, userId: t.user_id, name: t.holder_name, avatar: t.avatar, username: t.username, state: t.state as "offered" | "holding", how: t.how } : null };
    }),
    // Call 8: the committee history, kept after people leave (members only).
    history: ctx.member ? terms.filter((t) => t.season !== season && (t.state === "holding" || t.state === "ended")).map((t) => ({ season: t.season, position: t.position_label, name: t.holder_name })) : [] };
}

/** Positions and the Season's name (the President): rename, add, remove, how each is filled, what it gives, its role page. */
export async function savePositionsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.president) return DENIED;
  const parsed = positionsSettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Each position needs a name; up to 15." };
  const d = parsed.data;
  if (new Set(d.positions.map((p) => p.id)).size !== d.positions.length || d.positions.filter((p) => p.gives === "president").length > 1) return { success: false, error: "Each position needs a name; up to 15." };
  const docIds = d.positions.flatMap((p) => (p.docId ? [p.docId] : []));
  if (docIds.length) {
    const ok = Array.from(await db.execute<{ id: string }>(sql`SELECT id FROM workspace_documents WHERE workspace_id = ${orgId}::uuid AND id = ANY(${`{${docIds.join(",")}}`}::uuid[])`));
    if (ok.length !== new Set(docIds).size) return DENIED;
  }
  // Security review: a role page members can read (not a draft, not leaders-only), since every member sees the link.
  if (docIds.length) {
    const [hidden] = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM workspace_documents WHERE id = ANY(${`{${docIds.join(",")}}`}::uuid[])
      AND (coalesce(settings->'org'->>'lifecycle', 'published') = 'draft' OR coalesce(settings->>'visibilityOverride', '') = 'leaders_only')`));
    if ((hidden?.n ?? 0) > 0) return { success: false, error: "A role page is one every member can read: publish it first." };
  }
  const newSeason = d.season !== ctx.settings.season;
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{club}', coalesce(org_settings->'club', '{}'::jsonb) || jsonb_build_object('committee', ${JSON.stringify(d)}::jsonb))
      WHERE id = ${orgId}::uuid`);
    if (!newSeason) return;
    // Security review: a new Season ends last Season's terms, and the roles they gave go with them.
    const ended = Array.from(await tx.execute<{ user_id: string | null; gave_role: boolean }>(sql`
      UPDATE club_position_terms SET state = CASE WHEN state = 'holding' THEN 'ended' ELSE 'declined' END, ended_at = now()
      WHERE org_id = ${orgId}::uuid AND season <> ${d.season} AND state IN ('offered', 'holding') RETURNING user_id, gave_role`));
    for (const u of new Set(ended.filter((e) => e.gave_role && e.user_id && e.user_id !== ctx.w.owner).map((e) => e.user_id!))) {
      await tx.execute(sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${orgId}::uuid AND user_id = ${u}::uuid AND role = 'admin'
        AND NOT EXISTS (SELECT 1 FROM club_position_terms t WHERE t.org_id = ${orgId}::uuid AND t.user_id = ${u}::uuid AND t.state = 'holding' AND t.season = ${d.season})`);
    }
  });
  return { success: true };
}

/** Appoint (the President): an offer the person accepts. One holder per position per Season. */
export async function appointAction(orgId: string, positionId: string, userId: string): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.president || !isLooseUuid(userId) || typeof positionId !== "string") return DENIED;
  const p = ctx.settings.positions.find((x) => x.id === positionId);
  if (!p) return DENIED;
  if (p.gives === "president") return { success: false, error: "The presidency moves through Transfer ownership in Settings." };
  const [m] = Array.from(await db.execute<{ name: string }>(sql`
    SELECT coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL`));
  if (!m) return { success: false, error: "Officers are people in the club." };
  const [made] = Array.from(await db.execute<{ id: string }>(sql`
    INSERT INTO club_position_terms (org_id, position_id, position_label, season, user_id, holder_name, how, state, offered_by)
    VALUES (${orgId}::uuid, ${p.id}, ${p.label}, ${ctx.settings.season}, ${userId}::uuid, ${m.name}, 'appointment', ${userId === ctx.userId ? "holding" : "offered"}, ${ctx.userId}::uuid)
    ON CONFLICT DO NOTHING RETURNING id`));
  if (!made) return { success: false, error: "That position already has someone this Season." };
  if (userId === ctx.userId) await giveRole(orgId, userId, p.gives, made.id);
  else await createNotification({ recipientUserId: userId, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
    title: `You're asked to be ${p.label} of ${ctx.w.title} this Season`, href: `/org/${encodeURIComponent(ctx.w.slug ?? orgId)}`, entityRefs: { projectId: orgId, projectSlug: ctx.w.slug ?? orgId },
    dedupeKey: `club-appoint:${made.id}` }).catch(() => undefined);
  return { success: true };
}

/** Holding a Coordinator position makes a member a Coordinator; the term remembers whether it did. */
async function giveRole(orgId: string, userId: string, gives: string, termId: string) {
  if (gives !== "coordinator") return;
  const changed = Array.from(await db.execute(sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role = 'member' RETURNING user_id`));
  if (changed.length) await db.execute(sql`UPDATE club_position_terms SET gave_role = true WHERE id = ${termId}::uuid`);
}

/** The person answers an appointment; yes gives them the role the position names. */
export async function answerAppointmentAction(orgId: string, termId: string, accept: boolean): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.member || ctx.blocked || !isLooseUuid(termId) || typeof accept !== "boolean") return DENIED;
  const [t] = Array.from(await db.execute<{ position_id: string }>(sql`
    UPDATE club_position_terms SET state = ${accept ? "holding" : "declined"}, accepted_at = ${accept ? sql`now()` : sql`NULL`}
    WHERE id = ${termId}::uuid AND org_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND state = 'offered' RETURNING position_id`));
  if (!t) return DENIED;
  if (accept) await giveRole(orgId, ctx.userId!, ctx.settings.positions.find((p) => p.id === t.position_id)?.gives ?? "none", termId);
  return { success: true };
}

/**
 * End a term (the President, or the holder stepping down). The Coordinator role goes with it unless another position
 * this Season still gives it; the President's own ownership never changes here.
 */
export async function endTermAction(orgId: string, termId: string): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.member || ctx.blocked || !isLooseUuid(termId)) return DENIED;
  const out = await db.transaction(async (tx) => {
    const [t] = Array.from(await tx.execute<{ user_id: string | null; position_id: string; gave_role: boolean }>(sql`
      UPDATE club_position_terms SET state = 'ended', ended_at = now()
      WHERE id = ${termId}::uuid AND org_id = ${orgId}::uuid AND state IN ('offered', 'holding') AND (${ctx.president} OR user_id = ${ctx.userId}::uuid) RETURNING user_id, position_id, gave_role`));
    if (!t) return false;
    // Only a role this term gave is taken back, and not while another held position also gave it.
    if (t.user_id && t.gave_role && t.user_id !== ctx.w.owner) {
      const giving = ctx.settings.positions.filter((p) => p.gives === "coordinator").map((p) => p.id);
      const [still] = Array.from(await tx.execute<{ ok: boolean }>(sql`
        SELECT true AS ok FROM club_position_terms WHERE org_id = ${orgId}::uuid AND user_id = ${t.user_id}::uuid AND state = 'holding' AND season = ${ctx.settings.season}
          AND position_id = ANY(${`{${giving.join(",") || "none"}}`}::text[]) LIMIT 1`));
      if (!still) await tx.execute(sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${orgId}::uuid AND user_id = ${t.user_id}::uuid AND role = 'admin'`);
    }
    return true;
  });
  return out ? { success: true } : DENIED;
}
