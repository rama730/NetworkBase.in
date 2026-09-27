import type { NotificationPreview } from "@/lib/notifications/types";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { importanceForKind } from "@/lib/notifications/classifier";
import { emitNotificationWrite, emitNotificationWrites, } from "@/lib/notifications/fanout";
import { buildMessageSourceHref } from "@/lib/messages/linked-work-server";

type EmitExecutor = Parameters<typeof createNotification>[1];

function writeCreate(
    input: Parameters<typeof createNotification>[0],
    executor?: EmitExecutor,
) {
    return emitNotificationWrite({ operation: "create", input }, executor);
}

function buildPreview(params: {
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    contextLabel?: string | null;
    contextKind?: NotificationPreview["contextKind"];
    secondaryText?: string | null;
    thumbnailUrl?: string | null;
}): NotificationPreview | null {
    const preview: NotificationPreview = {
        actorName: params.actorName ?? null,
        actorAvatarUrl: params.actorAvatarUrl ?? null,
        contextLabel: params.contextLabel ?? null,
        contextKind: params.contextKind ?? null,
        secondaryText: params.secondaryText ?? null,
        thumbnailUrl: params.thumbnailUrl ?? null,
    };
    if (!preview.actorName && !preview.contextLabel && !preview.secondaryText && !preview.thumbnailUrl) {
        return null;
    }
    return preview;
}

function humanWorkflowLabel(kind: string) {
    const labels: Record<string, string> = {
        project_invite: "project invite",
        feedback_request: "feedback request",
        availability_request: "availability request",
        task_approval: "task approval",
        follow_up: "follow-up",
    };
    return labels[kind] ?? kind.replace(/_/g, " ");
}

export async function emitMessageBurstNotifications(params: {
    recipients: Array<{ userId: string; muted?: boolean | null }>;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    conversationId: string;
    sourceMessageId: string;
    secondaryText?: string | null;
}, executor?: EmitExecutor) {
    const writes = params.recipients
        .filter((recipient) => recipient.userId && recipient.userId !== params.actorUserId && !recipient.muted)
        .map((recipient) => ({
            operation: "aggregate" as const,
            input: {
                recipientUserId: recipient.userId,
                actorUserId: params.actorUserId,
                category: "messages" as const,
                kind: "message_burst" as const,
                importance: importanceForKind("message_burst"),
                title: params.actorName ? `New message from ${params.actorName}` : "New message",
                body: null,
                href: buildMessageSourceHref(params.conversationId, params.sourceMessageId),
                entityRefs: {
                    conversationId: params.conversationId,
                    sourceMessageId: params.sourceMessageId,
                },
                preview: buildPreview({
                    actorName: params.actorName,
                    actorAvatarUrl: params.actorAvatarUrl,
                    contextLabel: "Conversation",
                    contextKind: "conversation",
                    secondaryText: params.secondaryText ?? null,
                }),
                dedupeKey: `message-burst:${params.conversationId}`,
                aggregateCount: 1,
            },
        }));

    return emitNotificationWrites(writes, executor ?? db);
}

/**
 * Reaction activity is intentionally a separate notification from a message
 * burst: it must not alter unread-message state or pretend to be new chat
 * content. The per-actor/message/emoji key keeps retries idempotent while
 * still preserving a changed reaction as a distinct activity event.
 */
export async function emitMessageReactionNotification(params: {
    recipientUserId: string | null | undefined;
    recipientMuted?: boolean | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    conversationId: string;
    sourceMessageId: string;
    emoji: string;
    secondaryText?: string | null;
}, executor?: EmitExecutor) {
    if (!params.recipientUserId || params.recipientUserId === params.actorUserId || params.recipientMuted) {
        return;
    }

    const actorName = params.actorName || 'Someone';
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: 'messages',
        kind: 'message_reaction',
        importance: importanceForKind('message_reaction'),
        title: `${actorName} reacted ${params.emoji} to your message`,
        body: null,
        href: buildMessageSourceHref(params.conversationId, params.sourceMessageId),
        entityRefs: {
            conversationId: params.conversationId,
            sourceMessageId: params.sourceMessageId,
            reactionEmoji: params.emoji,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: 'Conversation',
            contextKind: 'conversation',
            secondaryText: params.secondaryText ?? null,
        }),
        dedupeKey: `message-reaction:${params.sourceMessageId}:${params.actorUserId}:${params.emoji}`,
    }, executor);
}

export async function emitWorkflowAssignedNotification(params: {
    recipientUserId: string | null | undefined;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    workflowItemId: string;
    workflowKind: string;
    conversationId: string;
    sourceMessageId: string;
    projectId?: string | null;
    projectSlug?: string | null;
    projectTitle?: string | null;
    taskId?: string | null;
}, executor?: EmitExecutor) {
    if (!params.recipientUserId) return;
    const projectLabel = params.projectTitle || "Project";
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: params.workflowKind === "project_invite" ? "projects" : "workflows",
        kind: "workflow_assigned",
        importance: importanceForKind("workflow_assigned"),
        title: params.workflowKind === "project_invite"
            ? `${params.actorName || "Someone"} invited you to ${projectLabel}`
            : `${params.actorName || "Someone"} assigned you a ${humanWorkflowLabel(params.workflowKind)}`,
        body: params.projectTitle ? `Project: ${params.projectTitle}` : null,
        href: buildMessageSourceHref(params.conversationId, params.sourceMessageId),
        entityRefs: {
            workflowItemId: params.workflowItemId,
            conversationId: params.conversationId,
            sourceMessageId: params.sourceMessageId,
            projectId: params.projectId ?? null,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId ?? null,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectTitle ?? "Workflow",
            contextKind: params.projectTitle ? "project" : "workflow",
            secondaryText: humanWorkflowLabel(params.workflowKind),
        }),
        dedupeKey: `workflow:${params.workflowItemId}:assigned`,
    }, executor);
}

export async function emitWorkflowResolvedNotification(params: {
    recipientUserId: string | null | undefined;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    workflowItemId: string;
    workflowKind: string;
    resolutionLabel: string;
    conversationId: string;
    sourceMessageId: string;
    projectId?: string | null;
    projectSlug?: string | null;
    projectTitle?: string | null;
    taskId?: string | null;
}, executor?: EmitExecutor) {
    if (!params.recipientUserId) return;
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: params.workflowKind === "project_invite" ? "projects" : "workflows",
        kind: "workflow_resolved",
        importance: importanceForKind("workflow_resolved"),
        title: `${params.actorName || "Someone"} ${params.resolutionLabel.toLowerCase()} your ${humanWorkflowLabel(params.workflowKind)}`,
        body: params.projectTitle ? `Project: ${params.projectTitle}` : null,
        href: buildMessageSourceHref(params.conversationId, params.sourceMessageId),
        entityRefs: {
            workflowItemId: params.workflowItemId,
            conversationId: params.conversationId,
            sourceMessageId: params.sourceMessageId,
            projectId: params.projectId ?? null,
            projectSlug: params.projectSlug ?? null,
            taskId: params.taskId ?? null,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: params.projectTitle ?? "Workflow",
            contextKind: params.projectTitle ? "project" : "workflow",
            secondaryText: params.resolutionLabel,
        }),
        dedupeKey: `workflow:${params.workflowItemId}:resolved:${params.resolutionLabel.toLowerCase()}`,
    }, executor);
}

export async function emitConnectionRequestReceivedNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    connectionId: string;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "connections",
        kind: "connection_request_received",
        importance: importanceForKind("connection_request_received"),
        title: `${params.actorName || "Someone"} sent you a connection request`,
        href: "/network?tab=invitations",
        entityRefs: {
            connectionId: params.connectionId,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: "Connections",
            contextKind: "connection",
        }),
        dedupeKey: `connection:${params.connectionId}:received`,
    }, executor);
}

export async function emitConnectionAcceptedNotification(params: {
    recipientUserId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    connectionId: string;
    eventKey?: string | null;
}, executor?: EmitExecutor) {
    await writeCreate({
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        category: "connections",
        kind: "connection_request_accepted",
        importance: importanceForKind("connection_request_accepted"),
        title: `${params.actorName || "Someone"} accepted your connection request`,
        href: "/network?tab=invitations",
        entityRefs: {
            connectionId: params.connectionId,
        },
        preview: buildPreview({
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl,
            contextLabel: "Connections",
            contextKind: "connection",
        }),
        dedupeKey: `connection:${params.connectionId}:accepted`,
    }, executor);
}

