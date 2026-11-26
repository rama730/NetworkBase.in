import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { discoverListedSql } from "@/lib/discover/listed-sql";
import { escapeLikePattern, normalizeSearchQuery } from "@/lib/search/query";

import { isEmailQuery } from "./parse";
import { peopleFindableSql } from "./people-rule";

import type { SearchSkillCard } from "./types";

const rows = <T>(result: unknown) => result as unknown as T[];
/** "Trending" and suggestions need this many different people, so one person's searches never show (plan R3). */
export const TRENDING_MIN_PEOPLE = 3;

/** People near the viewer: anyone who shares a workspace or org with them (Trending and popular searches use only these). */
const nearCte = (viewerId: string) => sql`near AS (
    SELECT DISTINCT x.user_id FROM (
        SELECT w.owner_id AS user_id, w.id FROM workspaces w WHERE w.deleted_at IS NULL
          AND w.id IN (SELECT app_private.search_places(${viewerId}::uuid))
        UNION ALL
        SELECT m.user_id, m.workspace_id FROM workspace_members m WHERE m.workspace_id IN (SELECT app_private.search_places(${viewerId}::uuid))
    ) x WHERE x.user_id <> ${viewerId}::uuid)`;

/** The words are a skill (its name or an alias): how many people (that this viewer could find), workspaces and orgs use it. */
export async function skillCard(q: string, viewerId: string): Promise<SearchSkillCard | null> {
    const value = normalizeSearchQuery(q).toLowerCase();
    if (value.length < 2) return null;
    const result = await db.execute(sql`
        WITH s AS (
            SELECT sk.id, sk.name FROM skills sk
            WHERE lower(sk.name) = ${value} OR sk.canonical_key = ${value}
               OR EXISTS (SELECT 1 FROM skill_aliases a WHERE a.skill_id = sk.id AND a.normalized_alias = ${value})
            ORDER BY (lower(sk.name) = ${value}) DESC LIMIT 1
        )
        SELECT s.name,
          (SELECT count(*)::int FROM profiles p
             WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.skills) = 'array' THEN p.skills ELSE '[]'::jsonb END) v(x) WHERE lower(v.x) = lower(s.name))
               AND ${peopleFindableSql(viewerId)}) AS people,
          (SELECT count(*)::int FROM workspace_skills ws JOIN workspaces w ON w.id = ws.workspace_id
             WHERE ws.skill_id = s.id AND w.kind = 'workspace' AND w.visibility = 'public' AND w.deleted_at IS NULL AND w.status <> 'draft'
               AND w.discover_hidden_at IS NULL AND w.suspended_at IS NULL) AS workspaces,
          (SELECT count(*)::int FROM workspace_skills ws JOIN workspaces w ON w.id = ws.workspace_id
             WHERE ws.skill_id = s.id AND w.kind = 'organization' AND w.visibility = 'public' AND w.deleted_at IS NULL
               AND w.discover_hidden_at IS NULL AND w.suspended_at IS NULL) AS orgs
        FROM s`);
    const row = rows<SearchSkillCard>(result)[0];
    return row ? { name: row.name, people: Number(row.people), workspaces: Number(row.workspaces), orgs: Number(row.orgs) } : null;
}

/** Up to three ways to finish the words: skills, public organization names, and what several people near you searched. */
export async function suggestions(q: string, viewerId: string): Promise<string[]> {
    const value = normalizeSearchQuery(q).toLowerCase();
    if (value.length < 2 || isEmailQuery(value)) return [];
    const prefix = `${escapeLikePattern(value)}%`;
    const result = await db.execute(sql`
        WITH ${nearCte(viewerId)}
        SELECT word FROM (
            (SELECT lower(name) AS word, 1 AS src, length(name) AS len FROM skills WHERE name ILIKE ${prefix} ORDER BY length(name) LIMIT 3)
            UNION ALL
            (SELECT lower(title), 2, length(title) FROM workspaces
             WHERE kind = 'organization' AND visibility = 'public' AND deleted_at IS NULL AND discover_hidden_at IS NULL AND suspended_at IS NULL
               AND title ILIKE ${prefix} ORDER BY followers_count DESC LIMIT 3)
            UNION ALL
            (SELECT lower(query), 3, length(lower(query)) FROM search_query_log
             WHERE created_at > now() - interval '7 days' AND query ILIKE ${prefix} AND user_id IN (SELECT user_id FROM near)
             GROUP BY lower(query) HAVING count(DISTINCT user_id) >= ${TRENDING_MIN_PEOPLE} ORDER BY count(*) DESC LIMIT 3)
        ) t WHERE word <> ${value}
        ORDER BY src, len LIMIT 6`);
    return Array.from(new Set(rows<{ word: string }>(result).map((row) => row.word))).slice(0, 3);
}

/**
 * Nothing matched: the closest skill, organization or workspace name, or person, by trigram similarity (the indexes
 * exist from 0002/0005/0006). Each word is corrected on its own, so "reakt hyderabad" becomes "react hyderabad".
 */
export async function correctTypo(q: string, viewerId: string): Promise<string | null> {
    const words = normalizeSearchQuery(q).toLowerCase().split(" ").filter(Boolean).slice(0, 4);
    if (!words.length || words.every((word) => word.length < 3)) return null;
    const fixed: string[] = [];
    for (const word of words) {
        if (word.length < 3) { fixed.push(word); continue; }
        const result = await db.execute(sql`
            SELECT w, similarity(w, ${word}) AS score FROM (
                SELECT lower(s.name) AS w FROM skills s WHERE s.name % ${word}
                UNION ALL
                SELECT lower(t.word) FROM workspaces, regexp_split_to_table(workspaces.title, '\\s+') AS t(word)
                  WHERE ${word} <% workspaces.title AND workspaces.visibility = 'public' AND workspaces.deleted_at IS NULL
                    AND workspaces.status <> 'draft' AND ${discoverListedSql()}
                UNION ALL
                SELECT lower(t.word) FROM profiles p, regexp_split_to_table(p.full_name, '\\s+') AS t(word)
                  WHERE ${word} <% p.full_name AND ${peopleFindableSql(viewerId)}
            ) c
            WHERE length(w) >= 3 AND similarity(w, ${word}) > 0.3
            ORDER BY score DESC, w LIMIT 1`);
        fixed.push(rows<{ w: string }>(result)[0]?.w ?? word);
    }
    const next = fixed.join(" ");
    return next !== words.join(" ") ? next : null;
}

/** "Trending near you": what several people who share a workspace or org with you searched this week (plan R3). */
export async function trendingNear(viewerId: string, limit = 5): Promise<string[]> {
    const result = await db.execute(sql`
        WITH ${nearCte(viewerId)}
        SELECT lower(l.query) AS query FROM search_query_log l JOIN near ON near.user_id = l.user_id
        WHERE l.created_at > now() - interval '7 days'
        GROUP BY lower(l.query) HAVING count(DISTINCT l.user_id) >= ${TRENDING_MIN_PEOPLE}
        ORDER BY count(*) DESC, lower(l.query) LIMIT ${limit}`);
    return rows<{ query: string }>(result).map((row) => row.query);
}

/** The results page writes what was searched (normalized words only), for Trending. Best effort. */
export async function logSearch(viewerId: string, q: string) {
    const value = normalizeSearchQuery(q).toLowerCase();
    // An address someone typed is never kept (Phase 1 review): it could otherwise surface as a popular search.
    if (value.length < 2 || isEmailQuery(value) || value.includes("@")) return;
    await db.execute(sql`INSERT INTO search_query_log (user_id, query) VALUES (${viewerId}::uuid, ${value})`).catch(() => undefined);
}
