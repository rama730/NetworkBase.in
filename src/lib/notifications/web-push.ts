import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { isAllowedPushEndpoint, MAX_PUSH_ENDPOINTS_PER_USER } from "@/lib/notifications/push-endpoint";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationDeliveries, pushSubscriptions } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import type { NotificationItem } from "@/lib/notifications/types";

type DeliveryRecord = {
    notificationId: string | null;
    userId: string;
    channel: "web_push";
    status: "delivered" | "failed" | "dropped";
    errorCode: string | null;
    errorMessage: string | null;
};

async function logDeliveries(records: DeliveryRecord[]): Promise<void> {
    if (records.length === 0) return;
    try {
        await db.insert(notificationDeliveries).values(records);
    } catch (error) {
        logger.warn("notifications.web_push_delivery_log_failed", {
            module: "notifications",
            count: records.length,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

let vapidConfigured = false;

function configureVapid(): boolean {
    if (vapidConfigured) return true;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
        return false;
    }
    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidConfigured = true;
        return true;
    } catch (error) {
        logger.warn("notifications.web_push_vapid_config_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

export type WebPushPayload = {
    id: string;
    title: string;
    body: string | null;
    href: string | null;
    icon: string | null;
    tag: string;
    /** Lets the device close this notice if the two later block each other (Blocking B35). */
    actorUserId?: string | null;
};

function buildPayload(item: NotificationItem): WebPushPayload {
    return {
        id: item.id,
        title: item.title,
        body: (item.body ?? item.preview?.secondaryText ?? "").slice(0, 240),
        href: item.href,
        icon: item.preview?.actorAvatarUrl ?? null,
        tag: item.dedupeKey,
        actorUserId: item.actorUserId ?? null,
    };
}

type DispatchResult = {
    attempted: number;
    delivered: number;
    pruned: number;
};

export async function dispatchWebPush(userId: string, item: NotificationItem): Promise<DispatchResult> {
    if (!configureVapid()) {
        await logDeliveries([{
            notificationId: item.id,
            userId,
            channel: "web_push",
            status: "dropped",
            errorCode: "vapid_unconfigured",
            errorMessage: null,
        }]);
        return { attempted: 0, delivered: 0, pruned: 0 };
    }
    if (item.importance !== "important") {
        await logDeliveries([{
            notificationId: item.id,
            userId,
            channel: "web_push",
            status: "dropped",
            errorCode: "importance_below_threshold",
            errorMessage: null,
        }]);
        return { attempted: 0, delivered: 0, pruned: 0 };
    }

    return sendPushToUser(userId, buildPayload(item), { notificationId: item.id });
}

export type SendPushOptions = {
    notificationId: string | null;
    /** Web Push `Topic`: the push service keeps only the newest pending push per topic (≤ 32 URL-safe chars). */
    topic?: string;
    /** Chat pushes skip the per-attempt delivery log to keep the send path free of extra writes. */
    recordDeliveries?: boolean;
};

/** Send one payload to every push subscription of a user, pruning dead endpoints. */
export async function sendPushToUser(userId: string, payloadData: WebPushPayload, options: SendPushOptions): Promise<DispatchResult> {
    if (!configureVapid()) return { attempted: 0, delivered: 0, pruned: 0 };
    const recordDeliveries = options.recordDeliveries !== false;
    const logDeliveryRecords = (records: DeliveryRecord[]) => (recordDeliveries ? logDeliveries(records) : Promise.resolve());

    const rows = await db
        .select({
            id: pushSubscriptions.id,
            endpoint: pushSubscriptions.endpoint,
            p256dh: pushSubscriptions.p256dh,
            auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .orderBy(sql`${pushSubscriptions.lastSeenAt} DESC NULLS LAST`)
        .limit(MAX_PUSH_ENDPOINTS_PER_USER);

    if (rows.length === 0) {
        await logDeliveryRecords([{
            notificationId: options.notificationId,
            userId,
            channel: "web_push",
            status: "dropped",
            errorCode: "no_subscriptions",
            errorMessage: null,
        }]);
        return { attempted: 0, delivered: 0, pruned: 0 };
    }

    // Rows saved before the provider allowlist (or edited out of band) are never contacted and are removed.
    const refused = rows.filter((row) => !isAllowedPushEndpoint(row.endpoint));
    if (refused.length > 0) {
        logger.warn("notifications.web_push_endpoint_refused", { module: "notifications", userId, count: refused.length });
        await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), inArray(pushSubscriptions.id, refused.map((row) => row.id)))).catch(() => undefined);
    }
    const allowedRows = rows.filter((row) => isAllowedPushEndpoint(row.endpoint));
    if (allowedRows.length === 0) return { attempted: 0, delivered: 0, pruned: refused.length };

    const payload = JSON.stringify(payloadData);
    const sendOptions = { TTL: 60 * 60 * 24, ...(options.topic ? { topic: options.topic } : {}) };
    const deadEndpointIds: string[] = [];
    const successfulEndpointIds: string[] = [];
    const failedEndpointIds: string[] = [];
    const deliveryRecords: DeliveryRecord[] = [];
    let delivered = 0;

    await Promise.all(allowedRows.map(async (row) => {
        const subscription: WebPushSubscription = {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
            await webpush.sendNotification(subscription, payload, sendOptions);
            delivered += 1;
            successfulEndpointIds.push(row.id);
            deliveryRecords.push({
                notificationId: options.notificationId,
                userId,
                channel: "web_push",
                status: "delivered",
                errorCode: null,
                errorMessage: null,
            });
        } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            const normalizedErrorMessage = error instanceof Error ? error.message : String(error);
            const errorMessage = normalizedErrorMessage.trim().slice(0, 500) || null;
            if (status === 404 || status === 410) {
                deadEndpointIds.push(row.id);
            } else {
                failedEndpointIds.push(row.id);
                logger.warn("notifications.web_push_send_failed", {
                    module: "notifications",
                    statusCode: status ?? null,
                    error: normalizedErrorMessage,
                });
            }
            deliveryRecords.push({
                notificationId: options.notificationId,
                userId,
                channel: "web_push",
                status: "failed",
                errorCode: status ? String(status) : "unknown",
                errorMessage,
            });
        }
    }));

    await logDeliveryRecords(deliveryRecords);

    const subscriptionStateUpdates: Promise<unknown>[] = [];
    const now = new Date();
    if (successfulEndpointIds.length > 0) {
        subscriptionStateUpdates.push(
            db.update(pushSubscriptions)
                .set({ failureCount: 0, lastSeenAt: now, updatedAt: now })
                .where(and(
                    eq(pushSubscriptions.userId, userId),
                    inArray(pushSubscriptions.id, successfulEndpointIds),
                )),
        );
    }
    if (failedEndpointIds.length > 0) {
        subscriptionStateUpdates.push(
            db.update(pushSubscriptions)
                .set({
                    failureCount: sql`${pushSubscriptions.failureCount} + 1`,
                    updatedAt: now,
                })
                .where(and(
                    eq(pushSubscriptions.userId, userId),
                    inArray(pushSubscriptions.id, failedEndpointIds),
                )),
        );
    }
    if (subscriptionStateUpdates.length > 0) {
        try {
            await Promise.all(subscriptionStateUpdates);
        } catch (error) {
            logger.warn("notifications.web_push_subscription_state_failed", {
                module: "notifications",
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    let pruned = 0;
    if (deadEndpointIds.length > 0) {
        try {
            const deleted = await db
                .delete(pushSubscriptions)
                .where(and(
                    eq(pushSubscriptions.userId, userId),
                    inArray(pushSubscriptions.id, deadEndpointIds),
                ))
                .returning({ id: pushSubscriptions.id });
            pruned = deleted.length;
        } catch (error) {
            logger.warn("notifications.web_push_prune_failed", {
                module: "notifications",
                userId,
                count: deadEndpointIds.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return { attempted: allowedRows.length, delivered, pruned: pruned + refused.length };
}
