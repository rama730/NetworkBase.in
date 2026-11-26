import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { escapeLikePattern, normalizeSearchQuery } from "@/lib/search/query";

import type { SearchSkillCard } from "./types";

const rows = <T>(result: unknown) => result as unknown as T[];
/** "Trending" and suggestions need this many different people, so one person's searches never show (plan R3). */
export const TRENDING_MIN_PEOPLE = 3;

/** The words are a skill (its name or an alias): how many people, workspaces and organizations use it. */
export async function skillCard(q: string): Promise<SearchSkillCard | null> {
    const value = normalizeSearchQuery(q).toLowerCase();
    if (value.length < 1) return null;
    const result = await db.execute(sql`
        WITH s AS (
            SELECT sk.id, sk.name FROM skills sk
            WHERE lower(sk.name) = ${value} OR sk.canonical_key = ${value}
               OR EXISTS (SELECT 1 FROM skill_aliases a WHERE a.skill_id = sk.id AND a.normalized_alias = ${value})
            ORDER BY (lower(sk.name) = ${value}) DESC LIMIT 1
        )
        SELECT s.name,
          (SELECT count(*)::int FROM profiles p WHERE p.deleted_at IS NULL AND p.onboarding_status = 'completed' AND p.visibility = 'public'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.skills) = 'array' THEN p.skills ELSE '[]'::jsonb END) v(x) WHERE lower(v.x) = lower(s.name))) AS people,
          (SELECT count(*)::int FROM workspace_skills ws JOIN workspaces w ON w.id = ws.workspace_id
             WHERE ws.skill_id = s.id AND w.kind = 'workspace' AND w.visibility = 'public' AND w.deleted_at IS NULL AND w.status <> 'draft') AS workspaces,
          (SELECT count(*)::int FROM workspace_skills ws JOIN workspaces w ON w.id = ws.workspace_id
             WHERE ws.skill_id = s.id AND w.kind = 'organization' AND w.visibility = 'public' AND w.deleted_at IS NULL) AS orgs
        FROM s`);
    const row = rows<SearchSkillCard>(result)[0];
    return row ? { name: row.name, people: Number(row.people), workspaces: Number(row.workspaces), orgs: Number(row.orgs) } : null;
}

/** Up to three ways to finish the words: skills, public organization names, and what several people searched. */
export async function suggestions(q: string): Promise<string[]> {
    const value = normalizeSearchQuery(q).toLowerCase();
    if (value.length < 2) return [];
    const prefix = `${escapeLikePattern(value)}%`;
    const result = await db.execute(sql`
        SELECT word FROM (
            (SELECT lower(name) AS word, 1 AS src, length(name) AS len FROM skills WHERE name ILIKE ${prefix} ORDER BY length(name) LIMIT 3)
            UNION ALL
            (SELECT lower(title), 2, length(title) FROM workspaces
             WHERE kind = 'organization' AND visibility = 'public' AND deleted_at IS NULL AND discover_hidden_at IS NULL AND suspended_at IS NULL
               AND title ILIKE ${prefix} ORDER BY followers_count DESC LIMIT 3)
            UNION ALL
            (SELECT lower(query), 3, length(lower(query)) FROM search_query_log
             WHERE created_at > now() - interval '7 days' AND query ILIKE ${prefix}
             GROUP BY lower(query) HAVING count(DISTINCT user_id) >= ${TRENDING_MIN_PEOPLE} ORDER BY count(*) DESC LIMIT 3)
        ) t WHERE word <> ${value}
        ORDER BY src, len LIMIT 6`);
    return Array.from(new Set(rows<{ word: string }>(result).map((row) => row.word))).slice(0, 3);
}

/**
 * Nothing matched: the closest skill, organization or workspace name, or person, by trigram similarity (the indexes
 * exist from 0002/0005/0006). Each word is corrected on its own, so "reakt hyderabad" becomes "react hyderabad".
 */
export async function correctTypo(q: string): Promise<string | null> {
    const words = normalizeSearchQuery(q).toLowerCase().split(" ").filter(Boolean).slice(0, 4);
    if (!words.length || words.every((word) => word.length < 3)) return null;
    const fixed: string[] = [];
    for (const word of words) {
        if (word.length < 3) { fixed.push(word); continue; }
        const result = await db.execute(sql`
            SELECT w, similarity(w, ${word}) AS score FROM (
                SELECT lower(s.name) AS w FROM skills s WHERE s.name % ${word}
                UNION ALL
                SELECT lower(t.word) FROM workspaces ws, regexp_split_to_table(ws.title, '\\s+') AS t(word)
                  WHERE ws.title % ${word} AND ws.visibility = 'public' AND ws.deleted_at IS NULL
                UNION ALL
                SELECT lower(t.word) FROM profiles p, regexp_split_to_table(p.full_name, '\\s+') AS t(word)
                  WHERE p.full_name % ${word} AND p.deleted_at IS NULL AND p.onboarding_status = 'completed' AND p.visibility = 'public'
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
        WITH near AS (
            SELECT DISTINCT x.user_id FROM (
                SELECT w.owner_id AS user_id, w.id FROM workspaces w WHERE w.deleted_at IS NULL
                UNION ALL SELECT m.user_id, m.workspace_id FROM workspace_members m
            ) x
            WHERE x.id IN (SELECT app_private.search_places(${viewerId}::uuid)) AND x.user_id <> ${viewerId}::uuid
        )
        SELECT lower(l.query) AS query FROM search_query_log l JOIN near ON near.user_id = l.user_id
        WHERE l.created_at > now() - interval '7 days'
        GROUP BY lower(l.query) HAVING count(DISTINCT l.user_id) >= ${TRENDING_MIN_PEOPLE}
        ORDER BY count(*) DESC, lower(l.query) LIMIT ${limit}`);
    return rows<{ query: string }>(result).map((row) => row.query);
}

/** The results page writes what was searched (normalized words only), for Trending. Best effort. */
export async function logSearch(viewerId: string, q: string) {
    const value = normalizeSearchQuery(q).toLowerCase();
    if (value.length < 2) return;
    await db.execute(sql`INSERT INTO search_query_log (user_id, query) VALUES (${viewerId}::uuid, ${value})`).catch(() => undefined);
}
