'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { profileProjectContributions, projectMembers } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/workspace-access';
import { markProfileCollaborationSummaryStale } from '@/lib/profile/collaboration';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { namesOf, notifyOrg, orgLabel } from '@/lib/organizations/notify';

// Org contributions (report §24.5): org owners and admins verify members' org entries ("Verified by CSE-3A",
// role and dates only, never the text) and may revoke with a reason. The member hears either (report §26.3 I).

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };

async function orgAdmin(orgId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getProjectAccessById(orgId, userId);
    // Archiving prompts admins to verify, so an archived org still allows it; a suspended one doesn't.
    if (access.writeBlocked && access.writeBlocked !== 'archived') return null;
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
    const [org, names] = await Promise.all([orgLabel(orgId), namesOf([adminId])]);
    if (org && verified.length) {
        await notifyOrg({ orgId, eventKey: 'credit.changed', actorId: adminId, to: verified.map((v) => v.profileId), title: `${names.get(adminId) ?? 'An admin'} verified your role in ${org.title}`, href: '/profile', sourceEventId: `verified:${Date.now()}` });
    }
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
    const org = await orgLabel(orgId);
    if (org) await notifyOrg({ orgId, eventKey: 'credit.changed', actorId: adminId, to: [userId], title: `Your verification in ${org.title} was removed: ${clean}`, href: '/profile', sourceEventId: `revoked:${userId}:${Date.now()}` });
    return { success: true };
}

/** The viewer's own org entry, or null. */
async function ownOrgEntry(contributionId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const [row] = await db.execute<{ id: string; org_id: string; title: string; description: string | null; tagline: string | null }>(sql`
        SELECT c.id, p.id AS org_id, p.title, p.description, p.short_description AS tagline FROM profile_project_contributions c
        JOIN projects p ON p.id = c.project_id AND p.kind = 'organization' AND p.deleted_at IS NULL
        WHERE c.id = ${contributionId} AND c.profile_id = ${userId} AND c.deleted_at IS NULL`);
    return row ? { ...row, userId } : null;
}

/**
 * Story helpers for an org entry (report §24.5): Start from About pre-fills the org's description; Start from my work
 * lists the person's completed assignments and child projects. Both return editable text; nothing is saved here.
 */
export async function readOrgStoryStarterAction(contributionId: string, kind: 'about' | 'work'): Promise<{ success: true; text: string } | Failure> {
    const entry = await ownOrgEntry(contributionId);
    if (!entry) return DENIED;
    if (kind === 'about') return { success: true, text: (entry.description || entry.tagline || '').trim() };
    const [done, children] = await Promise.all([
        db.execute<{ title: string }>(sql`
            SELECT DISTINCT c.title FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.project_id = ${entry.org_id} AND m.deleted_at IS NULL
            LEFT JOIN task_team_members tm ON tm.task_id = c.id AND tm.user_id = ${entry.userId}
            WHERE c.deleted_at IS NULL AND (c.assignee_id = ${entry.userId} OR tm.user_id IS NOT NULL)
              AND (c.status = 'done' OR c.review_status = 'approved') ORDER BY 1 LIMIT 40`),
        db.execute<{ title: string; unit: string | null }>(sql`
            SELECT p.title, (SELECT coalesce(r.title, r.role) FROM project_open_roles r WHERE r.id = m.unit_id) AS unit
            FROM project_members m JOIN projects p ON p.id = m.project_id AND p.parent_id = ${entry.org_id} AND p.deleted_at IS NULL
            WHERE m.user_id = ${entry.userId} ORDER BY p.title LIMIT 20`),
    ]);
    const lines = [
        ...(done.length ? ['Completed work:', ...done.map((d) => `- ${d.title}`), ''] : []),
        ...(children.length ? ['Projects:', ...children.map((c) => `- ${c.title}${c.unit ? ` (${c.unit})` : ''}`)] : []),
    ];
    return { success: true, text: lines.join('\n').trim() };
}

/** The opt-in Work record (report §24.5): counts from platform records, off by default. */
export async function setWorkRecordAction(contributionId: string, show: boolean): Promise<{ success: true } | Failure> {
    const entry = await ownOrgEntry(contributionId);
    if (!entry) return DENIED;
    await db.update(profileProjectContributions).set({ showWorkRecord: show, updatedAt: new Date() }).where(eq(profileProjectContributions.id, entry.id));
    await markProfileCollaborationSummaryStale(entry.userId);
    return { success: true };
}
