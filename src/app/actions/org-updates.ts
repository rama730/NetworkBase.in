'use server';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { projectMembers, projects } from '@/lib/db/schema';
import { countAudience, readOrgUpdateContext, readPinnedOrgLine } from '@/lib/organizations/org-updates';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import type { UpdateAudience } from '@/lib/organizations/update-rules';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Org Updates extras (report §17.7–17.8): the pinned org line in child projects and New markers.

/** "📌 CSE-3A · Midterm moved…" at the top of a child project's Updates, for org people only. */
export async function readOrgPinnedLineAction(childProjectId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const [project] = await db.select({ id: projects.id, kind: projects.kind, parentId: projects.parentId, visibility: projects.visibility })
        .from(projects).where(and(eq(projects.id, childProjectId), isNull(projects.deletedAt))).limit(1);
    if (!project?.parentId) return null;
    const ctx = await readOrgUpdateContext(project, userId);
    return ctx ? readPinnedOrgLine(ctx, userId) : null;
}

/** Opening the org's Updates clears its New markers. */
export async function markOrgUpdatesSeenAction(orgId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false as const, error: 'Please log in.' };
    const marked = await db.update(projectMembers).set({ lastSeenUpdatesAt: new Date() })
        .where(and(eq(projectMembers.projectId, orgId), eq(projectMembers.userId, userId)))
        .returning({ id: projectMembers.projectId });
    return marked.length ? { success: true as const } : { success: false as const, error: 'Not a member of this organization.' };
}

/** The composer's preview line (report §17.3): how many people an announcement reaches. Org admins only. */
export async function countAnnouncementAudienceAction(orgId: string, audience: UpdateAudience | null): Promise<number | null> {
    const { userId } = await getViewerAuthContext();
    const role = await readViewerOrgRole(orgId, userId);
    if (role !== 'owner' && role !== 'admin') return null;
    return countAudience(orgId, audience);
}
