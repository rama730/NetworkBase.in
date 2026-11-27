"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { parseRules, readMembersSettings } from "@/lib/organizations/community";
import { communityLike } from "@/lib/organizations/kits";
import { logCommunityAction, passCaseToCommunity } from "@/lib/organizations/community-server";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { readOrgCases } from "@/lib/trust/console";
import { logModerationEvent } from "@/lib/trust/cases";
import { decideCase } from "@/lib/trust/decide";
import { REASON_RULES, type ReportReason } from "@/lib/trust/rules";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 34.3 (plan B5.2c, M2 call 5, 7): a community's Moderators (and its organisers) handle reports with Hide,
 * Pause posting (24 hours or 7 days) and Pass to organisers, each naming a rule of the Code of conduct and logged.
 * Removing and blocking stay with organisers (Settings → Moderation). A moderator never acts on a report they made,
 * on their own content, or on an organiser. Appeals use trust and safety. Agents never moderate. Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function moderator(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; title: string; settings: unknown; labels: unknown; parent: string | null; parent_slug: string | null }>(sql`
    SELECT w.org_type AS type, w.slug, w.title, w.org_settings AS settings,
      (SELECT p.id::text FROM workspaces p WHERE p.id::text = w.org_settings->>'chapterOf' AND p.deleted_at IS NULL) AS parent,
      (SELECT p.slug FROM workspaces p WHERE p.id::text = w.org_settings->>'chapterOf' AND p.deleted_at IS NULL) AS parent_slug,
      (SELECT m.view_prefs->'community'->'labels' FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.role IN ('member', 'admin', 'owner')) AS labels
    FROM workspaces w WHERE w.id = ${orgId}::uuid AND w.kind = 'organization' AND w.deleted_at IS NULL`));
  // B8.9: an Other organization with Members on (the Faith kit) moderates as a community does.
  if (!w || !communityLike(w.type, w.settings, "members")) return null;
  const organiser = a.isOwner || a.memberRole === "admin";
  const mod = Array.isArray(w.labels) && (w.labels as unknown[]).includes("moderator");
  if (!organiser && !(mod && a.isMember)) return null;
  return { userId, organiser, slug: w.slug ?? orgId, title: w.title, pauseHours: readMembersSettings(w.settings).pauseHours, parent: w.parent, parentSlug: w.parent_slug };
}

async function communityRules(orgId: string) {
  const [d] = Array.from(await db.execute<{ content: string | null }>(sql`
    SELECT v.content FROM workspace_documents d JOIN workspace_document_versions v ON v.id = d.published_version_id
    -- A chapter moderates under its community's Code of conduct (B5.5d).
    WHERE d.workspace_id = (SELECT coalesce((w.org_settings->>'chapterOf')::uuid, w.id) FROM workspaces w WHERE w.id = ${orgId}::uuid)
      AND lower(d.filename) LIKE '%code of conduct%' AND coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft'
    ORDER BY d.created_at LIMIT 1`));
  return parseRules(d?.content ?? "");
}

/** Moderation (moderators and organisers): open reports, minus ones they reported; moderators don't see organisers' or passed ones. */
export async function readCommunityModerationAction(orgId: string) {
  const me = await moderator(orgId);
  if (!me) return DENIED;
  // B5.5d: a community's organisers also see chapter cases passed up to them; a chapter stops seeing those.
  const cases = await readOrgCases(orgId, me.userId, me.organiser && !me.parent);
  const chapterNames = new Map(Array.from(await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM workspaces WHERE id = ANY(${`{${[...new Set(cases.map((c) => c.org_id).filter((x) => x !== orgId))].join(",")}}`}::uuid[])`)).map((r) => [r.id, r.title]));
  const ids = cases.map((c) => c.id);
  const skip = ids.length ? new Set(Array.from(await db.execute<{ id: string }>(sql`
    SELECT c.id FROM moderation_cases c WHERE c.id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND (
      EXISTS (SELECT 1 FROM content_reports r WHERE r.case_id = c.id AND r.reporter_id = ${me.userId}::uuid)
      OR (${!me.organiser} AND (
        EXISTS (SELECT 1 FROM moderation_events e WHERE e.case_id = c.id AND e.kind = 'passed_to_organisers')
        OR c.subject_id = (SELECT owner_id FROM workspaces WHERE id = ${orgId}::uuid)
        OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = c.subject_id AND m.role IN ('owner', 'admin')))))`)).map((r) => r.id)) : new Set<string>();
  return { success: true as const, organiser: me.organiser, pauseHours: me.pauseHours, pass: !me.organiser ? "organisers" as const : me.parent ? "community" as const : null, rules: await communityRules(orgId),
    cases: cases.filter((c) => !skip.has(c.id)).map((c) => ({ id: c.id, number: c.number, label: c.label, href: c.href, reports: c.reports, content: c.content?.slice(0, 280) ?? null, details: c.details?.slice(0, 280) ?? null, deadline: c.org_deadline_at, chapter: chapterNames.get(c.org_id) ?? null })) };
}

const actSchema = z.object({ choice: z.enum(["hide", "pause", "pass"]), rule: z.number().int().min(1).max(30), hours: z.union([z.literal(24), z.literal(168)]).optional() }).strict();

/** Hide, Pause posting or Pass to organisers (call 5, 7): one report, one rule, logged; the member hears which rule and when it ends. */
export async function moderateCommunityReportAction(orgId: string, caseId: string, input: unknown): Promise<{ success: true } | Failure> {
  const me = await moderator(orgId);
  const parsed = actSchema.safeParse(input);
  if (!me || !isLooseUuid(caseId) || !parsed.success) return DENIED;
  const { choice, rule, hours } = parsed.data;
  const rules = await communityRules(orgId);
  if (!rules.some((r) => r.n === rule)) return { success: false, error: "Pick a rule from the Code of conduct." };
  const view = await readCommunityModerationAction(orgId);
  if (!view.success || !view.cases.some((c) => c.id === caseId)) return DENIED;
  const [c] = Array.from(await db.execute<{ reason: ReportReason; subject_id: string | null; number: number }>(sql`
    SELECT reason, subject_id, number::int AS number FROM moderation_cases WHERE id = ${caseId}::uuid`));
  if (!c || c.subject_id === me.userId) return DENIED;
  const caseLabel = `#${c.number}`;

  if (choice === "pass" && me.organiser && me.parent) {
    // A chapter's organisers pass up to the community's organisers (B5.5d).
    await passCaseToCommunity(caseId, me.userId, { number: c.number, parent: me.parent, slug: me.parentSlug, chapter: me.title });
    await logCommunityAction(orgId, { by: me.userId, action: "passed", person: c.subject_id ?? undefined, rule, caseLabel });
    return { success: true };
  }
  if (choice === "pass") {
    await logModerationEvent(db, { caseId, actorId: me.userId, kind: "passed_to_organisers", data: { orgId, rule } });
    await logCommunityAction(orgId, { by: me.userId, action: "passed", person: c.subject_id ?? undefined, rule, caseLabel });
    const organisers = Array.from(await db.execute<{ id: string }>(sql`
      SELECT owner_id AS id FROM workspaces WHERE id = ${orgId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role = 'admin'`));
    for (const o of organisers) {
      if (o.id === me.userId) continue;
      await createNotification({ recipientUserId: o.id, actorUserId: me.userId, kind: "project_task_activity", category: "tasks", importance: "more",
        title: `A moderator passed report ${caseLabel} to organisers (rule ${rule})`, href: `/org/${encodeURIComponent(me.slug)}?tab=settings&settings=org-moderation`,
        entityRefs: { projectId: orgId, projectSlug: me.slug }, dedupeKey: `community-pass:${caseId}` }).catch(() => undefined);
    }
    return { success: true };
  }

  if (choice === "hide") {
    const r = await decideCase(caseId, { id: me.userId, scope: "org", orgId }, { outcome: "actioned", content: "hide", rule: REASON_RULES[c.reason].rule, message: `Hidden under rule ${rule} of the Code of conduct.` });
    if (!r.ok) return { success: false, error: r.error };
    await logCommunityAction(orgId, { by: me.userId, action: "hidden", person: c.subject_id ?? undefined, rule, caseLabel });
    revalidatePath(`/org/${me.slug}`);
    return { success: true };
  }

  // Pause posting: only a member who isn't an organiser, for a length organisers allow.
  if (!c.subject_id || !hours || !me.pauseHours.includes(hours)) return { success: false, error: "Pick how long the pause lasts." };
  // Review: only a member is paused, so check before the decision tells them so.
  const [member] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${c.subject_id}::uuid AND role = 'member'`));
  if (!member) return { success: false, error: "Only members can be paused." };
  const until = new Date(Date.now() + hours * 3_600_000);
  const untilText = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(until) + " UTC";
  // The case is decided as a warning that names the pause, so the member gets trust and safety's notice with Appeal.
  const r = await decideCase(caseId, { id: me.userId, scope: "org", orgId }, { outcome: "actioned", account: { action: "warning" }, rule: REASON_RULES[c.reason].rule,
    message: `Your posting in ${me.title} is paused until ${untilText} under rule ${rule} of the Code of conduct. You can still read.` });
  if (!r.ok) return { success: false, error: r.error };
  // ponytail: an appeal that reverses the warning doesn't lift the pause; it ends on its own (24 h or 7 days).
  const pause = { until: until.toISOString(), rule, by: me.userId, at: new Date().toISOString() };
  // Security review: pauses are kept on the community, keyed by person, so leaving and rejoining doesn't end one early.
  // Only a member (not an organiser) is paused; ended pauses are dropped on the next write.
  const [paused] = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE workspaces w SET org_settings = coalesce(w.org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(w.org_settings->'community', '{}'::jsonb)
      || jsonb_build_object('pauses', coalesce((SELECT jsonb_object_agg(k, v) FROM jsonb_each(coalesce(w.org_settings->'community'->'pauses', '{}'::jsonb)) e(k, v) WHERE (v->>'until')::timestamptz > now()), '{}'::jsonb)
        || jsonb_build_object(${c.subject_id}::text, ${JSON.stringify(pause)}::jsonb)))
    WHERE w.id = ${orgId}::uuid AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${c.subject_id}::uuid AND m.role = 'member')
    RETURNING ${c.subject_id}::text AS id`));
  if (paused) {
    await logCommunityAction(orgId, { by: me.userId, action: "paused", person: c.subject_id, rule, until: pause.until, caseLabel });
    await createNotification({ recipientUserId: c.subject_id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `Your posting in ${me.title} is paused until ${untilText} (rule ${rule})`, href: `/org/${encodeURIComponent(me.slug)}`,
      entityRefs: { projectId: orgId, projectSlug: me.slug }, dedupeKey: `community-pause:${orgId}:${c.subject_id}:${pause.until}` }).catch(() => undefined);
  }
  revalidatePath(`/org/${me.slug}`);
  return { success: true };
}
