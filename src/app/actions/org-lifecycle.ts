'use server';

import { revalidatePath } from 'next/cache';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { inngest } from '@/inngest/client';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { getWorkspaceAccessById, writeBlockedMessage } from '@/lib/data/workspace-access';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { validateOrgHandle } from '@/lib/organizations/handle';
import { isOrgHandleAvailable } from '@/lib/organizations/join';
import { archiveOrg, orgLifecyclePreview, restoreOrg, scheduleOrgDeletion, unarchiveOrg, ORG_DELETION_GRACE_DAYS } from '@/lib/organizations/lifecycle';
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
    return { success: true as const, preview: await orgLifecyclePreview(orgId), graceDays: ORG_DELETION_GRACE_DAYS };
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

const deleteSchema = z.object({ confirmHandle: z.string().trim().min(1).max(80), childMode: z.enum(['detach', 'delete']) }).strict();

/** Type the handle to confirm; child projects detach to their leads unless the owner deletes them too. */
export async function deleteOrgAction(orgId: string, input: z.input<typeof deleteSchema>): Promise<{ success: true; deleteAt: string } | Failure> {
    const owner = await orgOwner(orgId);
    if (!owner) return DENIED;
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Type the handle to confirm.' };
    if (owner.access.writeBlocked === 'deleting') return { success: false, error: 'This organization is already scheduled for deletion.' };
    if (owner.access.writeBlocked === 'suspended') return { success: false, error: writeBlockedMessage('suspended') };
    if (parsed.data.confirmHandle.toLowerCase() !== (owner.slug ?? '').toLowerCase()) return { success: false, error: "That isn’t this organization’s handle." };
    const { deleteAt } = await scheduleOrgDeletion(orgId, owner.userId, parsed.data.childMode);
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
    title: z.string().trim().min(2).max(80),
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
    const [owned] = await db.select({ n: count() }).from(projects)
        .where(and(eq(projects.ownerId, owner.userId), eq(projects.kind, 'organization'), isNull(projects.deletedAt)));
    if ((owned?.n ?? 0) >= ORG_LIMITS.orgsOwnedPerUser) return { success: false, error: `You can own up to ${ORG_LIMITS.orgsOwnedPerUser} organizations. Contact support to raise this.` };
    try {
        await inngest.send({ name: 'org/duplicate.requested', data: { sourceId: orgId, actorId: owner.userId, options: { ...parsed.data, handle: handle.handle } } });
    } catch {
        return { success: false, error: 'Duplicating is unavailable right now. Try again in a minute.' };
    }
    return { success: true };
}
