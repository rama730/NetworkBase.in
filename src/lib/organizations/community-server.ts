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
 * ponytail: newest 500 entries kept in org_settings.community.log (one atomic append); a table once logs need search.
 */
export async function logCommunityAction(orgId: string, entry: Omit<CommunityLogEntry, "at">) {
  const e = { ...entry, at: new Date().toISOString() };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb)
    || jsonb_build_object('log', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(${JSON.stringify([e])}::jsonb || coalesce(org_settings->'community'->'log', '[]'::jsonb)) x LIMIT 500) t)))
    WHERE id = ${orgId}::uuid`);
}
