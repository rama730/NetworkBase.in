import type { NotificationPreview } from "@/lib/notifications/types";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { importanceForKind } from "@/lib/notifications/classifier";
import { emitNotificationWrite, emitNotificationWrites, } from "@/lib/notifications/fanout";

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

