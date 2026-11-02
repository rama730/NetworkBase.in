import { sql, type SQL } from 'drizzle-orm';

import { workspaces } from '@/lib/db/schema';

/**
 * Report §30.3, §30.5: hidden by a platform admin, suspended or deleting projects and orgs (and the child projects of a
 * suspended or deleting org) leave Discover and search; an archived org leaves the feed. One rule for every Discover feed.
 */
export function discoverListedSql(): SQL<boolean> {
    return sql<boolean>`${workspaces.discoverHiddenAt} IS NULL AND ${workspaces.suspendedAt} IS NULL AND ${workspaces.deletionScheduledAt} IS NULL
            AND NOT (${workspaces.kind} = 'organization' AND ${workspaces.status} = 'archived')
            AND (${workspaces.parentId} IS NULL OR NOT EXISTS (SELECT 1 FROM workspaces o WHERE o.id = ${workspaces.parentId}
                AND (o.suspended_at IS NOT NULL OR o.deletion_scheduled_at IS NOT NULL)))`;
}

/** Decision 160: a new organization reaches Discover after 3+ members and 7+ days, or once verified (profile-rules.ts). */
export function orgQualifiesSql(): SQL<boolean> {
    return sql<boolean>`(${workspaces.kind} <> 'organization' OR ${workspaces.verifiedAt} IS NOT NULL OR (
            ${workspaces.createdAt} <= now() - interval '7 days'
            -- Spelled out: Drizzle writes a bare "id" in one-table queries, which here would mean m.id.
            AND (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = workspaces.id) >= 3
        ))`;
}

// ponytail: organizations already public before the indexing rule shipped stay indexed (report §41.4). Set to the
// day deploy 1a goes live.
const ORG_INDEX_RULE_SINCE = '2026-11-03T00:00:00Z';

/** Decision 69: the sitemap and page indexing follow Discover's rule, so the three can't disagree. */
export function orgIndexableSql(): SQL<boolean> {
    return sql<boolean>`(${orgQualifiesSql()} OR ${workspaces.createdAt} < ${ORG_INDEX_RULE_SINCE}::timestamptz)`;
}
