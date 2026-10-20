import { desc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { applicationEvents } from '@/lib/db/schema';
import { announceApplicationChange } from '@/lib/messaging/integrations';
import { conversationHref } from '@/lib/messaging/routes';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import { createNotification } from '@/lib/notifications/service';

// The notifications an application sends (to its reviewers, its applicant, and back). They are best effort:
// a failed notification never fails the decision that caused it.

export function applicationActorSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

/**
 * One id per transition (each writes an application event first), so a reapply or a second
 * rejection after a reopen notifies again instead of being swallowed by the dedupe key.
 * ponytail: reads the newest event at notify time. ceiling: two transitions racing inside the same
 * few milliseconds share an id and notify once. upgrade: return the event id from each writer.
 */
async function latestApplicationEventId(applicationId: string) {
    const [event] = await db
        .select({ id: applicationEvents.id })
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, applicationId))
        .orderBy(desc(applicationEvents.createdAt))
        .limit(1);
    return event?.id ?? applicationId;
}

export async function enqueueApplicationReceivedBestEffort(params: {
    applicationId: string;
    channelId?: string | null;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    roleTitle?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.received",
            title: `${params.actorName || "Someone"} applied for ${params.roleTitle || "a role"}`,
            body: params.projectTitle ? `Project: ${params.projectTitle}` : "New application received",
            // The thread has the cover letter and the Accept / Decline controls; the inbox is the fallback.
            href: params.channelId ? conversationHref(params.channelId) : '/network?tab=invitations',
            entityRefs: {
                applicationId: params.applicationId,
                channelId: params.channelId ?? null,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: params.roleTitle ?? "Application received",
            },
            sourceEventId: await latestApplicationEventId(params.applicationId),
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application received notification', {
            applicationId: params.applicationId,
            actorUserId: params.actorUserId,
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
            projectTitle: params.projectTitle ?? null,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

export type ApplicationDecisionNotice = "accepted" | "rejected" | "reopened" | "role_filled" | "project_closed" | "role_removed";

/** What the notification row says under the title (never the raw status word). */
const DECISION_NOTICE_LABEL: Record<ApplicationDecisionNotice, string> = {
    accepted: "Accepted",
    rejected: "Declined",
    reopened: "Reopened",
    role_filled: "Role filled",
    project_closed: "Project closed",
    role_removed: "Role removed",
};

export async function enqueueApplicationDecisionBestEffort(params: {
    applicationId: string;
    status: ApplicationDecisionNotice;
    /** The reviewer's note or the reason in words, so the applicant sees why in the notification. */
    reasonText?: string | null;
    channelId?: string | null;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    applicantId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    announceApplicationChange(params.applicantId, params.projectId);
    // When the project or the role changed, no reviewer decided anything: the notice comes from the project.
    const fromProject = params.status === "role_filled" || params.status === "project_closed" || params.status === "role_removed";
    const actorName = fromProject ? params.projectTitle ?? null : params.actorName;
    const actorAvatarUrl = fromProject ? null : params.actorAvatarUrl ?? null;
    const projectTitle = params.projectTitle || "The project";
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName,
            actorAvatarUrl,
            eventKey: "applications.decision",
            applicantId: params.applicantId,
            title: params.status === "role_filled"
                ? "The role you applied for was filled"
                : params.status === "role_removed"
                    ? "The role you applied for was removed"
                    : params.status === "project_closed"
                        ? `${projectTitle} is no longer taking applications`
                        : `${params.actorName || "Someone"} ${params.status === "accepted" ? "accepted" : params.status === "rejected" ? "declined" : "reopened"} your application`,
            body: params.reasonText?.trim().slice(0, 240) || (params.projectTitle ? `Project: ${params.projectTitle}` : null),
            href: params.channelId ? conversationHref(params.channelId) : '/network?tab=invitations',
            entityRefs: {
                applicationId: params.applicationId,
                channelId: params.channelId ?? null,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName,
                actorAvatarUrl,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: DECISION_NOTICE_LABEL[params.status],
            },
            sourceEventId: await latestApplicationEventId(params.applicationId),
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application decision notification', {
            applicationId: params.applicationId,
            status: params.status,
            actorUserId: params.actorUserId,
            recipientUserId: params.applicantId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

export async function enqueueApplicationWithdrawnBestEffort(params: {
    applicationId: string;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    roleTitle?: string | null;
    channelId?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.withdrawn",
            title: `${params.actorName || "Someone"} withdrew their application`,
            body: params.roleTitle ? `Role: ${params.roleTitle}` : params.projectTitle ? `Project: ${params.projectTitle}` : "Application withdrawn",
            href: params.channelId ? conversationHref(params.channelId) : '/network?tab=invitations',
            entityRefs: {
                applicationId: params.applicationId,
                channelId: params.channelId ?? null,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: "Withdrawn",
            },
            sourceEventId: await latestApplicationEventId(params.applicationId),
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application withdrawn notification', {
            applicationId: params.applicationId,
            actorUserId: params.actorUserId,
            projectId: params.projectId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

/** Tells each applicant whose application was closed because of the project or the role (after the transaction committed). */
export async function notifyClosedApplications(
    closed: Array<{ id: string; applicantId: string; roleId: string | null }>,
    context: {
        reason: "role_filled" | "project_closed" | "role_removed";
        projectId: string;
        projectSlug?: string | null;
        projectTitle?: string | null;
        actorUserId: string;
        traceId: string;
    },
) {
    if (closed.length === 0) return;
    let channels = new Map<string, string>();
    try {
        const rows = await db.execute<{ id: string; application_id: string }>(
            sql`SELECT id, application_id FROM chat_channels WHERE application_id IN (${sql.join(closed.map((item) => sql`${item.id}::uuid`), sql`, `)})`,
        );
        channels = new Map(Array.from(rows).map((row) => [row.application_id, row.id]));
    } catch (error) {
        console.error('[applications] Failed to look up the threads of closed applications', error);
    }
    for (const item of closed) {
        await enqueueApplicationDecisionBestEffort({
            applicationId: item.id,
            status: context.reason,
            channelId: channels.get(item.id) ?? null,
            projectId: context.projectId,
            projectSlug: context.projectSlug ?? null,
            projectTitle: context.projectTitle ?? null,
            roleId: item.roleId,
            applicantId: item.applicantId,
            actorUserId: context.actorUserId,
            actorName: null,
            traceId: context.traceId,
        });
    }
}

/** Candidates whose invitation for a role expired because the role filled: they would otherwise find out only by trying to accept. */
export async function notifyExpiredInvitations(
    candidateIds: string[],
    context: { projectId: string; projectSlug?: string | null; projectTitle?: string | null; actorUserId: string; roleTitle?: string | null; eventId?: string | null },
) {
    for (const candidateId of new Set(candidateIds)) {
        try {
            await createNotification({
                recipientUserId: candidateId,
                actorUserId: context.actorUserId,
                kind: 'chat_invite',
                category: 'workflows',
                importance: 'more',
                title: `Your invitation to ${context.projectTitle || 'the project'} expired`,
                body: context.roleTitle ? `The ${context.roleTitle} role was filled.` : 'The role was filled.',
                href: `/projects/${context.projectSlug || context.projectId}`,
                entityRefs: { projectId: context.projectId, projectSlug: context.projectSlug ?? null, targetUserId: candidateId },
                preview: { contextLabel: context.projectTitle ?? 'Project', contextKind: 'workflow', secondaryText: 'Invitation expired' },
                dedupeKey: `project-invitation-expired:${context.projectId}:${candidateId}:${context.eventId ?? Date.now()}`,
            });
        } catch (error) {
            console.error('[applications] Failed to notify a candidate about an expired invitation', error);
        }
    }
}
