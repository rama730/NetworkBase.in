import { sql, type SQL } from 'drizzle-orm';

import { workspaces } from '@/lib/db/schema';
import { ORG_DISCOVER_MIN_MEMBERS, ORG_DISCOVER_MIN_WORKSPACES } from '@/lib/organizations/profile-rules';

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

/**
 * D7 (replaces decision 160): an organization reaches Discover once it has a tagline or description, and at least one
 * workspace or a second member — or once it's verified. Same rule as `orgDiscoverable` (profile-rules.ts).
 */
export function orgQualifiesSql(): SQL<boolean> {
    return sql<boolean>`(${workspaces.kind} <> 'organization' OR ${workspaces.verifiedAt} IS NOT NULL OR (
            coalesce(nullif(btrim(${workspaces.shortDescription}), ''), nullif(btrim(${workspaces.description}), '')) IS NOT NULL
            -- Spelled out: Drizzle writes a bare "id" in one-table queries, which here would mean m.id.
            AND ((SELECT count(*) FROM workspaces c WHERE c.parent_id = workspaces.id AND c.deleted_at IS NULL) >= ${ORG_DISCOVER_MIN_WORKSPACES}
                OR (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = workspaces.id) >= ${ORG_DISCOVER_MIN_MEMBERS})
        ))`;
}

// Organizations already public before the indexing rule shipped stay indexed (report §41.4). The rule shipped with
// deploy 1a, so its start is when that deploy's migration ran here; the date is the fallback if the journal is empty.
const ORG_INDEX_RULE_SINCE = sql`coalesce((SELECT min(j.applied_at) FROM app_migration_journal j WHERE j.tag = '0043_member_last_active_here'), '2026-11-03T00:00:00Z'::timestamptz)`;

/** Decision 69: the sitemap and page indexing follow Discover's rule, so the three can't disagree. */
export function orgIndexableSql(): SQL<boolean> {
    return sql<boolean>`(${orgQualifiesSql()} OR ${workspaces.createdAt} < ${ORG_INDEX_RULE_SINCE})`;
}
