import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { isUuid } from "@/lib/messaging/server";
import { normalizeSearchQuery } from "@/lib/search/query";

import { searchMessageHits, searchPeople, searchPlaces, searchPosts } from "./kinds";
import type { SearchHit } from "./types";

export type SavedTab = "discover" | "people" | "msgs" | "goto";
export type SavedNotify = "weekly" | "daily" | "off";
export type SavedSearch = { id: string; query: string; tab: SavedTab; filters: Record<string, unknown>; notify: SavedNotify; newCount: number };

export const MAX_SAVED_SEARCHES = 20;
const rows = <T>(result: unknown) => result as unknown as T[];


/**
 * Matches made after `since`, with the same rule as the box and the page (Review Focus 4), reading only the kinds the
 * saved tab shows (review 3): no people or message search for a Discover search, no skill card or suggestions.
 */
export async function countNewMatches(viewerId: string, query: string, tab: SavedTab, since: Date): Promise<number> {
    const q = normalizeSearchQuery(query);
    if (q.length < 2) return 0;
    const reads: Array<Promise<SearchHit[]>> = tab === "discover"
        ? [searchPlaces(viewerId, q, "organization", 60), searchPlaces(viewerId, q, "workspace", 60), searchPosts(viewerId, q, 12)]
        : tab === "people" ? [searchPeople(viewerId, q, 60)]
            : tab === "msgs" ? [searchMessageHits(viewerId, q, 50)] : [];
    // ponytail: the NEW count ignores the saved filters and counts the first 60 of each kind. Upgrade: filter server side.
    const found = (await Promise.all(reads)).flat();
    return found.filter((hit) => hit.createdAt && new Date(hit.createdAt) > since).length;
}

/** Your saved searches, newest first, each with what's new since you last opened it (capped at 99). */
export async function listSavedSearches(viewerId: string, limit = 5): Promise<SavedSearch[]> {
    const found = rows<{ id: string; query: string; tab: SavedTab; filters: Record<string, unknown>; notify: SavedNotify; last_seen_at: string }>(await db.execute(sql`
        SELECT id, query, tab, filters, notify, last_seen_at FROM saved_searches WHERE user_id = ${viewerId}::uuid ORDER BY created_at DESC LIMIT ${limit}`));
    return Promise.all(found.map(async (row) => ({
        id: row.id, query: row.query, tab: row.tab, filters: row.filters ?? {}, notify: row.notify,
        newCount: Math.min(99, await countNewMatches(viewerId, row.query, row.tab, new Date(row.last_seen_at)).catch(() => 0)),
    })));
}

export async function saveSearch(viewerId: string, input: { query: string; tab: SavedTab; filters: Record<string, unknown>; notify: SavedNotify }):
    Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const query = normalizeSearchQuery(input.query);
    if (!query) return { ok: false, error: "Type something to save" };
    const filters = JSON.stringify(input.filters ?? {});
    return db.transaction(async (tx) => {
        const existing = rows<{ id: string }>(await tx.execute(sql`
            SELECT id FROM saved_searches WHERE user_id = ${viewerId}::uuid AND lower(query) = lower(${query}) AND tab = ${input.tab} AND filters = ${filters}::jsonb`))[0];
        if (existing) {
            await tx.execute(sql`UPDATE saved_searches SET notify = ${input.notify} WHERE id = ${existing.id}::uuid`);
            return { ok: true as const, id: existing.id };
        }
        // Counted under a row lock on the person, so two saves at once can't both pass the cap.
        await tx.execute(sql`SELECT 1 FROM profiles WHERE id = ${viewerId}::uuid FOR UPDATE`);
        const [count] = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM saved_searches WHERE user_id = ${viewerId}::uuid`));
        if ((count?.n ?? 0) >= MAX_SAVED_SEARCHES) return { ok: false as const, error: `You can keep ${MAX_SAVED_SEARCHES} saved searches. Remove one to save this.` };
        const [row] = rows<{ id: string }>(await tx.execute(sql`
            INSERT INTO saved_searches (user_id, query, tab, filters, notify) VALUES (${viewerId}::uuid, ${query}, ${input.tab}, ${filters}::jsonb, ${input.notify}) RETURNING id`));
        return { ok: true as const, id: row!.id };
    });
}

const own = async (statement: ReturnType<typeof sql>) => rows<{ id: string }>(await db.execute(statement)).length > 0;

export async function setSavedNotify(viewerId: string, id: string, notify: SavedNotify) {
    if (!isUuid(id)) return false;
    return own(sql`UPDATE saved_searches SET notify = ${notify} WHERE id = ${id}::uuid AND user_id = ${viewerId}::uuid RETURNING id`);
}

export async function markSavedSeen(viewerId: string, id: string) {
    if (!isUuid(id)) return false;
    return own(sql`UPDATE saved_searches SET last_seen_at = now() WHERE id = ${id}::uuid AND user_id = ${viewerId}::uuid RETURNING id`);
}

export async function deleteSavedSearch(viewerId: string, id: string) {
    if (!isUuid(id)) return false;
    return own(sql`DELETE FROM saved_searches WHERE id = ${id}::uuid AND user_id = ${viewerId}::uuid RETURNING id`);
}
