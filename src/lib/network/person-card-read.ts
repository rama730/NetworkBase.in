import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { readableProfileIdentitySql, resolvePrivacyRelationships } from '@/lib/privacy/resolver';
import { logger } from '@/lib/logger';
import { personCardSkills, type PersonCardDetails } from './person-card';
import { publicPersonSkillsSql, visibleMutualCountSql } from './person-filter-sql';

/** One bounded batch per feed, never a lookup per rendered card. Unknown optional data stays absent. */
export async function readPersonCardDetails(viewerId: string, inputIds: string[]): Promise<Record<string, PersonCardDetails>> {
    const ids = [...new Set(inputIds)].filter(id => id !== viewerId).slice(0, 200);
    if (!ids.length) return {};
    try {
        const relationships = await resolvePrivacyRelationships(viewerId, ids);
        const permitted = ids.filter(id => relationships.get(id)?.canViewProfile);
        const result: Record<string, PersonCardDetails> = Object.fromEntries(ids.map(id => [id, {
            isLockedProfile: !relationships.get(id)?.canViewProfile,
            isUnavailable: !relationships.has(id) || relationships.get(id)?.blockedByViewer || relationships.get(id)?.blockedByTarget,
        }]));
        if (!permitted.length) return result;
        const rows = await db.execute<{ id: string; open: boolean; location: string | null; headline: string | null; skills: string[]; portfolio: PersonCardDetails['portfolio']; mutual: number }>(sql`
            WITH targets AS (SELECT jsonb_array_elements_text(${JSON.stringify(permitted)}::jsonb)::uuid AS id)
            SELECT profiles.id, profiles.open_to_collaborate AS open, profiles.location, profiles.headline,
                ${publicPersonSkillsSql()} AS skills,
                (SELECT jsonb_build_object('total', COALESCE(max(public_projects.total), 0), 'projects', COALESCE(jsonb_agg(jsonb_build_object('id', public_projects.id, 'title', public_projects.title, 'slug', public_projects.slug) ORDER BY public_projects.title), '[]'::jsonb),
                    'hasExternal', false)
                 FROM (SELECT eligible.*, count(*) OVER ()::int AS total FROM (SELECT DISTINCT pr.id, pr.title, pr.slug FROM profile_project_contributions c JOIN projects pr ON pr.id = c.project_id
                    WHERE c.profile_id = profiles.id AND c.visibility = 'public' AND c.deleted_at IS NULL AND c.role_kind <> 'viewer'
                    AND pr.visibility = 'public' AND pr.deleted_at IS NULL AND pr.status IN ('active', 'completed', 'archived')
                    UNION ALL SELECT ext.id, ext.project_title, NULL::text FROM profile_project_contributions ext WHERE ext.profile_id = profiles.id
                        AND ext.project_id IS NULL AND ext.visibility = 'public' AND ext.deleted_at IS NULL AND ext.role_kind <> 'viewer') eligible ORDER BY eligible.title, eligible.id LIMIT 4) public_projects) AS portfolio,
                ${visibleMutualCountSql(viewerId)} AS mutual
            FROM targets t JOIN profiles ON profiles.id = t.id WHERE ${readableProfileIdentitySql(viewerId)}
        `);
        for (const row of rows) result[row.id] = {
            openToCollaborate: row.open === true, skills: personCardSkills(row.skills), location: row.location, headline: row.headline,
            portfolio: row.portfolio, mutualConnections: Number(row.mutual), isLockedProfile: false, isUnavailable: false,
        };
        const returned = new Set(rows.map(row => row.id));
        for (const id of permitted) if (!returned.has(id)) result[id] = { isUnavailable: true, isLockedProfile: true };
        return result;
    } catch (error) {
        logger.warn('connections.card_details_failed', { error: error instanceof Error ? error.message : String(error) });
        return Object.fromEntries(ids.map(id => [id, { skills: [], portfolio: null, openToCollaborate: null, mutualConnections: null }]));
    }
}
