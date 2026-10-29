import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';

import { jsonError, jsonSuccess, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { workspaceMembers, workspaces } from '@/lib/db/schema';
import { logger } from '@/lib/logger';

/**
 * What deleting the account takes with it, read before the person confirms: the projects they own and how many
 * other people work in each. Deleting an owner's account deletes those projects for everyone in them.
 */
export async function GET() {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) return auth.response ?? jsonError('Sign in to continue', 401, 'UNAUTHORIZED');
    if (auth.extensionSessionId) return jsonError('This needs a browser session', 403, 'FORBIDDEN');

    try {
        const owned = await db
            .select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, kind: workspaces.kind, parentId: workspaces.parentId })
            .from(workspaces)
            .where(and(eq(workspaces.ownerId, auth.user.id), isNull(workspaces.deletedAt)))
            .limit(50);
        const memberCounts = owned.length
            ? await db
                .select({ projectId: workspaceMembers.projectId, others: count() })
                .from(workspaceMembers)
                .where(and(inArray(workspaceMembers.projectId, owned.map((project) => project.id)), ne(workspaceMembers.userId, auth.user.id)))
                .groupBy(workspaceMembers.projectId)
            : [];
        const others = new Map(memberCounts.map((row) => [row.projectId, Number(row.others)]));
        return jsonSuccess(
            // Orgs block deletion; child projects pass to a new lead instead of going (report §30.7).
            { projects: owned.map(({ parentId, ...project }) => ({ ...project, handover: Boolean(parentId), otherMembers: others.get(project.id) ?? 0 })) },
            undefined,
            { headers: { 'Cache-Control': 'private, no-store' } },
        );
    } catch (error) {
        logger.warn('account.deletion-preflight.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
        return jsonError('Couldn’t load your workspaces', 503, 'INTERNAL_ERROR');
    }
}
