import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { needsAgreement, pauseActive, readCommunitySettings, type CommunityLabel } from "@/lib/organizations/community";

/**
 * Report 34.2 call 4 (B5.1c): in a community that asks for agreement, a member whose agreed version is behind the
 * published Code of conduct can keep reading but not post. Null when they can post (an organiser, or not a community).
 */
export async function communityPostBlock(orgId: string, userId: string): Promise<string | null> {
  const [r] = Array.from(await db.execute<{ type: string | null; settings: unknown; organiser: boolean; paused: string | null; agreed: number | null; current: number | null }>(sql`
    SELECT w.org_type AS type, w.org_settings AS settings,
      w.org_settings->'community'->'pauses'->${userId}::text->>'until' AS paused,
      (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.role IN ('owner', 'admin'))) AS organiser,
      (SELECT (m.view_prefs->'community'->'agreed'->>'version')::int FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid) AS agreed,
      (SELECT coalesce((d.settings->'org'->>'readVersion')::int, 0) FROM workspace_documents d WHERE d.workspace_id = w.id AND lower(d.filename) LIKE '%code of conduct%'
        AND d.published_version_id IS NOT NULL ORDER BY d.created_at LIMIT 1) AS current
    FROM workspaces w WHERE w.id = ${orgId}::uuid`));
  // Organisers set the rules: they post without agreeing to them (B5.1 live check).
  if (r?.type !== "community" || r.organiser) return null;
  // B5.2 (34.3): Pause posting, until its end time; reading goes on.
  if (pauseActive(r.paused ? { until: r.paused } : null, new Date())) return `Your posting here is paused until ${new Date(r.paused!).toUTCString().replace(" GMT", " UTC")}.`;
  if (r.current === null) return null;
  return needsAgreement(readCommunitySettings(r.settings).agreeRequired, Number(r.current), r.agreed === null ? null : Number(r.agreed))
    ? "Agree to the Code of conduct on the Overview to post." : null;
}

export type CommunityLogEntry = { at: string; by: string; action: "role_given" | "role_removed" | "hidden" | "paused" | "passed"; person?: string; label?: CommunityLabel; rule?: number | null; until?: string; caseLabel?: string };

/**
 * The activity log (34.3 layer 4, call 7): every role change and moderator action with its rule and who did it.
 * ponytail: newest 200 entries kept in org_settings.community.log (read with every org load) (one atomic append); a table once logs need search.
 */
export async function logCommunityAction(orgId: string, entry: Omit<CommunityLogEntry, "at">) {
  const e = { ...entry, at: new Date().toISOString() };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb)
    || jsonb_build_object('log', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(${JSON.stringify([e])}::jsonb || coalesce(org_settings->'community'->'log', '[]'::jsonb)) x LIMIT 200) t)))
    WHERE id = ${orgId}::uuid`);
}

/**
 * B5.3b (report 34.4 layer 15): reminders to everyone Going, Normal, the day before and about an hour before. Runs in
 * the hourly job; the windows overlap a little and the dedupe key makes each reminder send once.
 */
export async function notifyCommunityEventReminders() {
  const { createNotification } = await import("@/lib/notifications/service");
  const rows = Array.from(await db.execute<{ event_id: string; title: string; start: string; slug: string | null; org_id: string; user_id: string; kind: "day" | "hour" }>(sql`
    SELECT t.id AS event_id, t.title, t.type_fields->>'start' AS start, w.slug, w.id AS org_id, r.user_id,
      CASE WHEN (t.type_fields->>'start')::timestamptz <= now() + interval '75 minutes' THEN 'hour' ELSE 'day' END AS kind
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id JOIN community_rsvps r ON r.task_id = t.id AND r.state = 'going'
    WHERE t.item_type = 'event' AND t.type_fields->>'kind' = 'community' AND t.deleted_at IS NULL AND t.stage <> 'cancelled' AND w.deleted_at IS NULL
      AND ((t.type_fields->>'start')::timestamptz BETWEEN now() AND now() + interval '75 minutes'
        OR (t.type_fields->>'start')::timestamptz BETWEEN now() + interval '23 hours' AND now() + interval '25 hours')
    LIMIT 5000`));
  for (const r of rows) {
    const at = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(r.start));
    await createNotification({ recipientUserId: r.user_id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
      title: r.kind === "hour" ? `${r.title} starts soon (${at} UTC)` : `Tomorrow: ${r.title} (${at} UTC)`,
      href: `/org/${encodeURIComponent(r.slug ?? r.org_id)}?tab=sprints&event=${r.event_id}`, entityRefs: { projectId: r.org_id, projectSlug: r.slug },
      dedupeKey: `community-event:reminder:${r.kind}:${r.event_id}:${r.user_id}:${r.start}` }).catch(() => undefined);
  }
  return { sent: rows.length };
}

/**
 * B5.4c (report 34.5 layer 15, call 10): when a challenge prompt opens, the people who joined hear it, Normal, once a
 * day per challenge however many prompts opened. Hourly job step.
 */
export async function notifyChallengePrompts() {
  const { createNotification } = await import("@/lib/notifications/service");
  const rows = Array.from(await db.execute<{ master_id: string; title: string; prompt: string; slug: string | null; org_id: string; user_id: string }>(sql`
    SELECT DISTINCT ON (m.id, c.assignee_id) m.id AS master_id, m.title, p.title AS prompt, w.slug, w.id AS org_id, c.assignee_id AS user_id
    FROM challenge_prompts p JOIN tasks m ON m.id = p.master_id JOIN workspaces w ON w.id = m.workspace_id
    JOIN tasks c ON c.assignment_id = m.id AND c.deleted_at IS NULL AND c.assignee_id IS NOT NULL
    WHERE p.opens_at > now() - interval '75 minutes' AND p.opens_at <= now() AND m.deleted_at IS NULL AND w.deleted_at IS NULL
      AND m.assignment_settings->>'closedAt' IS NULL
    ORDER BY m.id, c.assignee_id, p.opens_at DESC LIMIT 5000`));
  const day = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    await createNotification({ recipientUserId: r.user_id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `New prompt in ${r.title}: ${r.prompt}`, href: `/org/${encodeURIComponent(r.slug ?? r.org_id)}?tab=tasks&view=challenges`,
      entityRefs: { projectId: r.org_id, projectSlug: r.slug }, dedupeKey: `challenge-prompt:${r.master_id}:${r.user_id}:${day}` }).catch(() => undefined);
  }
  return { sent: rows.length };
}
