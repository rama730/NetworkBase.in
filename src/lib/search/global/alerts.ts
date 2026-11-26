import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";

import { countNewMatches, type SavedTab } from "./saved";
import { savedSearchHref } from "./saved-href";

const rows = <T>(result: unknown) => result as unknown as T[];
// ponytail: up to 500 due saved searches a run, oldest first; the rest wait a day. Upgrade: more runs if this grows past it.
const PER_RUN = 500;
export const QUERY_LOG_DAYS = 30;

export type DueAlert = { id: string; userId: string; query: string; tab: SavedTab; filters: Record<string, unknown>; lastNotifiedAt: string };

/**
 * Saved searches whose alert is due. An hour of slack, so a run that starts a little earlier than yesterday's still
 * sends (review 1). Nothing moves here: each row moves only once its own notice is sent (review 2).
 */
export async function collectDueAlerts(now: Date): Promise<DueAlert[]> {
    const due = rows<{ id: string; user_id: string; query: string; tab: SavedTab; filters: Record<string, unknown>; last_notified_at: string }>(await db.execute(sql`
        SELECT id, user_id, query, tab, filters, last_notified_at FROM saved_searches
        WHERE (notify = 'daily' AND last_notified_at <= ${now.toISOString()}::timestamptz - interval '23 hours')
           OR (notify = 'weekly' AND last_notified_at <= ${now.toISOString()}::timestamptz - interval '6 days 23 hours')
        ORDER BY last_notified_at LIMIT ${PER_RUN}`));
    return due.map((row) => ({ id: row.id, userId: row.user_id, query: row.query, tab: row.tab, filters: row.filters ?? {}, lastNotifiedAt: new Date(row.last_notified_at).toISOString() }));
}

/** One saved search: count what's new, send one notice, then move its window. A failure leaves it due for the next run. */
export async function sendAlert(alert: DueAlert, now: Date): Promise<"sent" | "nothing-new" | "failed"> {
    let count: number;
    try {
        count = await countNewMatches(alert.userId, alert.query, alert.tab, new Date(alert.lastNotifiedAt));
    } catch {
        return "failed";
    }
    if (count > 0) {
        const created = await createNotification({
            recipientUserId: alert.userId,
            kind: "saved_search_matches",
            category: "projects",
            title: `${count > 99 ? "99+" : count} new for “${alert.query}”`,
            body: "From a search you saved",
            href: savedSearchHref(alert.query, alert.tab, alert.filters),
            dedupeKey: `saved-search:${alert.id}:${now.toISOString().slice(0, 10)}`,
        }).then(() => true, () => false);
        if (!created) return "failed";
    }
    await db.execute(sql`UPDATE saved_searches SET last_notified_at = ${now.toISOString()}::timestamptz WHERE id = ${alert.id}::uuid`);
    return count > 0 ? "sent" : "nothing-new";
}

/** The search log keeps 30 days ("Trending near you"). */
export async function trimSearchLog(now: Date) {
    const [row] = rows<{ n: number }>(await db.execute(sql`
        WITH gone AS (DELETE FROM search_query_log WHERE created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${QUERY_LOG_DAYS}) RETURNING 1)
        SELECT count(*)::int AS n FROM gone`));
    return row?.n ?? 0;
}

/** Everything in one go (tests and a manual run); the Inngest job does the same in batches of steps. */
export async function runSavedSearchAlerts(now = new Date()) {
    const due = await collectDueAlerts(now);
    let sent = 0;
    for (const alert of due) if ((await sendAlert(alert, now)) === "sent") sent += 1;
    return { due: due.length, sent, cleared: await trimSearchLog(now) };
}
