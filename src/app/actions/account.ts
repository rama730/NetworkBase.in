'use server';

import { db } from "@/lib/db";
import {
    profiles,
    projects,
    projectMembers,
    accountDeletions,
    profileAuditEvents,
    projectNodeEvents,
} from "@/lib/db/schema";
import { createClient } from '@/lib/supabase/server';
import { eq, or, and, inArray, isNull, sql, desc, } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { resolveSecurityStepUp } from '@/lib/security/step-up';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import { z } from 'zod';
import { cancelAccountDeletionForUser } from '@/lib/account/deletion';
import { syncProjectChat } from '@/lib/messaging/integrations';
import { queueSecurityEmail } from '@/lib/email/security-queue';
import { recordSecurityEventFromHeaders } from '@/lib/security/audit-from-headers';

// ============================================================================
// ACCOUNT DELETION
// ============================================================================
// Scheduling lives behind /api/v1/account/delete (fresh step-up required) and
// src/lib/account/deletion.ts; it is deliberately not a server action (AUTH-006).

/**
 * Cancel a pending account deletion and reactivate the profile with the
 * visibility it had before (SEC-002). Too late once the destructive phase ran.
 */
export async function cancelAccountDeletion(): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }
        // A cancel is cheap but it undoes a deletion: a stolen session shouldn't be able to flip it back and forth.
        const limit = await consumeRateLimit(`account-cancel-deletion:${user.id}`, 10, 3600);
        if (!limit.allowed) return { success: false, error: 'Too many attempts. Please try again later.' };
        const outcome = await cancelAccountDeletionForUser(user.id);
        if (outcome === 'not_found') return { success: false, error: 'No pending deletion found' };
        if (outcome === 'too_late') return { success: false, error: 'Account deletion is already being finalized' };
        revalidatePath('/');
        await recordSecurityEventFromHeaders({ userId: user.id, eventType: 'account_deletion_cancelled' });
        await queueSecurityEmail(user.id, 'account_deletion_cancelled');
        return { success: true };
    } catch (error) {
        logger.error('account.cancel-deletion.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Failed to cancel account deletion' };
    }
}

// ============================================================================
// EXECUTE HARD DELETE
// ============================================================================
//
// SEC-C3: the destructive finalizer now lives in `src/lib/account/hard-delete`
// so it is NEVER exposed as a 'use server' RPC action. Only the Inngest cron
// imports it, and every call must carry a signed job-request token that binds
// the request to a (userId, deletionId) pair.

// ============================================================================
// TRANSFER PROJECT OWNERSHIP
// ============================================================================

/**
 * Transfer ownership of a project to another user (must be a project member).
 * Used during the deletion wizard to preserve team projects.
 *
 * SEC-C4: transferring ownership can be weaponised to hand a project to a
 * compromised account before it is hard-deleted, effectively destroying the
 * original owner's work. Hardening:
 *   - per-user rate limit to cap damage from a stolen session;
 *   - step-up auth required (recent password / TOTP / recovery code);
 *   - `SELECT ... FOR UPDATE` on the project row so concurrent owner mutations
 *     can't race the ownership check;
 *   - audit entry on the original owner AND the new owner so either party can
 *     trace the transfer later.
 */
const transferProjectOwnershipSchema = z.object({
    projectId: z.string().uuid('projectId must be a valid UUID'),
    newOwnerId: z.string().uuid('newOwnerId must be a valid UUID'),
});

export async function transferProjectOwnership(
    projectId: string,
    newOwnerId: string,
): Promise<{ success: boolean; error?: string; errorCode?: 'UNAUTHORIZED' | 'STEP_UP_REQUIRED' | 'RATE_LIMITED' | 'VALIDATION_ERROR' | 'NOT_OWNER' | 'NOT_A_MEMBER' | 'PROJECT_NOT_FOUND' | 'INTERNAL_ERROR' }> {
    try {
        const parsed = transferProjectOwnershipSchema.safeParse({ projectId, newOwnerId });
        if (!parsed.success) {
            return { success: false, error: 'Invalid IDs', errorCode: 'VALIDATION_ERROR' };
        }
        // Use validated values from here on
        projectId = parsed.data.projectId;
        newOwnerId = parsed.data.newOwnerId;

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated', errorCode: 'UNAUTHORIZED' };
        }

        if (newOwnerId === user.id) {
            return {
                success: false,
                error: 'Cannot transfer ownership to yourself',
                errorCode: 'VALIDATION_ERROR',
            };
        }

        // SEC-C4: cap the rate of ownership transfers per user. 10 transfers
        // per hour is well above any legitimate deletion-wizard flow but low
        // enough that an attacker with a valid session cannot sweep an
        // entire project portfolio before we notice.
        const rate = await consumeRateLimit(
            `account:transfer-ownership:${user.id}`,
            10,
            60 * 60,
        );
        if (!rate.allowed) {
            return {
                success: false,
                error: 'Too many transfer attempts. Please try again later.',
                errorCode: 'RATE_LIMITED',
            };
        }

        // SEC-C4: require a fresh step-up — same invariant as account deletion
        // because transferring ownership is effectively a silent privilege
        // hand-off on the project.
        const stepUp = await resolveSecurityStepUp(user.id);
        if (!stepUp.ok) {
            return {
                success: false,
                error: 'Re-authenticate to transfer project ownership.',
                errorCode: 'STEP_UP_REQUIRED',
            };
        }

        const transferResult = await db.transaction(async (tx) => {
            // SEC-C4: `FOR UPDATE` locks the project row for the duration of
            // the transaction so a second caller (e.g. a parallel transfer or
            // a soft-delete) cannot race the owner check.
            const lockedRows = await tx.execute<{ owner_id: string; title: string | null; slug: string | null; kind: string }>(sql`
                SELECT owner_id, title, slug, kind FROM ${projects} WHERE id = ${projectId} FOR UPDATE
            `);
            const lockedProject = Array.from(lockedRows)[0];

            if (!lockedProject) {
                return { ok: false as const, code: 'PROJECT_NOT_FOUND' as const };
            }
            if (lockedProject.owner_id !== user.id) {
                return { ok: false as const, code: 'NOT_OWNER' as const };
            }

            // Verify new owner is a project member
            const [membership] = await tx
                .select({ id: projectMembers.id, role: projectMembers.role })
                .from(projectMembers)
                .where(
                    and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, newOwnerId),
                    )
                )
                .limit(1);

            if (!membership) {
                return { ok: false as const, code: 'NOT_A_MEMBER' as const };
            }
            // An organization passes only to one of its existing admins (report §30.5).
            if (lockedProject.kind === 'organization' && membership.role !== 'admin') {
                return { ok: false as const, code: 'NOT_AN_ADMIN' as const };
            }

            // Transfer ownership
            await tx
                .update(projects)
                .set({
                    ownerId: newOwnerId,
                    // A child project handed over at account deletion has its new lead now (report §30.7).
                    orgSettings: sql`${projects.orgSettings} - 'leadHandover'`,
                    updatedAt: new Date(),
                })
                .where(eq(projects.id, projectId));

            // Update member roles
            await tx
                .update(projectMembers)
                .set({ role: 'owner' })
                .where(
                    and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, newOwnerId),
                    )
                );

            // Demote the previous owner to 'admin' on the project so they
            // lose the destructive capabilities tied to the 'owner' role.
            await tx
                .update(projectMembers)
                .set({ role: 'admin' })
                .where(
                    and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, user.id),
                    )
                );

            // Application threads follow the new reviewers (both are still reviewers, but their chat role changed).
            await syncProjectChat(tx, projectId, newOwnerId, 'role');
            await syncProjectChat(tx, projectId, user.id, 'role');

            // SEC-C4: write an audit trail row for BOTH parties so either
            // user can see the transfer in their audit log. `user_id` here
            // points at the affected user (previous or new owner), and
            // `metadata.actor_id` records the acting party.
            const now = new Date();
            await tx.insert(profileAuditEvents).values([
                {
                    userId: user.id,
                    eventType: 'project_ownership_transferred_out',
                    previousValue: { ownerId: user.id },
                    nextValue: { ownerId: newOwnerId },
                    metadata: {
                        projectId,
                        newOwnerId,
                        actorId: user.id,
                        stepUpMethod: stepUp.payload?.method ?? null,
                        at: now.toISOString(),
                    },
                },
                {
                    userId: newOwnerId,
                    eventType: 'project_ownership_transferred_in',
                    previousValue: { ownerId: user.id },
                    nextValue: { ownerId: newOwnerId },
                    metadata: {
                        projectId,
                        previousOwnerId: user.id,
                        actorId: user.id,
                        at: now.toISOString(),
                    },
                },
            ]);

            const profileRows = await tx
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(profiles)
                .where(inArray(profiles.id, [user.id, newOwnerId]));
            const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));

            const [projectEvent] = await tx.insert(projectNodeEvents).values({
                projectId,
                nodeId: null,
                actorId: user.id,
                type: 'project_member.ownership_transferred',
                metadata: {
                    previousOwnerId: user.id,
                    newOwnerId,
                    previousOwnerSnapshot: profileById.get(user.id) ?? null,
                    newOwnerSnapshot: profileById.get(newOwnerId) ?? null,
                    previousOwnerNextRole: 'admin',
                    stepUpMethod: stepUp.payload?.method ?? null,
                    at: now.toISOString(),
                },
            }).returning({ id: projectNodeEvents.id });

            return {
                ok: true as const,
                projectTitle: lockedProject.title,
                projectSlug: lockedProject.slug,
                kind: lockedProject.kind,
                projectEventId: projectEvent?.id ?? null,
            };
        });

        if (!transferResult.ok) {
            switch (transferResult.code) {
                case 'NOT_OWNER':
                    return { success: false, error: 'Not the project owner', errorCode: 'NOT_OWNER' };
                case 'NOT_A_MEMBER':
                    return { success: false, error: 'New owner must be a project member', errorCode: 'NOT_A_MEMBER' };
                case 'NOT_AN_ADMIN':
                    return { success: false, error: 'An organization can only pass to one of its admins.', errorCode: 'NOT_A_MEMBER' };
                case 'PROJECT_NOT_FOUND':
                    return { success: false, error: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' };
            }
        }

        logger.info('account.transfer-ownership.completed', {
            module: 'account',
            projectId,
            previousOwnerId: user.id,
            newOwnerId,
        });

        const actorName = (user.user_metadata?.full_name as string | undefined)
            ?? (user.user_metadata?.username as string | undefined)
            ?? null;
        const actorAvatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null;
        const sourceEventId = transferResult.projectEventId ?? `${projectId}:${user.id}:${newOwnerId}`;

        try {
            await Promise.all([
                enqueueProjectNotificationEvent({
                    projectId,
                    actorUserId: user.id,
                    actorName,
                    actorAvatarUrl,
                    eventKey: "members.ownership_transferred",
                    affectedMemberId: user.id,
                    directRecipientIds: [user.id],
                    includeActorRecipient: true,
                    title: "Project ownership transferred",
                    body: transferResult.projectTitle ?? "Project ownership changed",
                    href: `/projects/${encodeURIComponent(transferResult.projectSlug || projectId)}?tab=settings`,
                    entityRefs: {
                        projectId,
                        projectSlug: transferResult.projectSlug ?? null,
                        targetUserId: user.id,
                    },
                    preview: {
                        actorName,
                        actorAvatarUrl,
                        contextLabel: transferResult.projectTitle ?? "Project",
                        contextKind: "project",
                        secondaryText: "You are now a co-leader",
                    },
                    sourceEventId,
                }),
                enqueueProjectNotificationEvent({
                    projectId,
                    actorUserId: user.id,
                    actorName,
                    actorAvatarUrl,
                    eventKey: "members.ownership_transferred",
                    affectedMemberId: newOwnerId,
                    directRecipientIds: [newOwnerId],
                    title: "Project ownership transferred to you",
                    body: transferResult.projectTitle ?? "Project ownership changed",
                    href: `/projects/${encodeURIComponent(transferResult.projectSlug || projectId)}?tab=settings`,
                    entityRefs: {
                        projectId,
                        projectSlug: transferResult.projectSlug ?? null,
                        targetUserId: newOwnerId,
                    },
                    preview: {
                        actorName,
                        actorAvatarUrl,
                        contextLabel: transferResult.projectTitle ?? "Project",
                        contextKind: "project",
                        secondaryText: "You are now the owner",
                    },
                    sourceEventId,
                }),
            ]);
            // E13 to both people for an organization (report §26.3 A).
            if (transferResult.kind === 'organization') {
                const { notifyOrg, orgHref, orgLabel, queueOrgEmails } = await import('@/lib/organizations/notify');
                const org = await orgLabel(projectId);
                if (org) {
                    await notifyOrg({ orgId: projectId, eventKey: 'org.lifecycle', actorId: user.id, to: [newOwnerId], title: `You're now the owner of ${org.title}`, href: orgHref(org, '?tab=settings'), sourceEventId: `owner:${sourceEventId}`, email: { kind: 'org_ownership' } });
                    await queueOrgEmails(projectId, newOwnerId, `owner-out:${sourceEventId}`, { kind: 'org_ownership', data: { previousOwner: true } }, [user.id]);
                }
            }
        } catch (notificationError) {
            logger.warn('account.transfer-ownership.notification_failed', {
                module: 'account',
                projectId,
                previousOwnerId: user.id,
                newOwnerId,
                error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            });
        }

        return { success: true };
    } catch (error) {
        logger.error('account.transfer-ownership.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to transfer ownership',
            errorCode: 'INTERNAL_ERROR',
        };
    }
}

// ============================================================================
// GET ACCOUNT DELETION STATUS
// ============================================================================

/**
 * Get the user's pending deletion status (if any).
 */
export async function getAccountDeletionStatus(): Promise<{
    pending: boolean;
    deletionId?: string;
    hardDeleteAt?: string;
    scheduledAt?: string;
}> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { pending: false };
        }

        const [activeDeletion] = await db
            .select({
                id: accountDeletions.id,
                hardDeleteAt: accountDeletions.hardDeleteAt,
                scheduledAt: accountDeletions.scheduledAt,
            })
            .from(accountDeletions)
            .where(
                and(
                    eq(accountDeletions.userId, user.id),
                    isNull(accountDeletions.cancelledAt),
                    isNull(accountDeletions.completedAt),
                )
            )
            .orderBy(desc(accountDeletions.scheduledAt))
            .limit(1);

        if (!activeDeletion) {
            return { pending: false };
        }

        return {
            pending: true,
            deletionId: activeDeletion.id,
            hardDeleteAt: activeDeletion.hardDeleteAt.toISOString(),
            scheduledAt: activeDeletion.scheduledAt.toISOString(),
        };
    } catch {
        return { pending: false };
    }
}
