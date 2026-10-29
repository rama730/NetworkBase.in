"use server";

import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { mergeNotificationPreferences } from "@/lib/notifications/merge";
import { isTransientDbError, readDbErrorCode, withDbRetry } from "@/lib/db/retry";
import { profiles } from "@/lib/db/schema";
import {
    countUnreadNotifications,
    dismissAllNotifications,
    dismissNotification,
    markNotificationRead,
    markNotificationsSeen,
    markNotificationUnread,
    muteNotificationScope,
    readNotificationsPage,
    snoozeNotification,
    toNotificationItem,
} from "@/lib/notifications/service";
import { InvalidNotificationCursorError } from "@/lib/notifications/cursor";
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import type { NotificationMuteScope, NotificationPreferences } from "@/lib/notifications/types";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getRedisClient } from "@/lib/redis";

function invalidateNotificationUnreadCache(userId: string) {
    const redis = getRedisClient();
    if (redis) {
        void redis.del(`unread:notif:${userId}`).catch((err) => {
            logger.warn("notifications.cache_invalidate_failed", {
                module: "notifications",
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        });
    }
}

export async function readNotificationsAction(limit = 20, cursor?: string | null) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", page: null };
        }

        const page = await readNotificationsPage(user.id, limit, cursor ?? null, db);
        return { success: true as const, page };
    } catch (error) {
        logger.error("notifications.read_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false as const,
            error: (error instanceof Error && error.message) || "Failed to load notifications",
            ...(error instanceof InvalidNotificationCursorError ? { code: "INVALID_CURSOR" as const } : {}),
            page: null,
        };
    }
}

export async function readNotificationUnreadCountAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", unreadCount: 0, unreadImportantCount: 0 };
        }

        const redis = getRedisClient();
        const cacheKey = `unread:notif:${user.id}`;
        if (redis) {
            try {
                const cached = await redis.get<{ total: number; important: number }>(cacheKey);
                if (cached && typeof cached.total === "number") {
                    return {
                        success: true as const,
                        unreadCount: cached.total,
                        unreadImportantCount: cached.important ?? 0,
                    };
                }
            } catch {
                // Redis error fallback
            }
        }

        const counts = await countUnreadNotifications(user.id, db);
        if (redis) {
            void redis.set(cacheKey, counts, { ex: 60 }).catch((err) => {
                logger.warn("notifications.cache_set_failed", {
                    module: "notifications",
                    userId: user.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }

        return {
            success: true as const,
            unreadCount: counts.total,
            unreadImportantCount: counts.important,
        };
    } catch (error) {
        logger.error("notifications.count_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false as const,
            error: (error instanceof Error && error.message) || "Failed to load notification count",
            unreadCount: 0,
            unreadImportantCount: 0,
        };
    }
}

export async function markNotificationReadAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const row = await markNotificationRead(user.id, notificationId, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        invalidateNotificationUnreadCache(user.id);
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error) {
        logger.error("notifications.mark_read_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: (error instanceof Error && error.message) || "Couldn’t mark notification read", item: null };
    }
}

/** Commits rows reviewed during a tray session without consuming their linked content. */
export async function markNotificationsSeenAction(notificationIds: string[]) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", items: [] as ReturnType<typeof toNotificationItem>[] };
        }

        const rows = await markNotificationsSeen(user.id, notificationIds, db);
        const items = rows.map((row) => toNotificationItem(row));
        invalidateNotificationUnreadCache(user.id);
        logger.info("notifications.tray_seen_committed", {
            module: "notifications",
            count: items.length,
            requested: Array.from(new Set(notificationIds.filter(Boolean))).length,
        });
        return { success: true as const, items };
    } catch (error) {
        logger.error("notifications.mark_seen_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false as const,
            error: (error instanceof Error && error.message) || "Failed to mark notifications seen",
            items: [] as ReturnType<typeof toNotificationItem>[],
        };
    }
}

export async function markNotificationUnreadAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const row = await markNotificationUnread(user.id, notificationId, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        invalidateNotificationUnreadCache(user.id);
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error) {
        logger.error("notifications.mark_unread_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: (error instanceof Error && error.message) || "Couldn’t mark notification unread", item: null };
    }
}

export async function dismissNotificationAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const row = await dismissNotification(user.id, notificationId, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        invalidateNotificationUnreadCache(user.id);
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error) {
        logger.error("notifications.dismiss_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: (error instanceof Error && error.message) || "Couldn’t dismiss notification", item: null };
    }
}

export async function dismissAllNotificationsAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized" };
        }

        await withDbRetry("notifications.dismiss_all", () => dismissAllNotifications(user.id, db));
        invalidateNotificationUnreadCache(user.id);
        return { success: true as const };
    } catch (error) {
        logger.error("notifications.dismiss_all_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: (error instanceof Error && error.message) || "Couldn’t clear notifications" };
    }
}

export async function readNotificationPreferencesAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", preferences: DEFAULT_NOTIFICATION_PREFERENCES };
        }

        const [row] = await withDbRetry("notifications.preferences.read", async () => {
            return db
                .select({ notificationPreferences: profiles.notificationPreferences })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .limit(1);
        }, { module: "notifications" });

        return {
            success: true as const,
            preferences: normalizeNotificationPreferences(row?.notificationPreferences),
        };
    } catch (error) {
        if (isTransientDbError(error)) {
            logger.warn("notifications.preferences_read_transient_fallback", {
                module: "notifications",
                errorCode: readDbErrorCode(error),
                error: error instanceof Error ? error.message : String(error),
            });
            // The tray can run on defaults for a moment; Settings must not (it would save them over the real ones).
            return {
                success: true as const,
                degraded: true as const,
                preferences: DEFAULT_NOTIFICATION_PREFERENCES,
            };
        }

        logger.error("notifications.preferences_read_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false as const,
            error: (error instanceof Error && error.message) || "Failed to read notification preferences",
            preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        };
    }
}

type NotificationPreferenceKey = keyof NotificationPreferences;

/**
 * Saves notification preferences. `changedKeys` names the top-level settings the person actually changed: only
 * those are written, on top of what is stored now, so a toggle can't revert a mute added from the tray or a
 * pause set from a status in the meantime. Without it the whole object is replaced (legacy callers).
 */
export async function updateNotificationPreferencesAction(preferences: NotificationPreferences, changedKeys?: NotificationPreferenceKey[]) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", preferences: null };
        }
        const limit = await consumeRateLimit(`notification-preferences:${user.id}`, 60, 60);
        if (!limit.allowed) {
            return { success: false as const, error: "Too many changes. Please wait a moment.", preferences: null };
        }

        const saved = await db.transaction(async (tx) => {
            // Locked while it is read and written, so two saves can't both start from the same stored copy.
            const [current] = await tx
                .select({ notificationPreferences: profiles.notificationPreferences })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .for("update");
            if (!current) return null;
            const next = mergeNotificationPreferences(current.notificationPreferences, preferences, changedKeys);
            const [row] = await tx
                .update(profiles)
                .set({ notificationPreferences: next, updatedAt: new Date() })
                .where(eq(profiles.id, user.id))
                .returning({ notificationPreferences: profiles.notificationPreferences });
            return row ?? null;
        });

        if (!saved) {
            return { success: false as const, error: "Profile not found", preferences: null };
        }

        return { success: true as const, preferences: normalizeNotificationPreferences(saved.notificationPreferences) };
    } catch (error) {
        logger.error("notifications.preferences_update_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to update notification preferences", preferences: null };
    }
}

export async function muteNotificationScopeAction(scope: NotificationMuteScope) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", preferences: null };
        }

        const preferences = await muteNotificationScope(user.id, scope, db);
        return { success: true as const, preferences };
    } catch (error) {
        logger.error("notifications.mute_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: (error instanceof Error && error.message) || "Failed to mute notification type", preferences: null };
    }
}

export async function snoozeNotificationAction(notificationId: string, snoozedUntil: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Unauthorized", item: null };
        }

        const until = new Date(snoozedUntil);
        if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
            return { success: false as const, error: "Snooze time must be in the future", item: null };
        }

        const row = await snoozeNotification(user.id, notificationId, until, db);
        if (!row) {
            return { success: false as const, error: "Notification not found", item: null };
        }
        return { success: true as const, item: toNotificationItem(row) };
    } catch (error) {
        logger.error("notifications.snooze_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: (error instanceof Error && error.message) || "Couldn’t snooze notification", item: null };
    }
}
