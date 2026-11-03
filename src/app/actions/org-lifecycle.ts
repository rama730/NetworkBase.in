'use server';

import { revalidatePath } from 'next/cache';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { inngest } from '@/inngest/client';
import { db } from '@/lib/db';
import { profiles, workspaces } from '@/lib/db/schema';
import { getWorkspaceAccessById, writeBlockedMessage } from '@/lib/data/workspace-access';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { validateOrgHandle } from '@/lib/organizations/handle';
import { isOrgHandleAvailable } from '@/lib/organizations/join';
import { accountOrgLimit, lastActiveHereSince } from '@/lib/organizations/members';
import { archiveOrg, inviteBack, orgLifecyclePreview, restoreOrg, scheduleOrgDeletion, takeOverOrg, unarchiveOrg, ORG_DELETION_GRACE_DAYS } from '@/lib/organizations/lifecycle';
import { notifyOrg, orgHref, orgLabel } from '@/lib/organizations/notify';
import { takeoverState, type TakeoverState } from '@/lib/organizations/takeover-rules';
import { resolveSecurityStepUp } from '@/lib/security/step-up';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Archive, Duplicate, Delete and Restore (report §30.5): the owner's danger zone. Transfer lives in
// transferWorkspaceOwnership (admins only for orgs).

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: 'Only the owner can do this.' };

async function orgOwner(orgId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization' || !access.isOwner) return null;
    return { userId, access, slug: access.project.slug ?? null };
}

const touch = (slug: string | null, id: string) => {
    revalidatePath(`/org/${slug ?? id}`);
    revalidatePath(`/workspaces/${slug ?? id}`);
};

export async function readOrgLifecyclePreviewAction(orgId: string) {
    const owner = await orgOwner(orgId);
    if (!owner) return DENIED;
    return { success: true as const, preview: await orgLifecyclePreview(orgId, owner.userId), graceDays: ORG_DELETION_GRACE_DAYS };
}

export async function archiveOrgAction(orgId: string): Promise<{ success: true } | Failure> {
    const owner = await orgOwner(orgId);
    if (!owner) return DENIED;
    if (owner.access.writeBlocked) return { success: false, error: writeBlockedMessage(owner.access.writeBlocked) };
    await archiveOrg(orgId, owner.userId);
    touch(owner.slug, orgId);
    return { success: true };
}

export async function unarchiveOrgAction(orgId: string): Promise<{ success: true } | Failure> {
    const owner = await orgOwner(orgId);
    if (!owner) return DENIED;
    if (owner.access.project?.status !== 'archived') return { success: false, error: 'This organization is not archived.' };
    if (owner.access.writeBlocked && owner.access.writeBlocked !== 'archived') return { success: false, error: writeBlockedMessage(owner.access.writeBlocked) };
    await unarchiveOrg(orgId, owner.userId);
    touch(owner.slug, orgId);
    return { success: true };
}

const deleteSchema = z.object({ confirmHandle: z.string().trim().min(1).max(80), choices: z.record(z.string().uuid(), z.enum(['keep', 'delete'])).default({}) }).strict();

/** Type the handle to confirm (report §19.1): the owner's own workspaces are kept or deleted one by one; others are kept. */
export async function deleteOrgAction(orgId: string, input: z.input<typeof deleteSchema>): Promise<{ success: true; deleteAt: string } | Failure> {
    const owner = await orgOwner(orgId);
    if (!owner) return DENIED;
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Type the handle to confirm.' };
    if (owner.access.writeBlocked === 'deleting') return { success: false, error: 'This organization is already scheduled for deletion.' };
    if (owner.access.writeBlocked === 'suspended') return { success: false, error: writeBlockedMessage('suspended') };
    if (parsed.data.confirmHandle.toLowerCase() !== (owner.slug ?? '').toLowerCase()) return { success: false, error: "That isn’t this organization’s handle." };
    const { deleteAt } = await scheduleOrgDeletion(orgId, owner.userId, parsed.data.choices);
    touch(owner.slug, orgId);
    revalidatePath('/workspaces');
    return { success: true, deleteAt: deleteAt.toISOString() };
}

export async function restoreOrgAction(orgId: string): Promise<{ success: true } | Failure> {
    const owner = await orgOwner(orgId);
    if (!owner) return DENIED;
    if (!(await restoreOrg(orgId, owner.userId))) return { success: false, error: 'This organization is not scheduled for deletion.' };
    touch(owner.slug, orgId);
    return { success: true };
}

const duplicateSchema = z.object({
    title: z.string().trim().min(3).max(100),
    handle: z.string().trim().min(3).max(40),
    termStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    copy: z.object({ about: z.boolean(), docs: z.boolean(), files: z.boolean(), sprints: z.boolean(), assignments: z.boolean(), channels: z.boolean(), admins: z.boolean() }).strict(),
}).strict();

/** Duplicate (report §30.5): checked before it starts, then built in the background; the owner is told when ready. */
export async function duplicateOrgAction(orgId: string, input: z.input<typeof duplicateSchema>): Promise<{ success: true } | Failure> {
    const owner = await orgOwner(orgId);
    if (!owner) return DENIED;
    const parsed = duplicateSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Check the name, handle and start date.' };
    const handle = validateOrgHandle(parsed.data.handle);
    if (!handle.ok) return { success: false, error: handle.reason === 'reserved' ? 'That handle is reserved.' : 'Handles are 3–40 letters, numbers and dashes.' };
    if (!(await isOrgHandleAvailable(handle.handle))) return { success: false, error: 'That handle is taken.' };
    const [owned] = await db.select({ n: count() }).from(workspaces)
        .where(and(eq(workspaces.ownerId, owner.userId), eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt)));
    if ((owned?.n ?? 0) >= ORG_LIMITS.orgsOwnedPerUser) return { success: false, error: `You can own up to ${ORG_LIMITS.orgsOwnedPerUser} organizations. Contact support to raise this.` };
    try {
        await inngest.send({ name: 'org/duplicate.requested', data: { sourceId: orgId, actorId: owner.userId, options: { ...parsed.data, handle: handle.handle } } });
    } catch {
        return { success: false, error: 'Duplicating is unavailable right now. Try again in a minute.' };
    }
    return { success: true };
}

/** The wizard's first step (report §27.1 #3): say now, not at Create, when someone already owns the most allowed. */
export async function readOrgCreationLimitAction(): Promise<{ block: string | null }> {
    const { userId } = await getViewerAuthContext();
    return { block: userId ? await accountOrgLimit(db, userId, 'own') : null };
}

/** After a restore (report §19.1): invite one kept workspace back; its lead moves it in with one click. */
export async function inviteBackAction(orgId: string, projectId: string): Promise<{ success: true } | Failure> {
    const owner = await orgOwner(orgId);
    if (!owner || !z.string().uuid().safeParse(projectId).success) return DENIED;
    if (owner.access.writeBlocked) return { success: false, error: writeBlockedMessage(owner.access.writeBlocked) };
    return (await inviteBack(orgId, projectId, owner.userId)) ? { success: true } : { success: false, error: 'That workspace isn’t waiting to come back.' };
}

/** An owner or admin of this organization, with the take-over request as stored. */
async function ownershipViewer(orgId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId || !z.string().uuid().safeParse(orgId).success) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (access.project?.kind !== 'organization') return null;
    const role = access.isOwner ? 'owner' as const : access.memberRole === 'admin' ? 'admin' as const : access.memberRole === 'viewer' ? 'viewer' as const : 'member' as const;
    const [row] = await db.execute<{ owner_id: string; by: string | null; at: string | null; by_name: string | null; last_active: string | null }>(sql`
        SELECT w.owner_id, w.takeover_requested_by AS by, w.takeover_requested_at::text AS at, coalesce(p.full_name, p.username, 'An admin') AS by_name,
               (SELECT m.last_active_here_at::text FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = w.owner_id) AS last_active
        FROM workspaces w LEFT JOIN profiles p ON p.id = w.takeover_requested_by WHERE w.id = ${orgId}`);
    if (!row) return null;
    const request = row.by && row.at ? { by: row.by, byName: row.by_name ?? 'An admin', at: new Date(row.at) } : null;
    const state = takeoverState({ viewer: { id: userId, role }, ownerLastActiveHere: row.last_active ? new Date(row.last_active) : null, request, since: await lastActiveHereSince() });
    return { userId, access, role, ownerId: row.owner_id, state };
}

/** Settings → Management → Ownership (report §45.2): what this viewer may do about an owner who's been away. */
export async function readTakeoverAction(orgId: string): Promise<({ success: true } & TakeoverState) | Failure> {
    const viewer = await ownershipViewer(orgId);
    return viewer ? { success: true, ...viewer.state } : DENIED;
}

/** Ask to take over (report §45.2): the owner hears by email and notice, with 7 days to refuse. One request at a time. */
export async function askToTakeOverAction(orgId: string): Promise<{ success: true } | Failure> {
    const viewer = await ownershipViewer(orgId);
    if (!viewer || viewer.role !== 'admin') return DENIED;
    if (viewer.access.writeBlocked) return { success: false, error: writeBlockedMessage(viewer.access.writeBlocked) };
    if (viewer.state.state === 'asked_by_other') return { success: false, error: 'Someone has already asked. One request at a time.' };
    if (viewer.state.state !== 'can_ask') return { success: false, error: 'The owner has been active here in the last 30 days.' };
    const now = new Date();
    const updated = await db.update(workspaces).set({ takeoverRequestedBy: viewer.userId, takeoverRequestedAt: now })
        .where(and(eq(workspaces.id, orgId), isNull(workspaces.takeoverRequestedBy))).returning({ id: workspaces.id });
    if (!updated.length) return { success: false, error: 'Someone has already asked. One request at a time.' };
    const [org, [me]] = await Promise.all([orgLabel(orgId), db.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, viewer.userId)).limit(1)]);
    if (org) {
        const by = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(now.getTime() + 7 * 86_400_000));
        await notifyOrg({
            orgId, eventKey: 'org.lifecycle', actorId: viewer.userId, to: [viewer.ownerId], title: `${me?.name ?? 'An admin'} asked to take over ${org.title}. Refuse by ${by}.`,
            href: orgHref(org, '?tab=settings&section=org-management'), sourceEventId: `takeover-asked:${orgId}:${now.getTime()}`, email: { kind: 'org_ownership' },
        });
    }
    return { success: true };
}

/** The owner refuses (report §45.2): the request ends and the admin is told. */
export async function refuseTakeoverAction(orgId: string): Promise<{ success: true } | Failure> {
    const viewer = await ownershipViewer(orgId);
    if (!viewer || viewer.role !== 'owner' || viewer.state.state !== 'owner_can_refuse') return DENIED;
    const [before] = await db.select({ by: workspaces.takeoverRequestedBy }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    await db.update(workspaces).set({ takeoverRequestedBy: null, takeoverRequestedAt: null }).where(eq(workspaces.id, orgId));
    const org = await orgLabel(orgId);
    if (before?.by && org) {
        await notifyOrg({ orgId, eventKey: 'org.lifecycle', actorId: viewer.userId, to: [before.by], title: `The owner of ${org.title} refused your request to take over.`, href: orgHref(org, '?tab=settings&section=org-management'), sourceEventId: `takeover-refused:${orgId}:${Date.now()}` });
    }
    return { success: true };
}

/** Take over now (report §45.2): after 7 days with no refusal, with the identity check (decision 134). */
export async function takeOverNowAction(orgId: string): Promise<{ success: true; errorCode?: undefined } | (Failure & { errorCode?: 'STEP_UP_REQUIRED' })> {
    const viewer = await ownershipViewer(orgId);
    if (!viewer || viewer.role !== 'admin') return DENIED;
    if (viewer.access.writeBlocked) return { success: false, error: writeBlockedMessage(viewer.access.writeBlocked) };
    if (viewer.state.state === 'waiting') return { success: false, error: 'The owner has 7 days to refuse.' };
    if (viewer.state.state !== 'ready') return DENIED;
    const stepUp = await resolveSecurityStepUp(viewer.userId);
    if (!stepUp.ok) return { success: false, error: 'Confirm it’s you first.', errorCode: 'STEP_UP_REQUIRED' };
    const done = await takeOverOrg(orgId, viewer.userId, stepUp.payload?.method ?? null);
    if (!('ok' in done)) return done.error === 'denied' ? DENIED : { success: false, error: done.error ?? 'Couldn’t take over.' };
    touch(viewer.access.project?.slug ?? null, orgId);
    return { success: true };
}
