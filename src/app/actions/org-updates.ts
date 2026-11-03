'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { workspaceMembers, workspaces, workspaceUpdates } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { countAudience, readOrgUpdateContext, readPinnedOrgLine, readSharedPins, readUnseenPeople } from '@/lib/organizations/org-updates';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { notifyAudienceWidened, notifyOrg, orgHref, orgLabel, remindedRecently } from '@/lib/organizations/notify';
import { logger } from '@/lib/logger';
import { orgGrant, type OrgAction } from '@/lib/organizations/permissions';
import { audienceChange, type UpdateAudience } from '@/lib/organizations/update-rules';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { UUID_RE } from '@/lib/validations/uuid';

// Org Updates extras (report §17.7–17.8): the pinned org line in child projects and New markers.

/** "📌 CSE-3A · Midterm moved…" at the top of a child project's Updates, for org people only. */
export async function readOrgPinnedLineAction(childProjectId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const [project] = await db.select({ id: workspaces.id, kind: workspaces.kind, parentId: workspaces.parentId, visibility: workspaces.visibility })
        .from(workspaces).where(and(eq(workspaces.id, childProjectId), isNull(workspaces.deletedAt))).limit(1);
    if (!project?.parentId) return null;
    const ctx = await readOrgUpdateContext(project, userId);
    return ctx ? readPinnedOrgLine(ctx, userId) : null;
}

/** Opening the org's Updates clears its New markers. */
export async function markOrgUpdatesSeenAction(orgId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return { success: false as const, error: 'Sign in.' };
    const marked = await db.update(workspaceMembers).set({ lastSeenUpdatesAt: new Date() })
        .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, userId)))
        .returning({ id: workspaceMembers.projectId });
    return marked.length ? { success: true as const } : { success: false as const, error: 'Not a member of this organization.' };
}

/** The composer's preview line (report §17.3): how many people an announcement reaches. Org admins only. */
export async function countAnnouncementAudienceAction(orgId: string, audience: UpdateAudience | null): Promise<number | null> {
    const { userId } = await getViewerAuthContext();
    const role = await readViewerOrgRole(orgId, userId);
    if (role !== 'owner' && role !== 'admin') return null;
    return countAudience(orgId, audience);
}

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: 'Only organization admins can do this.' };

/** An owner or admin acting on this organization's posts, per the permissions table; read-only organizations refuse writes. */
async function orgPostManager(orgId: string, action: OrgAction, mode: 'read' | 'write') {
    const { userId } = await getViewerAuthContext();
    if (!userId || !UUID_RE.test(orgId)) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || (mode === 'write' && access.writeBlocked)) return null;
    const role = access.isOwner ? 'owner' as const : access.memberRole === 'admin' ? 'admin' as const : null;
    if (!role || orgGrant(role, action) !== 'yes') return null;
    const org = await orgLabel(orgId);
    return org ? { userId, org } : null;
}

/** The organization's own live announcement, or null. */
async function orgAnnouncement(orgId: string, updateId: string) {
    if (!UUID_RE.test(updateId)) return null;
    const [row] = await db.select({ id: workspaceUpdates.id, content: workspaceUpdates.content }).from(workspaceUpdates)
        .where(and(eq(workspaceUpdates.id, updateId), eq(workspaceUpdates.projectId, orgId), eq(workspaceUpdates.updateType, 'announcement'), isNull(workspaceUpdates.deletedAt))).limit(1);
    return row ?? null;
}

/** "Seen by 32 of 40" → who hasn't (report §28.3): admins only. */
export async function readUnseenPeopleAction(orgId: string, updateId: string): Promise<{ success: true; people: Array<{ id: string; name: string }> } | Failure> {
    const viewer = await orgPostManager(orgId, 'see_class_overview', 'read');
    if (!viewer || !(await orgAnnouncement(orgId, updateId))) return DENIED;
    return { success: true, people: [...await readUnseenPeople(orgId, updateId)] };
}

/** Remind the people who haven't seen an announcement: once per 12 hours each, with an honest count (decision 60). */
export async function remindUnseenAction(orgId: string, updateId: string): Promise<{ success: true; reminded: number; skipped: number } | Failure> {
    const viewer = await orgPostManager(orgId, 'announce', 'write');
    const post = viewer ? await orgAnnouncement(orgId, updateId) : null;
    if (!viewer || !post) return DENIED;
    const unseen = (await readUnseenPeople(orgId, updateId)).map((p) => p.id);
    const subject = `remind-seen-${updateId}`;
    const recent = await remindedRecently(orgId, subject, unseen, 'announcements.posted');
    const send = unseen.filter((id) => !recent.has(id));
    const minute = Math.floor(Date.now() / 60_000);
    for (const userId of send) {
        await notifyOrg({
            orgId, eventKey: 'announcements.posted', actorId: viewer.userId, to: [userId],
            title: `Reminder from ${viewer.org.title}: ${post.content.replace(/\s+/g, ' ').slice(0, 120)}`,
            href: orgHref(viewer.org, `?tab=updates&updateId=${encodeURIComponent(updateId)}`),
            sourceEventId: `${subject}:${userId}:${minute}`, refs: { updateId },
        });
    }
    return { success: true, reminded: send.length, skipped: unseen.length - send.length };
}

/**
 * Hide from the organization (report §37.3, decision 100, DB6): a workspace's shared post leaves the organization's
 * feed and its pins; it stays in the workspace, and the workspace's lead is told.
 */
export async function hideSharedFromOrgAction(orgId: string, updateId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgPostManager(orgId, 'hide_shared_post', 'write');
    if (!viewer || !UUID_RE.test(updateId)) return DENIED;
    const hidden = await db.transaction(async (tx) => {
        const [post] = await tx.update(workspaceUpdates).set({ hiddenFromOrgAt: new Date(), hiddenFromOrgBy: viewer.userId })
            .where(and(eq(workspaceUpdates.id, updateId), isNull(workspaceUpdates.deletedAt), isNotNull(workspaceUpdates.sharedToOrgAt), isNull(workspaceUpdates.hiddenFromOrgAt),
                sql`${workspaceUpdates.projectId} IN (SELECT id FROM workspaces WHERE parent_id = ${orgId} AND deleted_at IS NULL)`))
            .returning({ projectId: workspaceUpdates.projectId });
        if (!post) return null;
        const [org] = await tx.select({ settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1).for('update');
        const pins = readSharedPins(org?.settings).filter((id) => id !== updateId);
        await tx.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('sharedPins', ${JSON.stringify(pins)}::jsonb)` }).where(eq(workspaces.id, orgId));
        const [child] = await tx.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, post.projectId)).limit(1);
        return child ?? null;
    });
    if (!hidden) return { success: false, error: 'This post isn’t in the organization’s feed.' };
    await notifyOrg({
        orgId, eventKey: 'org.lifecycle', actorId: viewer.userId, to: [hidden.ownerId],
        title: `Hidden from ${viewer.org.title}: a post from ${hidden.title} no longer shows in its feed. It stays in ${hidden.title}.`,
        href: `/workspaces/${encodeURIComponent(hidden.slug ?? hidden.id)}?tab=updates&updateId=${encodeURIComponent(updateId)}`,
        sourceEventId: `hide-shared:${updateId}`, refs: { updateId },
    });
    revalidatePath(orgHref(viewer.org));
    return { success: true };
}

/**
 * Change who sees an announcement after posting (report §37.3): widening only after the admin confirms (the
 * screen asks, then sends confirmedWider); narrowing applies at once.
 */
export async function setOrgUpdateAudienceAction(orgId: string, updateId: string, next: { audience: UpdateAudience | null; visibility: 'members' | 'public' }, confirmedWider: boolean): Promise<{ success: true; change: string } | Failure> {
    const viewer = await orgPostManager(orgId, 'announce', 'write');
    if (!viewer || !UUID_RE.test(updateId)) return DENIED;
    const [post] = await db.select({ audience: workspaceUpdates.audience, visibility: workspaceUpdates.visibility, content: workspaceUpdates.content, authorId: workspaceUpdates.authorId }).from(workspaceUpdates)
        .where(and(eq(workspaceUpdates.id, updateId), eq(workspaceUpdates.projectId, orgId), isNull(workspaceUpdates.deletedAt))).limit(1);
    if (!post) return { success: false, error: 'This post isn’t available.' };
    const roles = (next.audience?.roles ?? []).filter((r) => r === 'admin' || r === 'member' || r === 'viewer');
    const wanted = (next.audience?.projectIds ?? []).filter((id) => UUID_RE.test(id));
    const projectIds = wanted.length ? (await db.select({ id: workspaces.id }).from(workspaces)
        .where(and(eq(workspaces.parentId, orgId), inArray(workspaces.id, wanted), isNull(workspaces.deletedAt)))).map((r) => r.id) : [];
    const audience: UpdateAudience = { ...(roles.length ? { roles } : {}), ...(projectIds.length ? { projectIds } : {}) };
    const visibility = next.visibility === 'public' ? 'public' : 'members';
    const change = audienceChange({ audience: post.audience as UpdateAudience, visibility: post.visibility }, { audience, visibility });
    if ((change === 'wider' || change === 'mixed') && !confirmedWider) return { success: false, error: 'wider' };
    if (change !== 'same') await db.update(workspaceUpdates).set({ audience, visibility }).where(eq(workspaceUpdates.id, updateId));
    // The people a wider audience adds are told once (report §37.3, step 7 gap).
    if (change === 'wider' || change === 'mixed') {
        await notifyAudienceWidened({ orgId, updateId, actorId: viewer.userId, authorId: post.authorId, content: post.content, before: post.audience as UpdateAudience, after: audience })
            .catch((error) => logger.warn('org_updates.widened_notice_failed', { module: 'org-updates', updateId, error: error instanceof Error ? error.message : String(error) }));
    }
    revalidatePath(orgHref(viewer.org));
    return { success: true, change };
}
