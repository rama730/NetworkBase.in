import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';

import { jsonError, jsonSuccess, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { projectMembers, projects } from '@/lib/db/schema';
import { logger } from '@/lib/logger';

/**
 * What deleting the account takes with it, read before the person confirms: the projects they own and how many
 * other people work in each. Deleting an owner's account deletes those projects for everyone in them.
 */
export async function GET() {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) return auth.response ?? jsonError('Not authenticated', 401, 'UNAUTHORIZED');
    if (auth.extensionSessionId) return jsonError('This needs a browser session', 403, 'FORBIDDEN');

    try {
        const owned = await db
            .select({ id: projects.id, title: projects.title, slug: projects.slug })
            .from(projects)
            .where(and(eq(projects.ownerId, auth.user.id), isNull(projects.deletedAt)))
            .limit(50);
        const memberCounts = owned.length
            ? await db
                .select({ projectId: projectMembers.projectId, others: count() })
                .from(projectMembers)
                .where(and(inArray(projectMembers.projectId, owned.map((project) => project.id)), ne(projectMembers.userId, auth.user.id)))
                .groupBy(projectMembers.projectId)
            : [];
        const others = new Map(memberCounts.map((row) => [row.projectId, Number(row.others)]));
        return jsonSuccess(
            { projects: owned.map((project) => ({ ...project, otherMembers: others.get(project.id) ?? 0 })) },
            undefined,
            { headers: { 'Cache-Control': 'private, no-store' } },
        );
    } catch (error) {
        logger.warn('account.deletion-preflight.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
        return jsonError('Could not load your projects', 503, 'INTERNAL_ERROR');
    }
}
