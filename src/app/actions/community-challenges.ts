"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

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

// ---- B5.4b (report 34.5 calls 4–6, 9): entries, Featured, the Showcase ----

const handedIn = sql`(c.status = 'done' OR c.review_status = 'pending')`;
type EntryRow = { id: string; challenge_id: string; challenge: string; title: string | null; line: string | null; link: string | null; text: string | null; maker: string;
  maker_name: string | null; maker_username: string | null; featured: boolean; why: string | null; public_yes: string[] | null; at: string };

async function entries(orgId: string, where: ReturnType<typeof sql>, viewer: string | null) {
  return Array.from(await db.execute<EntryRow>(sql`
    SELECT c.id, m.id AS challenge_id, m.title AS challenge, s.title, s.line, c.submission->>'link' AS link, left(c.submission->>'text', 400) AS text,
      c.assignee_id AS maker, p.full_name AS maker_name, p.username AS maker_username, s.featured_at IS NOT NULL AS featured, s.why, s.public_yes,
      coalesce(c.review_submitted_at, c.completed_at, c.updated_at)::text AS at
    FROM tasks c JOIN tasks m ON m.id = c.assignment_id JOIN profiles p ON p.id = c.assignee_id
    LEFT JOIN community_showcase s ON s.copy_id = c.id
    WHERE m.workspace_id = ${orgId}::uuid AND m.assignment_settings->'target'->>'mode' = 'optional' AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND ${handedIn}
      AND (${viewer}::uuid IS NULL OR c.assignee_id = ${viewer}::uuid OR NOT app_private.blocked_between(${viewer}::uuid, c.assignee_id)) AND ${where}
    -- Call 6: Featured first, then newest; never by likes.
    ORDER BY (s.featured_at IS NOT NULL) DESC, coalesce(c.review_submitted_at, c.completed_at, c.updated_at) DESC LIMIT 200`));
}
const card = (r: EntryRow, viewer: string | null) => ({ id: r.id, challengeId: r.challenge_id, challenge: r.challenge, title: r.title ?? r.challenge, line: r.line,
  link: r.link?.startsWith("https://") ? r.link : null, text: r.link ? null : r.text, maker: r.maker_name ?? r.maker_username ?? "Someone", mine: r.maker === viewer,
  featured: r.featured, why: r.why, isPublic: (r.public_yes ?? []).includes(r.maker) });

/** A challenge's entries (members): the gallery, Featured first. */
export async function readChallengeEntriesAction(orgId: string, masterId: string) {
  const ctx = await community(orgId);
  if (!ctx || !isLooseUuid(masterId)) return DENIED;
  const rows = await entries(orgId, sql`m.id = ${masterId}::uuid`, ctx.userId);
  return { success: true as const, canFeature: ctx.organiser, entries: rows.map((r) => card(r, ctx.userId)) };
}

const cardSchema = z.object({ title: z.string().trim().min(1).max(120).nullable(), line: z.string().trim().max(200).nullable(), isPublic: z.boolean() }).strict();

/** Your entry's card (layer 3): a title, a line and Show on the public Showcase — only the maker, only once handed in. */
export async function saveEntryCardAction(orgId: string, copyId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  const parsed = cardSchema.safeParse(input);
  if (!ctx || !isLooseUuid(copyId) || !parsed.success) return DENIED;
  const [c] = Array.from(await db.execute<{ id: string }>(sql`
    SELECT c.id FROM tasks c JOIN tasks m ON m.id = c.assignment_id
    WHERE c.id = ${copyId}::uuid AND m.workspace_id = ${orgId}::uuid AND m.assignment_settings->'target'->>'mode' = 'optional'
      AND c.assignee_id = ${ctx.userId}::uuid AND c.deleted_at IS NULL AND ${handedIn}`));
  if (!c) return { success: false, error: "Hand in your entry first." };
  const d = parsed.data;
  await db.execute(sql`
    INSERT INTO community_showcase (copy_id, workspace_id, title, line, public_yes) VALUES (${copyId}::uuid, ${orgId}::uuid, ${d.title}, ${d.line || null}, ${d.isPublic ? sql`ARRAY[${ctx.userId}::uuid]` : sql`'{}'::uuid[]`})
    ON CONFLICT (copy_id) DO UPDATE SET title = excluded.title, line = excluded.line, public_yes = excluded.public_yes, updated_at = now()`);
  return { success: true };
}

/** Feature (call 4): organisers pick an entry with a short Why we love it line, or take the pick back. The maker is told (Normal). */
export async function featureEntryAction(orgId: string, copyId: string, why: string | null): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.organiser || !isLooseUuid(copyId)) return DENIED;
  const line = typeof why === "string" ? why.trim().slice(0, 200) : null;
  if (why !== null && !line) return { success: false, error: "Say why you love it, in a line." };
  const [c] = Array.from(await db.execute<{ maker: string; title: string }>(sql`
    SELECT c.assignee_id AS maker, m.title FROM tasks c JOIN tasks m ON m.id = c.assignment_id
    WHERE c.id = ${copyId}::uuid AND m.workspace_id = ${orgId}::uuid AND m.assignment_settings->'target'->>'mode' = 'optional' AND c.deleted_at IS NULL AND ${handedIn}`));
  if (!c) return DENIED;
  await db.execute(sql`
    INSERT INTO community_showcase (copy_id, workspace_id, featured_by, featured_at, why) VALUES (${copyId}::uuid, ${orgId}::uuid, ${line ? sql`${ctx.userId}::uuid` : sql`NULL`}, ${line ? sql`now()` : sql`NULL`}, ${line})
    ON CONFLICT (copy_id) DO UPDATE SET featured_by = excluded.featured_by, featured_at = excluded.featured_at, why = excluded.why, updated_at = now()`);
  if (line && c.maker !== ctx.userId) {
    const { createNotification } = await import("@/lib/notifications/service");
    await createNotification({ recipientUserId: c.maker, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `Your entry for ${c.title} is featured: “${line}”`, href: `/org/${encodeURIComponent(ctx.slug)}?tab=about`,
      entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `community-featured:${copyId}` }).catch(() => undefined);
  }
  return { success: true };
}

/**
 * The Showcase on About (calls 5–6): members see every entry; visitors only entries whose maker said yes, and only in
 * a public community (a private one has no public Showcase). Featured first, then newest.
 */
export async function readShowcaseAction(orgId: string) {
  if (!isLooseUuid(orgId)) return DENIED;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; visibility: string }>(sql`SELECT org_type AS type, visibility FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "community" || !a.canRead) return DENIED;
  const inside = Boolean(userId) && (a.isOwner || (a.isMember && a.memberRole !== "viewer"));
  if (!inside && w.visibility !== "public") return { success: true as const, entries: [] };
  const rows = await entries(orgId, inside ? sql`true` : sql`c.assignee_id = ANY(coalesce(s.public_yes, '{}'::uuid[]))`, userId);
  return { success: true as const, entries: rows.map((r) => card(r, userId)).map((e) => (inside ? e : { ...e, text: null })) };
}

// ---- B5.4c (report 34.5 calls 2, 10): prompts that open on a date ----

const promptSchema = z.array(z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().max(2000).nullable(), opensAt: z.string().datetime({ offset: true }) }).strict()).max(60);

/** Prompts (organisers): the whole list, in order; each opens on its own time. */
export async function savePromptsAction(orgId: string, masterId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  const parsed = promptSchema.safeParse(input);
  if (!ctx?.organiser || !isLooseUuid(masterId)) return DENIED;
  if (!parsed.success) return { success: false, error: "Each prompt needs a title and an Opens on time." };
  const ok = await db.transaction(async (tx) => {
    const [m] = Array.from(await tx.execute<{ id: string }>(sql`
      SELECT id FROM tasks WHERE id = ${masterId}::uuid AND workspace_id = ${orgId}::uuid AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL
        AND assignment_settings->'target'->>'mode' = 'optional' FOR UPDATE`));
    if (!m) return false;
    await tx.execute(sql`DELETE FROM challenge_prompts WHERE master_id = ${masterId}::uuid`);
    for (const [i, p] of parsed.data.entries()) {
      await tx.execute(sql`INSERT INTO challenge_prompts (master_id, workspace_id, position, title, body, opens_at) VALUES (${masterId}::uuid, ${orgId}::uuid, ${i + 1}, ${p.title}, ${p.body || null}, ${p.opensAt}::timestamptz)`);
    }
    return true;
  });
  return ok ? { success: true } : DENIED;
}

/** Prompts by day (call 2): every prompt's position and Opens on; its title and text only once it has opened (organisers see all). */
export async function readPromptsAction(orgId: string, masterId: string) {
  const ctx = await community(orgId);
  if (!ctx || !isLooseUuid(masterId)) return DENIED;
  const rows = Array.from(await db.execute<{ position: number; title: string; body: string | null; opens_at: string; open: boolean }>(sql`
    SELECT p.position, p.title, p.body, p.opens_at::text, p.opens_at <= now() AS open
    FROM challenge_prompts p JOIN tasks m ON m.id = p.master_id
    WHERE p.master_id = ${masterId}::uuid AND m.workspace_id = ${orgId}::uuid AND m.deleted_at IS NULL ORDER BY p.position`));
  return { success: true as const, canEdit: ctx.organiser, prompts: rows.map((r) => ({ position: r.position, opensAt: r.opens_at, open: r.open,
    // Hidden on the server until it opens, from everyone but organisers.
    title: r.open || ctx.organiser ? r.title : null, body: r.open || ctx.organiser ? r.body : null })) };
}
