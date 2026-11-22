'use server';

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { profileContributions, profilePortfolioPins } from '@/lib/db/schema';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { isUuid } from '@/lib/validations/uuid';
import { markProfileCollaborationSummaryStale } from '@/lib/profile/collaboration';

type Result = { success: true } | { success: false; error: string };
const ROWS = <T,>(query: ReturnType<typeof sql>) => db.execute(query) as unknown as Promise<T[]>;

/**
 * Move up / Move down on the contributions timeline: the client sends the entries in their new order and each one's
 * position is stored. Only your own entries change; anything else in the list is ignored.
 */
export async function setContributionTimelineOrderAction(orderedIds: string[]): Promise<Result> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to reorder your contributions.' };
    if (!Array.isArray(orderedIds) || !orderedIds.length || orderedIds.length > 500 || !orderedIds.every((id) => typeof id === 'string' && isUuid(id))) {
        return { success: false, error: 'That order couldn’t be saved.' };
    }
    await db.transaction(async (tx) => {
        for (const [index, id] of orderedIds.entries()) {
            await tx.update(profileContributions).set({ timelineOrder: index })
                .where(and(eq(profileContributions.id, id), eq(profileContributions.profileId, userId)));
        }
        // Visitors read the cached summary: rebuild it so they see the new order.
        await markProfileCollaborationSummaryStale([userId], tx);
    });
    return { success: true };
}

/** Pin a workspace to the top of your Portfolio, or unpin it. Only workspaces you own or belong to. */
export async function setPortfolioPinAction(workspaceId: string, pinned: boolean): Promise<Result> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false, error: 'Sign in to pin workspaces.' };
    if (!isUuid(workspaceId)) return { success: false, error: 'That workspace couldn’t be found.' };
    if (!pinned) {
        await db.delete(profilePortfolioPins).where(and(eq(profilePortfolioPins.profileId, userId), eq(profilePortfolioPins.workspaceId, workspaceId)));
        await markProfileCollaborationSummaryStale([userId]);
        return { success: true };
    }
    const [member] = await ROWS<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ${workspaceId}::uuid AND w.deleted_at IS NULL
        AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid))) AS ok`);
    if (!member?.ok) return { success: false, error: 'You can pin only workspaces you’re in.' };
    await db.insert(profilePortfolioPins).values({ profileId: userId, workspaceId }).onConflictDoNothing();
    await markProfileCollaborationSummaryStale([userId]);
    return { success: true };
}
