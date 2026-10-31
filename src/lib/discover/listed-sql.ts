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
