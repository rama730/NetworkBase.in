"use server";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { syncWorkspaceChat } from "@/lib/messaging/integrations";
import { createNotification } from "@/lib/notifications/service";
import { chapterFlags, KIT_DOC_BUDGET, KIT_DOC_KEYS, kitSettings, proposalSchema, readChapterKit, readChapterSettings, type ChapterProposal, type KitDoc } from "@/lib/organizations/chapters";
import { pauseActive, readCommunitySettings } from "@/lib/organizations/community";
import { ritualSchema } from "@/lib/organizations/rituals";
import { getOrBuildWorkspaceDocPublishMetadata } from "@/lib/workspaces/doc";
import { generateJoinCode } from "@/lib/organizations/join-rules";
import { accountOrgLimit } from "@/lib/organizations/members";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";
import { generateWorkspaceKey } from "@/lib/workspace-key";

/**
 * Report 34.6 (plan B5.5a, M5 calls 1–4, 6–7): chapters. A member proposes a chapter; community organisers Approve or
 * Decline with a reason. Approving makes a community organization linked to its community (`org_settings.chapterOf`;
 * not the school link, which carries school behaviour), owned by the proposer with the co-organiser as an admin, at the
 * community's visibility, reading the community's Code of conduct. Members see the chapters; organisers see Needs a
 * co-organiser and Dormant (never a ranking; Dormant never closes anything). Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function community(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; title: string; settings: unknown; visibility: string; tz: string | null; chapter_of: string | null }>(sql`
    SELECT org_type AS type, slug, title, org_settings AS settings, visibility, time_zone AS tz, org_settings->>'chapterOf' AS chapter_of
    FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  // Chapters belong to a community, never to a chapter: there is no fourth level.
  if (w?.type !== "community" || w.chapter_of || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  const pause = (w.settings as { community?: { pauses?: Record<string, { until: string }> } } | null)?.community?.pauses?.[userId] ?? null;
  return { userId, slug: w.slug ?? orgId, title: w.title, organiser: a.isOwner || a.memberRole === "admin", settings: readChapterSettings(w.settings), raw: w, paused: pauseActive(pause, new Date()) };
}

const proposalsOf = (settings: unknown) => {
  const list = (settings as { community?: { proposals?: ChapterProposal[] } } | null)?.community?.proposals;
  return Array.isArray(list) ? list : [];
};

/** Propose a chapter (call 2): members (unless organisers set it to organisers only), not while paused; a co-organiser must be a member. */
export async function proposeChapterAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  const parsed = proposalSchema.safeParse(input);
  if (!ctx) return DENIED;
  if (ctx.settings.proposeBy === "organisers" && !ctx.organiser) return { success: false, error: "Only organisers start chapters here." };
  if (ctx.paused) return { success: false, error: "You can propose a chapter when your pause ends." };
  if (!parsed.success) return { success: false, error: "Give the chapter a name (3 or more letters), a kind and a place or topic." };
  const p = parsed.data;
  if (p.coOrganiserId) {
    const [co] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${p.coOrganiserId}::uuid AND role IN ('member', 'admin', 'owner')`));
    if (!co || p.coOrganiserId === ctx.userId) return { success: false, error: "The co-organiser is another member of the community." };
  }
  const proposal: ChapterProposal = { ...p, id: randomUUID(), by: ctx.userId, at: new Date().toISOString(), state: "proposed" };
  const ok = await db.transaction(async (tx) => {
    const [w] = Array.from(await tx.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid FOR UPDATE`));
    const list = proposalsOf(w?.settings);
    if (list.filter((x) => x.by === ctx.userId && x.state === "proposed").length >= 3) return false;
    const next = [proposal, ...list].slice(0, 200);
    await tx.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb) || jsonb_build_object('proposals', ${JSON.stringify(next)}::jsonb)) WHERE id = ${orgId}::uuid`);
    return true;
  });
  return ok ? { success: true } : { success: false, error: "You have 3 proposals waiting already." };
}

/** Chapters (members) and, for organisers, proposals and the flags. Members' own proposals show to them too. */
export async function readChaptersAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; title: string; slug: string | null; settings: unknown; created: string; members: number; organisers: number; last_activity: string | null; next_event: string | null; status: string; events_90d: number; open_reports: number }>(sql`
    SELECT c.id, c.title, c.slug, c.org_settings AS settings, c.created_at::text AS created, c.status,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = c.id AND m.role <> 'viewer') AS members,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = c.id AND m.role IN ('owner', 'admin')) AS organisers,
      greatest(
        (SELECT max(u.created_at) FROM workspace_updates u WHERE u.workspace_id = c.id AND u.deleted_at IS NULL),
        (SELECT max((t.type_fields->>'start')::timestamptz) FROM tasks t WHERE t.workspace_id = c.id AND t.item_type = 'event' AND t.deleted_at IS NULL AND t.type_fields->>'kind' = 'community' AND (t.type_fields->>'start')::timestamptz <= now()))::text AS last_activity,
      (SELECT min(t.type_fields->>'start') FROM tasks t WHERE t.workspace_id = c.id AND t.item_type = 'event' AND t.deleted_at IS NULL AND t.stage <> 'cancelled' AND t.type_fields->>'kind' = 'community' AND (t.type_fields->>'start')::timestamptz > now()) AS next_event,
      (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = c.id AND t.item_type = 'event' AND t.deleted_at IS NULL AND t.stage <> 'cancelled' AND t.type_fields->>'kind' = 'community'
        AND (t.type_fields->>'start')::timestamptz BETWEEN now() - interval '90 days' AND now()) AS events_90d,
      (SELECT count(*)::int FROM moderation_cases mc WHERE mc.org_id = c.id AND mc.state IN ('open', 'in_review') AND mc.merged_into IS NULL
        AND mc.routed_to = 'org' AND mc.severity <> 'urgent' AND coalesce((mc.snapshot->>'privateConversation')::boolean, false) = false) AS open_reports
    FROM workspaces c WHERE c.kind = 'organization' AND c.org_settings->>'chapterOf' = ${orgId} AND c.deleted_at IS NULL
    ORDER BY c.title LIMIT 500`));
  const now = new Date();
  const chapters = rows.map((r) => {
    const ch = (r.settings as { chapter?: { kind?: string; place?: string } } | null)?.chapter ?? {};
    const flags = chapterFlags(r.organisers, r.last_activity, r.created, now, ctx.settings.dormantDays);
    return { id: r.id, title: r.title, slug: r.slug, kind: ch.kind === "topic" ? "topic" as const : "local" as const, place: ch.place ?? null, members: r.members, nextEvent: r.next_event,
      closed: r.status === "archived",
      // Flags and organiser counts are for community organisers only (calls 6–7, 11).
      ...(ctx.organiser ? { organisers: r.organisers, lastActivity: r.last_activity, events90d: r.events_90d, openReports: r.open_reports, needsCoOrganiser: flags.needsCoOrganiser, dormant: flags.dormant } : {}) };
  });
  const all = proposalsOf(ctx.raw.settings);
  const proposals = all.filter((p) => p.state === "proposed" && (ctx.organiser || p.by === ctx.userId));
  return { success: true as const, organiser: ctx.organiser, canPropose: ctx.settings.proposeBy === "members" || ctx.organiser, chapters, proposals, settings: ctx.organiser ? ctx.settings : null,
    mine: all.filter((p) => p.by === ctx.userId && p.state !== "proposed").slice(0, 5) };
}

const decideSchema = z.object({ approve: z.boolean(), reason: z.string().trim().max(300).nullable() }).strict();

/** Approve or Decline (organisers, call 2). Approving makes the chapter; the proposer is told either way (Normal). */
export async function decideChapterProposalAction(orgId: string, proposalId: string, input: unknown): Promise<{ success: true; chapterId?: string } | Failure> {
  const ctx = await community(orgId);
  const parsed = decideSchema.safeParse(input);
  if (!ctx?.organiser || typeof proposalId !== "string" || !parsed.success) return DENIED;
  const { approve, reason } = parsed.data;
  if (!approve && !reason) return { success: false, error: "Say why, so the proposer knows." };
  const result = await db.transaction(async (tx) => {
    const [w] = Array.from(await tx.execute<{ settings: unknown; visibility: string; tz: string | null }>(sql`SELECT org_settings AS settings, visibility, time_zone AS tz FROM workspaces WHERE id = ${orgId}::uuid FOR UPDATE`));
    const list = proposalsOf(w?.settings);
    const p = list.find((x) => x.id === proposalId && x.state === "proposed");
    if (!p) return { error: "That proposal was already decided." } as const;
    let chapterId: string | null = null;
    if (approve) {
      // The proposer owns it (their 5-organization limit counts it); the co-organiser joins as an admin if still a member.
      const [stillIn] = Array.from(await tx.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${p.by}::uuid AND role IN ('member', 'admin', 'owner')`));
      if (!stillIn) return { error: "The proposer is no longer a member of the community." } as const;
      // Security review: someone paused in the community doesn't get a chapter to run meanwhile.
      const pauses = (w!.settings as { community?: { pauses?: Record<string, { until: string }> } } | null)?.community?.pauses ?? {};
      if (pauseActive(pauses[p.by] ?? null, new Date())) return { error: "The proposer’s posting is paused; decide when the pause ends." } as const;
      const limit = await accountOrgLimit(tx, p.by, "own");
      if (limit) return { error: "The proposer already owns 5 organizations, so this chapter can’t be theirs yet." } as const;
      const handle = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "chapter"}-${randomUUID().slice(0, 4)}`;
      // B5.5d: the chapter starts from the community's Chapter kit (frozen when organisers saved it).
      const kit = readChapterKit(w!.settings);
      const settings = { version: 1, chapterOf: orgId, chapter: { kind: p.kind, place: p.place }, ...kitSettings(kit, p.by, new Date()) };
      const [made] = Array.from(await tx.execute<{ id: string }>(sql`
        INSERT INTO workspaces (owner_id, title, slug, key, current_task_number, kind, org_type, visibility, status, org_settings, description, time_zone, join_code, join_code_enabled)
        VALUES (${p.by}::uuid, ${p.name}, ${handle}, ${`${generateWorkspaceKey(p.name)}${randomUUID().slice(0, 3).toUpperCase()}`}, 0, 'organization', 'community',
          ${w!.visibility}, 'active', ${JSON.stringify(settings)}::jsonb, ${ctx.settings.kitAbout || p.why || null}, ${w!.tz}, ${generateJoinCode()}, true)
        RETURNING id`));
      chapterId = made!.id;
      await tx.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${chapterId}::uuid, ${p.by}::uuid, 'owner')`);
      if (p.coOrganiserId) {
        await tx.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role)
          SELECT ${chapterId}::uuid, m.user_id, 'admin' FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${p.coOrganiserId}::uuid AND m.role IN ('member', 'admin', 'owner')
          ON CONFLICT DO NOTHING`);
      }
      for (const d of kit?.docs ?? []) {
        const meta = getOrBuildWorkspaceDocPublishMetadata(d.content);
        const [doc] = Array.from(await tx.execute<{ id: string }>(sql`
          INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${chapterId}::uuid, ${d.slug}, ${d.filename}, ${JSON.stringify(d.settings ?? {})}::jsonb)
          ON CONFLICT DO NOTHING RETURNING id`));
        if (!doc) continue;
        const [v] = Array.from(await tx.execute<{ id: string }>(sql`
          INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, excerpt, headings, quality_report, content_hash, change_summary, co_authors, created_by)
          VALUES (${chapterId}::uuid, ${doc.id}::uuid, 1, ${meta.content}, ${meta.excerpt}, ${JSON.stringify(meta.headings)}::jsonb, ${JSON.stringify(meta.qualityReport)}::jsonb, ${meta.contentHash},
            'From the Chapter kit', '[]'::jsonb, ${p.by}::uuid) RETURNING id`));
        await tx.execute(sql`UPDATE workspace_documents SET published_version_id = ${v!.id}::uuid WHERE id = ${doc.id}::uuid`);
      }
      await syncWorkspaceChat(tx as never, chapterId, null, "ensure_default");
    }
    const next = list.map((x) => (x.id === proposalId ? { ...x, state: approve ? "approved" as const : "declined" as const, reason: reason ?? null, chapterId } : x));
    await tx.execute(sql`UPDATE workspaces SET org_settings = org_settings || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb) || jsonb_build_object('proposals', ${JSON.stringify(next)}::jsonb)) WHERE id = ${orgId}::uuid`);
    return { p, chapterId } as const;
  });
  if ("error" in result) return { success: false, error: result.error! };
  await createNotification({ recipientUserId: result.p.by, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
    title: approve ? `Your chapter ${result.p.name} is approved` : `Your chapter ${result.p.name} wasn’t approved: ${reason}`,
    href: approve ? `/org/${encodeURIComponent(ctx.slug)}?tab=workspaces&view=chapters` : `/org/${encodeURIComponent(ctx.slug)}?tab=workspaces&view=chapters`,
    entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `chapter-proposal:${proposalId}` }).catch(() => undefined);
  return { success: true, chapterId: result.chapterId ?? undefined };
}

const settingsSchema = z.object({ proposeBy: z.enum(["members", "organisers"]), dormantDays: z.number().int().min(30).max(730), kitAbout: z.string().trim().max(2000) }).strict();

/** Settings → Chapters (organisers): who proposes, Dormant after, and the kit's About text for new chapters. */
export async function saveChapterSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  const parsed = settingsSchema.safeParse(input);
  if (!ctx?.organiser) return DENIED;
  if (!parsed.success) return { success: false, error: "Dormant after is 30 to 730 days." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb)
    || jsonb_build_object('chapters', ${JSON.stringify(parsed.data)}::jsonb)), updated_at = now() WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** Settings → Chapter kit (organisers): what's in the kit now, and the community's documents that can go in it. */
export async function readChapterKitAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx?.organiser) return DENIED;
  const kit = readChapterKit(ctx.raw.settings);
  const docs = Array.from(await db.execute<{ id: string; filename: string; size: number }>(sql`
    SELECT d.id, d.filename, length(v.content)::int AS size FROM workspace_documents d JOIN workspace_document_versions v ON v.id = d.published_version_id
    WHERE d.workspace_id = ${orgId}::uuid AND lower(d.filename) NOT LIKE '%code of conduct%' AND coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft'
    ORDER BY d.filename LIMIT 50`));
  return { success: true as const, budget: KIT_DOC_BUDGET, docs,
    kit: kit ? { savedAt: kit.savedAt, docs: kit.docs.map((d) => d.filename), docIds: kit.docs.map((d) => d.sourceId).filter((x): x is string => Boolean(x)), gettingStarted: kit.gettingStarted.length, rituals: kit.rituals.length } : null };
}

const kitSchema = z.object({ docIds: z.array(z.string().uuid()).max(5) }).strict();

/** Save the kit: freezes the chosen documents' published text, Getting started and rituals as they are now. */
export async function saveChapterKitAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  const parsed = kitSchema.safeParse(input);
  if (!ctx?.organiser || !parsed.success) return DENIED;
  const ids = [...new Set(parsed.data.docIds)];
  const rows = ids.length ? Array.from(await db.execute<{ id: string; slug: string; filename: string; content: string | null; settings: Record<string, unknown> | null }>(sql`
    SELECT d.id, d.slug, d.filename, v.content, d.settings FROM workspace_documents d JOIN workspace_document_versions v ON v.id = d.published_version_id
    WHERE d.workspace_id = ${orgId}::uuid AND d.id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND lower(d.filename) NOT LIKE '%code of conduct%'
      AND coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft'`)) : [];
  if (rows.length !== ids.length) return DENIED;
  // Review: only the document's layout travels — never who's invited, answers, motions or the community's own ids.
  const layout = (x: Record<string, unknown> | null) => Object.fromEntries(Object.entries(x ?? {}).filter(([k]) => KIT_DOC_KEYS.includes(k)));
  const docs: KitDoc[] = rows.map((r) => ({ sourceId: r.id, slug: r.slug, filename: r.filename, content: r.content ?? "", settings: layout(r.settings) }));
  if (docs.reduce((n, d) => n + d.content.length, 0) > KIT_DOC_BUDGET) return { success: false, error: "The kit’s documents can be up to 40,000 characters together." };
  const rituals = ((ctx.raw.settings as { community?: { rituals?: unknown[] } } | null)?.community?.rituals ?? [])
    .map((r) => { const { lastPostedFor: _l, createdAt: _c, savedBy: _s, resumedAt: _r, ...rest } = r as Record<string, unknown>; return ritualSchema.safeParse(rest); })
    .flatMap((r) => (r.success ? [r.data] : [])).slice(0, 10);
  const kit = { docs, gettingStarted: readCommunitySettings(ctx.raw.settings).gettingStarted, rituals, savedAt: new Date().toISOString() };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb)
    || jsonb_build_object('chapterKit', ${JSON.stringify(kit)}::jsonb)), updated_at = now() WHERE id = ${orgId}::uuid`);
  return { success: true };
}
