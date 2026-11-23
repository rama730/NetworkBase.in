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
