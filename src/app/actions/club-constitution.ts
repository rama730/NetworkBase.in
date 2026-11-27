"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { articlesSchema, readPositions, sortArticles, type Article } from "@/lib/organizations/club";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 36.4 (plan B7.3b, L3 calls 7–8): a club's constitution and its Decisions by Season. The President writes the
 * first version; after that it changes only by a passed amendment motion (doc.ts recordVoteAction → publishAmendment).
 * Members read it, and visitors too when the club makes it public. Decisions are the club's decisions, constitution
 * versions and failed amendment attempts, by Season; drafts and leaders-only pages reach officers only.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; title: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "club" || !a.canRead) return null;
  const pub = Boolean((w.settings as { club?: { constitution?: { public?: unknown } } } | null)?.club?.constitution?.public === true);
  return { userId, w, pub, member: Boolean(userId) && (a.isOwner || a.isMember), officer: Boolean(userId) && (a.isOwner || a.memberRole === "admin"), president: Boolean(userId) && a.isOwner && !a.writeBlocked };
}

/** The constitution (members; visitors when public): the current articles and every version with what changed. */
export async function readConstitutionAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx || !(ctx.member || ctx.pub)) return DENIED;
  const versions = Array.from(await db.execute<{ version: number; articles: Article[]; changed: string; season: string | null; at: string; doc_slug: string | null; meeting: string | null }>(sql`
    SELECT v.version, v.articles, v.changed, v.season, v.created_at AS at, d.slug AS doc_slug, d.settings->>'meetingTitle' AS meeting
    FROM club_constitution_versions v LEFT JOIN workspace_documents d ON d.id = v.doc_id WHERE v.org_id = ${orgId}::uuid ORDER BY v.version DESC LIMIT 200`));
  const cur = versions[0];
  return { success: true as const, title: ctx.w.title, president: ctx.president, public: ctx.pub, version: cur?.version ?? null, articles: cur?.articles ?? [],
    history: versions.map((v) => ({ version: v.version, changed: v.changed, season: v.season, at: new Date(v.at).toISOString(), meeting: ctx.member ? v.meeting : null, docSlug: ctx.member ? v.doc_slug : null })) };
}

/** The first version (the President, once). After this, only a passed amendment motion changes it. */
export async function writeConstitutionAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.president) return DENIED;
  const parsed = articlesSchema.safeParse(input);
  if (!parsed.success || new Set(parsed.data.map((a) => a.n)).size !== parsed.data.length) return { success: false, error: "Each article needs its own number, a title and text." };
  const made = Array.from(await db.execute(sql`
    INSERT INTO club_constitution_versions (org_id, version, articles, changed, season, created_by)
    SELECT ${orgId}::uuid, 1, ${JSON.stringify(sortArticles(parsed.data))}::jsonb, 'First version', ${readPositions(ctx.w.settings).season}, ${ctx.userId}::uuid
    WHERE NOT EXISTS (SELECT 1 FROM club_constitution_versions WHERE org_id = ${orgId}::uuid) ON CONFLICT DO NOTHING RETURNING id`));
  if (!made.length) return { success: false, error: "The constitution changes only by a motion at a general meeting or the AGM." };
  return { success: true };
}

/** Whether visitors can read the constitution (the President). */
export async function setConstitutionPublicAction(orgId: string, on: boolean): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.president || typeof on !== "boolean") return DENIED;
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{club}', coalesce(org_settings->'club', '{}'::jsonb) || jsonb_build_object('constitution', jsonb_build_object('public', ${on})))
    WHERE id = ${orgId}::uuid`);
  return { success: true };
}

type Entry = { kind: "decision" | "constitution" | "attempt"; title: string; date: string; detail: string | null; docSlug: string | null };
/** Decisions by Season (members): decisions, constitution versions, and amendments that failed (from approved minutes). */
export async function readDecisionsAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx?.member) return DENIED;
  const current = readPositions(ctx.w.settings).season;
  const decisions = Array.from(await db.execute<{ slug: string; name: string; n: number; status: string | null; date: string | null; season: string | null }>(sql`
    SELECT slug, regexp_replace(filename, '\.md$', '', 'i') AS name, (settings->>'decisionNumber')::int AS n, settings->>'decisionStatus' AS status, settings->>'date' AS date, settings->>'season' AS season
    FROM workspace_documents WHERE workspace_id = ${orgId}::uuid AND settings ? 'decisionNumber'
      AND (${ctx.officer} OR (coalesce(settings->'org'->>'lifecycle', 'published') <> 'draft' AND coalesce(settings->>'visibilityOverride', '') <> 'leaders_only'))
    ORDER BY (settings->>'decisionNumber')::int DESC LIMIT 300`));
  const versions = Array.from(await db.execute<{ version: number; changed: string; season: string | null; at: string }>(sql`
    SELECT version, changed, season, created_at AS at FROM club_constitution_versions WHERE org_id = ${orgId}::uuid AND version > 1 ORDER BY version DESC LIMIT 200`));
  const attempts = Array.from(await db.execute<{ slug: string; meeting: string | null; date: string | null; motion: { text: string; amendment: { article: string } } }>(sql`
    SELECT d.slug, d.settings->>'meetingTitle' AS meeting, d.settings->>'date' AS date, m AS motion FROM workspace_documents d, jsonb_array_elements(coalesce(d.settings->'motions', '[]'::jsonb)) m
    WHERE d.workspace_id = ${orgId}::uuid AND d.settings->>'section' = 'meetings' AND m ? 'amendment' AND m->>'result' = 'failed' AND (${ctx.officer} OR d.settings ? 'approvedAt') LIMIT 200`));
  const bySeason = new Map<string, Entry[]>();
  const add = (season: string | null, e: Entry) => { const k = season ?? "Earlier"; bySeason.set(k, [...(bySeason.get(k) ?? []), e]); };
  for (const d of decisions) add(d.season, { kind: "decision", title: `D-${String(d.n).padStart(3, "0")} ${d.name}`, date: d.date ?? "", detail: d.status, docSlug: d.slug });
  for (const v of versions) add(v.season, { kind: "constitution", title: `Constitution version ${v.version}: ${v.changed}`, date: new Date(v.at).toISOString().slice(0, 10), detail: null, docSlug: null });
  for (const a of attempts) add(null, { kind: "attempt", title: `Not changed: Article ${a.motion.amendment.article} (${a.motion.text})`, date: a.date ?? "", detail: a.meeting, docSlug: a.slug });
  const seasons = [...bySeason.keys()].sort((x, y) => (x === "Earlier" ? 1 : y === "Earlier" ? -1 : y.localeCompare(x)));
  return { success: true as const, current, seasons: seasons.map((season) => ({ season, entries: bySeason.get(season)!.sort((x, y) => y.date.localeCompare(x.date)) })) };
}
