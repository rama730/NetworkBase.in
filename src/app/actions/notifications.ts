"use server";

import { db } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { mergeNotificationPreferences } from "@/lib/notifications/merge";
import { isTransientDbError, readDbErrorCode, withDbRetry } from "@/lib/db/retry";
import { profiles, userNotifications } from "@/lib/db/schema";
import {
    countUnreadNotifications,
    dismissAllNotifications,
    dismissReadNotifications,
    markAllNotificationsRead,
    readSnoozedNotifications,
    restoreNotification,
    type NotificationPageFilter,
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
import { invalidateNotificationCounts } from "@/lib/notifications/count-cache";
import { countNeedsYou, readNeedsYou, type NotificationAct } from "@/lib/notifications/needs-you";
import { actTargetFromDedupeKey, parseNeedsYouKey, type ActTarget } from "@/lib/notifications/act-target";
import { acceptConnectionRequest, rejectConnectionRequest } from "@/app/actions/connections";
import { answerAgentQuestionAction } from "@/app/actions/agent-questions";
import { decideAgentAccessRequestAction } from "@/app/actions/agent-access";
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import type { NotificationMuteScope, NotificationPreferences } from "@/lib/notifications/types";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getRedisClient } from "@/lib/redis";

function invalidateNotificationUnreadCache(userId: string) {
    invalidateNotificationCounts([userId]);
}

export async function readNotificationsAction(limit = 20, cursor?: string | null, filter?: NotificationPageFilter) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue", page: null };
        }

        const page = await readNotificationsPage(user.id, limit, cursor ?? null, db, {
            unreadOnly: filter?.unreadOnly === true,
            q: typeof filter?.q === "string" ? filter.q : undefined,
            kinds: Array.isArray(filter?.kinds) ? filter.kinds.slice(0, 60) : undefined,
            projectId: typeof filter?.projectId === "string" && /^[0-9a-f-]{36}$/i.test(filter.projectId) ? filter.projectId : undefined,
        });
        return { success: true as const, page };
    } catch (error) {
        logger.error("notifications.read_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false as const,
            error: (error instanceof Error && error.message) || "Couldn’t load notifications",
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
            return { success: false as const, error: "Sign in to continue", unreadCount: 0, unreadImportantCount: 0, needsYouCount: 0 };
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
                        // Needs you is read from the things themselves (answered elsewhere = gone), so it is never cached.
                        needsYouCount: await countNeedsYou(user.id),
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
            needsYouCount: await countNeedsYou(user.id),
        };
    } catch (error) {
        logger.error("notifications.count_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false as const,
            error: (error instanceof Error && error.message) || "Couldn’t load notification count",
            unreadCount: 0,
            unreadImportantCount: 0,
            needsYouCount: 0,
        };
    }
}

export async function markNotificationReadAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue", item: null };
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
            return { success: false as const, error: "Sign in to continue", items: [] as ReturnType<typeof toNotificationItem>[] };
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
            error: (error instanceof Error && error.message) || "Couldn’t mark notifications seen",
            items: [] as ReturnType<typeof toNotificationItem>[],
        };
    }
}

export async function markNotificationUnreadAction(notificationId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue", item: null };
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
            return { success: false as const, error: "Sign in to continue", item: null };
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
            return { success: false as const, error: "Sign in to continue" };
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
            return { success: false as const, error: "Sign in to continue", preferences: DEFAULT_NOTIFICATION_PREFERENCES };
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
            error: (error instanceof Error && error.message) || "Couldn’t read notification preferences",
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
            return { success: false as const, error: "Sign in to continue", preferences: null };
        }
        const limit = await consumeRateLimit(`notification-preferences:${user.id}`, 60, 60);
        if (!limit.allowed) {
            return { success: false as const, error: "Too many changes. Wait a moment.", preferences: null };
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
        return { success: false as const, error: "Couldn’t update notification preferences", preferences: null };
    }
}

export async function muteNotificationScopeAction(scope: NotificationMuteScope) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue", preferences: null };
        }

        const preferences = await muteNotificationScope(user.id, scope, db);
        return { success: true as const, preferences };
    } catch (error) {
        logger.error("notifications.mute_failed", {
            module: "notifications",
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: (error instanceof Error && error.message) || "Couldn’t mute notification type", preferences: null };
    }
}

export async function snoozeNotificationAction(notificationId: string, snoozedUntil: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue", item: null };
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

async function signedInUserId(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

function failure(event: string, error: unknown, fallback: string) {
    logger.error(event, { module: "notifications", error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: (error instanceof Error && error.message) || fallback };
}

/** Needs you (notifications mix): reviews, requests, agent asks and important notices, from their own tables. */
export async function readNeedsYouAction() {
    try {
        const userId = await signedInUserId();
        if (!userId) return { success: false as const, error: "Sign in to continue", items: [] };
        return { success: true as const, items: await readNeedsYou(userId) };
    } catch (error) {
        return { ...failure("notifications.needs_you_failed", error, "Couldn’t load what needs you"), items: [] };
    }
}

/** Mark all read: every unread row, not just the loaded ones. */
export async function markAllNotificationsReadAction() {
    try {
        const userId = await signedInUserId();
        if (!userId) return { success: false as const, error: "Sign in to continue", count: 0 };
        const count = await withDbRetry("notifications.mark_all_read", () => markAllNotificationsRead(userId, db));
        invalidateNotificationUnreadCache(userId);
        return { success: true as const, count };
    } catch (error) {
        return { ...failure("notifications.mark_all_read_failed", error, "Couldn’t mark them read"), count: 0 };
    }
}

/** "Done with all read": unread rows and Needs you stay. */
export async function dismissReadNotificationsAction() {
    try {
        const userId = await signedInUserId();
        if (!userId) return { success: false as const, error: "Sign in to continue", count: 0 };
        const count = await withDbRetry("notifications.dismiss_read", () => dismissReadNotifications(userId, db));
        return { success: true as const, count };
    } catch (error) {
        return { ...failure("notifications.dismiss_read_failed", error, "Couldn’t mark them done"), count: 0 };
    }
}

/** Undo for Done. */
export async function restoreNotificationAction(notificationId: string) {
    try {
        const userId = await signedInUserId();
        if (!userId) return { success: false as const, error: "Sign in to continue", item: null };
        const item = await restoreNotification(userId, notificationId, db);
        if (!item) return { success: false as const, error: "Notification not found", item: null };
        invalidateNotificationUnreadCache(userId);
        return { success: true as const, item };
    } catch (error) {
        return { ...failure("notifications.restore_failed", error, "Couldn’t bring it back"), item: null };
    }
}

/** The "Snoozed" list at the bottom of Unread. */
export async function readSnoozedNotificationsAction() {
    try {
        const userId = await signedInUserId();
        if (!userId) return { success: false as const, error: "Sign in to continue", items: [] };
        return { success: true as const, items: await readSnoozedNotifications(userId, db) };
    } catch (error) {
        return { ...failure("notifications.snoozed_failed", error, "Couldn’t load snoozed notifications"), items: [] };
    }
}

/**
 * One path for every answer button (notifications mix): the tray's rows, toasts and the push service worker. It only
 * works out what the button points at; the existing actions it calls check who may answer.
 */
export async function actOnNotificationAction(
    target: { key?: string; notificationId?: string },
    act: { act: NotificationAct["act"]; value?: string; questionKey?: string },
) {
    try {
        const userId = await signedInUserId();
        if (!userId) return { success: false as const, error: "Sign in to continue" };
        let resolved: ActTarget | null = typeof target.key === "string" ? parseNeedsYouKey(target.key) : null;
        let notificationId = typeof target.notificationId === "string" && /^[0-9a-f-]{36}$/i.test(target.notificationId) ? target.notificationId : null;
        if (!resolved && notificationId) {
            const [row] = await db.select({ dedupeKey: userNotifications.dedupeKey }).from(userNotifications)
                .where(and(eq(userNotifications.id, notificationId), eq(userNotifications.userId, userId))).limit(1);
            resolved = row ? actTargetFromDedupeKey(row.dedupeKey) : null;
            if (!row) notificationId = null;
        }
        if (!resolved) return { success: false as const, error: "There’s nothing to answer here" };

        let outcome: { success: boolean; error?: string };
        if (resolved.source === "connection" && (act.act === "accept" || act.act === "ignore")) {
            outcome = act.act === "accept"
                ? await acceptConnectionRequest(resolved.id, { idempotencyKey: resolved.id })
                : await rejectConnectionRequest(resolved.id);
        } else if (resolved.source === "agent_access" && (act.act === "allow" || act.act === "deny")) {
            outcome = await decideAgentAccessRequestAction(resolved.id, act.act === "allow" ? "once" : "no");
        } else if (resolved.source === "agent_question" && act.act === "answer" && act.value && act.questionKey) {
            outcome = await answerAgentQuestionAction(resolved.id, { [act.questionKey]: act.value });
        } else {
            return { success: false as const, error: "That button doesn’t fit this notification" };
        }
        if (!outcome.success) return { success: false as const, error: outcome.error ?? "Couldn’t do that just now" };
        if (notificationId) await markNotificationRead(userId, notificationId, db);
        invalidateNotificationUnreadCache(userId);
        return { success: true as const };
    } catch (error) {
        return failure("notifications.act_failed", error, "Couldn’t do that just now");
    }
}

/** "38 of 52 handed in" for an admin's combined submissions row: copies handed in over all copies, per assignment. */
export async function readHandInProgressAction(assignmentIds: string[]) {
    try {
        const userId = await signedInUserId();
        if (!userId) return { success: false as const, error: "Sign in to continue", progress: {} };
        const ids = Array.from(new Set(assignmentIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 20);
        if (!ids.length) return { success: true as const, progress: {} };
        const rows = Array.from(await db.execute<{ id: string; total: number; handed_in: number }>(sql`
            SELECT m.id, count(c.id)::int AS total, count(c.id) FILTER (WHERE c.submission IS NOT NULL)::int AS handed_in
            FROM tasks m JOIN workspaces w ON w.id = m.workspace_id
            LEFT JOIN tasks c ON c.assignment_id = m.id AND c.deleted_at IS NULL
            WHERE m.id = ANY(${ids}::uuid[])
              AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id AND wm.user_id = ${userId}::uuid AND wm.role IN ('owner', 'admin')))
            GROUP BY m.id`));
        return { success: true as const, progress: Object.fromEntries(rows.map((r) => [r.id, { handedIn: Number(r.handed_in), total: Number(r.total) }])) };
    } catch (error) {
        return { ...failure("notifications.hand_in_failed", error, "Couldn’t load hand-ins"), progress: {} };
    }
}
