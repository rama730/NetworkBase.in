import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";

import { countNewMatches, type SavedTab } from "./saved";

const rows = <T>(result: unknown) => result as unknown as T[];
// ponytail: up to 500 due saved searches a run, one at a time. Upgrade: batches across runs if this grows past that.
const PER_RUN = 500;
export const QUERY_LOG_DAYS = 30;

type DueRow = { id: string; user_id: string; query: string; tab: SavedTab; filters: Record<string, unknown>; last_notified_at: string };
export type DueAlert = { savedId: string; userId: string; query: string; tab: SavedTab; filters: Record<string, unknown>; count: number };

/** Saved searches whose alert is due (daily: a day since the last, weekly: seven), with what's new since then. */
export async function collectDueAlerts(now: Date): Promise<DueAlert[]> {
    const due = rows<DueRow>(await db.execute(sql`
        SELECT id, user_id, query, tab, filters, last_notified_at FROM saved_searches
        WHERE (notify = 'daily' AND last_notified_at <= ${now.toISOString()}::timestamptz - interval '24 hours')
           OR (notify = 'weekly' AND last_notified_at <= ${now.toISOString()}::timestamptz - interval '7 days')
        ORDER BY last_notified_at LIMIT ${PER_RUN}`));
    const found: DueAlert[] = [];
    for (const row of due) {
        const count = await countNewMatches(row.user_id, row.query, row.tab, new Date(row.last_notified_at)).catch(() => 0);
        await db.execute(sql`UPDATE saved_searches SET last_notified_at = ${now.toISOString()}::timestamptz WHERE id = ${row.id}::uuid`);
        if (count > 0) found.push({ savedId: row.id, userId: row.user_id, query: row.query, tab: row.tab, filters: row.filters ?? {}, count });
    }
    return found;
}

export function savedSearchHref(query: string, tab: SavedTab, filters: Record<string, unknown>) {
    const params = new URLSearchParams({ q: query });
    if (tab !== "discover") params.set("tab", tab);
    for (const [key, value] of Object.entries(filters)) if (typeof value === "string" && value && !params.has(key)) params.set(key, value);
    return `/search?${params.toString()}`;
}

/** The daily job: alerts for saved searches, and the query log trimmed to 30 days ("Trending near you"). */
export async function runSavedSearchAlerts(now = new Date()) {
    const due = await collectDueAlerts(now);
    let sent = 0;
    for (const alert of due) {
        const result = await createNotification({
            recipientUserId: alert.userId,
            kind: "saved_search_matches",
            category: "projects",
            title: `${alert.count > 99 ? "99+" : alert.count} new for “${alert.query}”`,
            body: "From a search you saved",
            href: savedSearchHref(alert.query, alert.tab, alert.filters),
            dedupeKey: `saved-search:${alert.savedId}:${now.toISOString().slice(0, 10)}`,
        }).catch(() => null);
        if (result) sent += 1;
    }
    const cleared = rows<{ id: number }>(await db.execute(sql`
        DELETE FROM search_query_log WHERE created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${QUERY_LOG_DAYS}) RETURNING id`)).length;
    return { due: due.length, sent, cleared };
}
