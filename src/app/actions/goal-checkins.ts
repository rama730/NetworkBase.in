"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { checkInDue, goalSettings } from "@/lib/workflows/goals";
import { zonedParts } from "@/lib/workflows/request-clock";

/** Report 38.12 part 8 (plan A5.1b): My work's "Check in on 3 key results", per workspace, for key results you own. */
export async function readMyGoalCheckInsAction() {
    const auth = await requireAuthenticatedUser();
    if (!auth.user) return { success: false as const, error: "Sign in to continue" };
    const rows = Array.from(await db.execute<{ workspace_id: string; ws_slug: string | null; ws_title: string | null; tz: string | null; goals: unknown; doc_slug: string; checked: string | null }>(sql`
        SELECT t.workspace_id, w.slug AS ws_slug, w.title AS ws_title, w.time_zone AS tz, w.workflow_settings->'goals' AS goals, d.slug AS doc_slug, t.type_fields->>'checkedInAt' AS checked
        FROM tasks t
        JOIN workspace_documents d ON d.id = t.source_doc_id
        JOIN workspaces w ON w.id = t.workspace_id AND w.deleted_at IS NULL
        WHERE t.item_type = 'key_result' AND t.stage = 'active' AND t.deleted_at IS NULL AND t.assignee_id = ${auth.user.id}::uuid
          AND NOT (d.settings ? 'closedAt')
          AND (w.owner_id = ${auth.user.id}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${auth.user.id}::uuid))
        LIMIT 500`));
    const byWs = new Map<string, { workspace: string; href: string; count: number }>();
    for (const r of rows) {
        const tz = r.tz || "UTC";
        if (!checkInDue(r.checked, zonedParts(new Date(), tz).day, goalSettings(r.goals).checkInDay, tz)) continue;
        const item = byWs.get(r.workspace_id) ?? { workspace: r.ws_title ?? "Workspace", href: `/workspaces/${encodeURIComponent(r.ws_slug || r.workspace_id)}?tab=docs&doc=${encodeURIComponent(r.doc_slug)}`, count: 0 };
        item.count += 1;
        byWs.set(r.workspace_id, item);
    }
    return { success: true as const, checkIns: [...byWs.values()] };
}

/** Report 38.14 W2 (plan A5.4): My work's off-sites you're invited to and haven't answered, still ahead. */
export async function readMyOffsiteInvitesAction() {
    const auth = await requireAuthenticatedUser();
    if (!auth.user) return { success: false as const, error: "Sign in to continue" };
    const me = auth.user.id;
    const rows = Array.from(await db.execute<{ slug: string; name: string | null; date_from: string; ws_slug: string | null; ws_id: string; ws_title: string | null }>(sql`
        SELECT d.slug, d.settings->>'offsiteTitle' AS name, d.settings->>'dateFrom' AS date_from, w.slug AS ws_slug, w.id AS ws_id, w.title AS ws_title
        FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
        WHERE d.settings->>'section' = 'offsite' AND d.settings->'invitedIds' ? ${me} AND NOT (coalesce(d.settings->'answers', '{}'::jsonb) ? ${me})
          AND d.settings->>'dateTo' >= to_char(now(), 'YYYY-MM-DD')
          AND (w.owner_id = ${me}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${me}::uuid))
        ORDER BY d.settings->>'dateFrom' LIMIT 20`));
    return { success: true as const, invites: rows.map((r) => ({ name: r.name ?? "Off-site", dateFrom: r.date_from, workspace: r.ws_title ?? "Workspace",
        href: `/workspaces/${encodeURIComponent(r.ws_slug || r.ws_id)}?tab=docs&doc=${encodeURIComponent(r.slug)}` })) };
}
