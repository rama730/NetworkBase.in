import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { needsAgreement, readCommunitySettings } from "@/lib/organizations/community";

/**
 * Report 34.2 call 4 (B5.1c): in a community that asks for agreement, a member whose agreed version is behind the
 * published Code of conduct can keep reading but not post. Null when they can post (or it isn't a community).
 */
export async function communityPostBlock(orgId: string, userId: string): Promise<string | null> {
  const [r] = Array.from(await db.execute<{ type: string | null; settings: unknown; agreed: number | null; current: number | null }>(sql`
    SELECT w.org_type AS type, w.org_settings AS settings,
      (SELECT (m.view_prefs->'community'->'agreed'->>'version')::int FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid) AS agreed,
      (SELECT coalesce((d.settings->'org'->>'readVersion')::int, 0) FROM workspace_documents d WHERE d.workspace_id = w.id AND lower(d.filename) LIKE '%code of conduct%'
        AND d.published_version_id IS NOT NULL ORDER BY d.created_at LIMIT 1) AS current
    FROM workspaces w WHERE w.id = ${orgId}::uuid`));
  if (r?.type !== "community" || r.current === null) return null;
  return needsAgreement(readCommunitySettings(r.settings).agreeRequired, Number(r.current), r.agreed === null ? null : Number(r.agreed))
    ? "Agree to the Code of conduct on the Overview to post." : null;
}
