'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { profileProjectContributions, projectMembers } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import { organizationsEnabled } from '@/lib/organizations/config';
import { markProfileCollaborationSummaryStale } from '@/lib/profile/collaboration';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Org contributions (report §24.5): org owners and admins verify members' org entries ("Verified by CSE-3A",
// role and dates only, never the text) and may revoke with a reason. Notifications arrive with P14.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don't have permission to do this." };

async function orgAdmin(orgId: string) {
    if (!organizationsEnabled()) return null;
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getProjectAccessById(orgId, userId);
    return access.project?.kind === 'organization' && (access.isOwner || access.memberRole === 'admin') ? userId : null;
}

/** Verify one or many (Members → bulk "Verify contributions"). Only people in the org, and never your own entry. */
export async function verifyOrgContributionsAction(orgId: string, userIds: string[]): Promise<{ success: true; verified: number } | Failure> {
    const adminId = await orgAdmin(orgId);
    if (!adminId) return DENIED;
    const members = (await db.select({ userId: projectMembers.userId }).from(projectMembers)
        .where(and(eq(projectMembers.projectId, orgId), inArray(projectMembers.userId, userIds.slice(0, 2000))))).map((m) => m.userId).filter((id) => id !== adminId);
    if (members.length === 0) return { success: true, verified: 0 };
    const verified = await db.update(profileProjectContributions)
        .set({ verifiedAt: new Date(), verifiedBy: adminId, verificationRevokedReason: null, updatedAt: new Date() })
        .where(and(eq(profileProjectContributions.projectId, orgId), inArray(profileProjectContributions.profileId, members), isNull(profileProjectContributions.deletedAt)))
        .returning({ profileId: profileProjectContributions.profileId });
    await markProfileCollaborationSummaryStale(verified.map((v) => v.profileId));
    return { success: true, verified: verified.length };
}

/** Revoke with a reason the member sees (report §24.5); editing the story never removes verification. */
export async function revokeOrgVerificationAction(orgId: string, userId: string, reason: string): Promise<{ success: true } | Failure> {
    const adminId = await orgAdmin(orgId);
    if (!adminId) return DENIED;
    const clean = reason.trim().slice(0, 500);
    if (!clean) return { success: false, error: 'Give a reason; the member sees it.' };
    const revoked = await db.update(profileProjectContributions)
        .set({ verifiedAt: null, verifiedBy: null, verificationRevokedReason: clean, updatedAt: sql`now()` })
        .where(and(eq(profileProjectContributions.projectId, orgId), eq(profileProjectContributions.profileId, userId), isNull(profileProjectContributions.deletedAt)))
        .returning({ profileId: profileProjectContributions.profileId });
    if (!revoked.length) return { success: false, error: 'That person has no entry for this organization.' };
    await markProfileCollaborationSummaryStale(userId);
    return { success: true };
}
