"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { partOn } from "@/lib/organizations/kits";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 37.2 (plan B8.5, the Nonprofit kit): an Other organization's board meetings (17.5's Board meeting with motions,
 * votes, quorum and approved minutes) held in its own Documents. Members see the upcoming and recent ones; owner and
 * admins plan them. Leaders-only documents stay with leaders.
 */
export async function readBoardMeetingsAction(orgId: string) {
  if (!isLooseUuid(orgId)) return { success: false as const, error: "You can’t do that here." };
  const { userId } = await getViewerAuthContext();
  if (!userId) return { success: false as const, error: "You can’t do that here." };
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown }>(sql`SELECT org_type AS type, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  // B8.6: with Meetings on (the Event team kit) every meeting shows; with only Board meetings, the board's.
  const all = partOn(w?.settings, "meetings");
  if (w?.type !== "other" || !(all || partOn(w.settings, "boardMeetings")) || !a.canRead || !(a.isOwner || a.isMember)) return { success: false as const, error: "You can’t do that here." };
  const leader = a.isOwner || a.memberRole === "admin";
  const rows = Array.from(await db.execute<{ slug: string; title: string; starts: string | null; approved: boolean }>(sql`
    SELECT slug, coalesce(settings->>'meetingTitle', regexp_replace(filename, '\.md$', '', 'i')) AS title, settings->>'startsAt' AS starts, settings ? 'approvedAt' AS approved
    FROM workspace_documents WHERE workspace_id = ${orgId}::uuid AND settings->>'section' = 'meetings' AND (${all} OR settings->>'kind' = 'board')
      AND (${leader} OR coalesce(settings->>'visibilityOverride', '') <> 'leaders_only')
    ORDER BY (settings->>'startsAt')::timestamptz DESC NULLS LAST LIMIT 12`));
  return { success: true as const, all, canPlan: leader && !a.writeBlocked, meetings: rows.map((r) => ({ slug: r.slug, title: r.title, startsAt: r.starts, approved: r.approved })) };
}
