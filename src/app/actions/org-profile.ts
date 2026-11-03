'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { profileContributions, workspaceMembers } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
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
    const access = await getWorkspaceAccessById(orgId, userId);
    // Archiving prompts admins to verify, so an archived org still allows it; a suspended one doesn't.
    if (access.writeBlocked && access.writeBlocked !== 'archived') return null;
    return access.project?.kind === 'organization' && (access.isOwner || access.memberRole === 'admin') ? userId : null;
}

/** Verify one or many (Members → bulk "Verify contributions"). Only people in the org, and never your own entry. */
export async function verifyOrgContributionsAction(orgId: string, userIds: string[]): Promise<{ success: true; verified: number } | Failure> {
    const adminId = await orgAdmin(orgId);
    if (!adminId) return DENIED;
    const members = (await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, orgId), inArray(workspaceMembers.userId, userIds.slice(0, 2000))))).map((m) => m.userId).filter((id) => id !== adminId);
    if (members.length === 0) return { success: true, verified: 0 };
    const verified = await db.update(profileContributions)
        .set({ verifiedAt: new Date(), verifiedBy: adminId, verificationRevokedReason: null, updatedAt: new Date() })
        .where(and(eq(profileContributions.projectId, orgId), inArray(profileContributions.profileId, members), isNull(profileContributions.deletedAt)))
        .returning({ profileId: profileContributions.profileId });
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
    // Live-fix 41: nobody changes their own verification.
    if (userId === adminId) return { success: false, error: 'You can’t change your own verification. Ask another admin.' };
    const clean = reason.trim().slice(0, 500);
    if (!clean) return { success: false, error: 'Give a reason; the member sees it.' };
    const revoked = await db.update(profileContributions)
        .set({ verifiedAt: null, verifiedBy: null, verificationRevokedReason: clean, updatedAt: sql`now()` })
        .where(and(eq(profileContributions.projectId, orgId), eq(profileContributions.profileId, userId), isNull(profileContributions.deletedAt)))
        .returning({ profileId: profileContributions.profileId });
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
        SELECT c.id, p.id AS org_id, p.title, p.description, p.short_description AS tagline FROM profile_contributions c
        JOIN workspaces p ON p.id = c.workspace_id AND p.kind = 'organization' AND p.deleted_at IS NULL
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
            SELECT DISTINCT c.title FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.workspace_id = ${entry.org_id} AND m.deleted_at IS NULL
            LEFT JOIN task_team_members tm ON tm.task_id = c.id AND tm.user_id = ${entry.userId}
            WHERE c.deleted_at IS NULL AND (c.assignee_id = ${entry.userId} OR tm.user_id IS NOT NULL)
              AND c.status = 'done' AND c.review_status <> 'pending' ORDER BY 1 LIMIT 40`), // approved or finished, never waiting (decision 106)
        db.execute<{ title: string; unit: string | null }>(sql`
            SELECT p.title, (SELECT coalesce(r.title, r.role) FROM workspace_open_roles r WHERE r.id = m.unit_id) AS unit
            FROM workspace_members m JOIN workspaces p ON p.id = m.workspace_id AND p.parent_id = ${entry.org_id} AND p.deleted_at IS NULL
            WHERE m.user_id = ${entry.userId} ORDER BY p.title LIMIT 20`),
    ]);
    const lines = [
        ...(done.length ? ['Completed work:', ...done.map((d) => `- ${d.title}`), ''] : []),
        ...(children.length ? ['Projects:', ...children.map((c) => `- ${c.title}${c.unit ? ` (${c.unit})` : ''}`)] : []),
    ];
    return { success: true, text: lines.join('\n').trim() };
}


/** The write-up nudge goes away for good once dismissed (report §38.6, decision 107, DB5). Only your own entry. */
export async function dismissContributionNudgeAction(contributionId: string): Promise<{ success: true } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const done = await db.update(profileContributions).set({ nudgeDismissedAt: new Date() })
        .where(and(eq(profileContributions.id, contributionId), eq(profileContributions.profileId, userId), isNull(profileContributions.deletedAt)))
        .returning({ id: profileContributions.id });
    return done.length ? { success: true } : DENIED;
}
