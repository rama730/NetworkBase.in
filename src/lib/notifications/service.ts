import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, userNotifications } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
    decodeNotificationCursor,
    encodeNotificationCursor,
} from "@/lib/notifications/cursor";
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    isNotificationPauseActive,
    isQuietHoursActive,
    getNotificationPauseUntil,
    getQuietHoursResumeAt,
    normalizeNotificationPreferences,
    orgChoiceBlocks,
} from "@/lib/notifications/preferences";
import {
    getNotificationReason,
    notificationMatchesMuteScope,
} from "@/lib/notifications/presentation";
import type {
    NotificationEntityRefs,
    NotificationFeedPage,
    NotificationFanoutInput,
    NotificationImportance,
    NotificationItem,
    NotificationKind,
    NotificationMuteScope,
    NotificationPreferenceCategory,
    NotificationPreview,
    NotificationPreferences,
} from "@/lib/notifications/types";

type NotificationWriteExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type NotificationActor = {
    name: string | null;
    avatarUrl: string | null;
};

export type CreateNotificationInput = NotificationFanoutInput;

export type NotificationMuteInput = NotificationMuteScope;

function getExecutor(executor?: NotificationWriteExecutor): NotificationWriteExecutor {
    return executor ?? db;
}

/**
 * Nothing a blocked person does reaches the other (Blocking B8): their notices are dropped. An organization's or
 * workspace's own notice still arrives, without the actor (B47).
 */
/** Notifications already in the tray from someone in a block with you stay hidden (B8). */
const notFromBlocked = sql`NOT app_private.blocked_between(${userNotifications.userId}, ${userNotifications.actorUserId})`;

async function applyBlockRule(tx: NotificationWriteExecutor, input: CreateNotificationInput): Promise<CreateNotificationInput | null> {
    if (!input.actorUserId || input.actorUserId === input.recipientUserId) return input;
    // Someone you muted: their likes and comments on your updates don't reach you (Blocking B26).
    if (input.kind === "project_update_like" || input.kind === "project_update_comment" || input.kind === "project_update_reply" || input.kind === "project_update_mention" || input.kind === "project_update_activity") {
        const [muted] = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM user_mutes WHERE muter_id = ${input.recipientUserId}::uuid AND muted_id = ${input.actorUserId}::uuid) AS muted`) as unknown as Array<{ muted: boolean }>;
        if (muted?.muted) return null;
    }
    const [row] = await tx.execute(sql`SELECT app_private.blocked_between(${input.actorUserId}::uuid, ${input.recipientUserId}::uuid) AS blocked`) as unknown as Array<{ blocked: boolean }>;
    if (!row?.blocked) return input;
    // Acting on someone you're in a block with is recorded for trust and safety only, never for the place (B49, rule 7).
    if (input.placeNotice && input.placeAction) {
        await tx.execute(sql`
            INSERT INTO moderation_events (actor_id, kind, data)
            VALUES (${input.actorUserId}::uuid, 'admin_action_across_block', ${JSON.stringify({ subjectId: input.recipientUserId, action: input.placeAction, workspaceId: input.entityRefs?.projectId ?? null })}::jsonb)
        `);
    }
    return input.placeNotice ? { ...input, title: input.placeTitle || input.title, actorUserId: null, preview: input.preview ? { ...input.preview, actorName: null, actorAvatarUrl: null } : input.preview } : null;
}

function toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const next = value instanceof Date ? value : new Date(value);
    return Number.isNaN(next.getTime()) ? null : next;
}

function toIsoString(value: Date | string | null | undefined) {
    const next = toDate(value);
    return next ? next.toISOString() : null;
}

export function toNotificationItem(
    row: typeof userNotifications.$inferSelect,
    actor?: NotificationActor | null,
): NotificationItem {
    const storedPreview = (row.preview as NotificationPreview | null) ?? null;
    const actorName = actor?.name ?? storedPreview?.actorName ?? null;
    const actorAvatarUrl = actor?.avatarUrl ?? storedPreview?.actorAvatarUrl ?? null;
    const preview = actorName || actorAvatarUrl || storedPreview
        ? {
            ...(storedPreview ?? {}),
            actorName,
            actorAvatarUrl,
        }
        : null;
    return {
        id: row.id,
        userId: row.userId,
        actorUserId: row.actorUserId ?? null,
        kind: row.kind as NotificationKind,
        importance: row.importance as NotificationImportance,
        title: row.title,
        body: row.body ?? null,
        href: row.href ?? null,
        entityRefs: (row.entityRefs as NotificationEntityRefs | null) ?? null,
        preview,
        reason: getNotificationReason(row.kind as NotificationKind, (row.entityRefs as NotificationEntityRefs | null) ?? null),
        dedupeKey: row.dedupeKey,
        aggregateCount: row.aggregateCount ?? 1,
        readAt: toIsoString(row.readAt),
        seenAt: toIsoString(row.seenAt),
        dismissedAt: toIsoString(row.dismissedAt),
        snoozedUntil: toIsoString(row.snoozedUntil),
        createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
        activityAt: toIsoString(row.activityAt) ?? toIsoString(row.updatedAt) ?? toIsoString(row.createdAt) ?? new Date(0).toISOString(),
        updatedAt: toIsoString(row.updatedAt) ?? toIsoString(row.createdAt) ?? new Date(0).toISOString(),
    };
}

export async function getNotificationPreferencesMap(
    executor: NotificationWriteExecutor,
    userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
    const normalizedUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (normalizedUserIds.length === 0) return new Map();

    const rows = await executor
        .select({
            userId: profiles.id,
            notificationPreferences: profiles.notificationPreferences,
        })
        .from(profiles)
        .where(inArray(profiles.id, normalizedUserIds));

    const map = new Map<string, NotificationPreferences>();
    for (const row of rows) {
        map.set(row.userId, normalizeNotificationPreferences(row.notificationPreferences));
    }
    for (const userId of normalizedUserIds) {
        if (!map.has(userId)) {
            map.set(userId, { ...DEFAULT_NOTIFICATION_PREFERENCES });
        }
    }
    return map;
}

type NotificationSkipReason = "actor_self" | "category_off" | "muted_scope" | "org_off" | "blocked";
type NotificationDelayReason = "paused" | "quiet_hours";

export function resolveNotificationDeliveryPolicy(params: {
    recipientUserId: string;
    actorUserId?: string | null;
    kind: NotificationKind;
    category: NotificationPreferenceCategory;
    entityRefs?: NotificationEntityRefs | null;
    importance?: NotificationImportance;
    preferenceMap: Map<string, NotificationPreferences>;
    now?: Date;
}): { allowed: true; delayUntil: Date | null; delayReason: NotificationDelayReason | null } | { allowed: false; reason: NotificationSkipReason } {
    const { recipientUserId, actorUserId, kind, category, entityRefs, preferenceMap } = params;
    const now = params.now ?? new Date();
    if (actorUserId && actorUserId === recipientUserId) return { allowed: false, reason: "actor_self" };
    // Safety notices (reports, decisions, restrictions, appeals) skip categories, mutes, pauses and quiet hours.
    if (kind === "trust_safety") return { allowed: true, delayUntil: null, delayReason: null };
    const preferences = preferenceMap.get(recipientUserId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
    // Reminders the user set themselves ("Remind me about this") come through whatever category is off.
    if (kind !== "chat_reminder" && !preferences[category]) return { allowed: false, reason: "category_off" };
    const muted = preferences.mutedScopes.some((scope) => notificationMatchesMuteScope({
        kind,
        actorUserId,
        entityRefs,
    }, scope));
    if (muted) return { allowed: false, reason: "muted_scope" };
    if (orgChoiceBlocks(preferences, entityRefs, params.importance)) return { allowed: false, reason: "org_off" };

    if (isNotificationPauseActive(preferences, now)) {
        return { allowed: true, delayUntil: getNotificationPauseUntil(preferences, now), delayReason: "paused" };
    }
    if (isQuietHoursActive(preferences, now)) {
        return { allowed: true, delayUntil: getQuietHoursResumeAt(preferences, now), delayReason: "quiet_hours" };
    }

    return { allowed: true, delayUntil: null, delayReason: null };
}

function logEmission(payload: {
    kind: string;
    category: string;
    importance: string;
    path: "create" | "aggregate";
    outcome: "created" | "skipped" | "dedupe_hit" | "aggregated";
    skipped_reason?: NotificationSkipReason;
    delayed_reason?: NotificationDelayReason;
    has_actor: boolean;
    duration_ms: number;
    aggregate_count?: number;
}) {
    logger.info("notification.emit", {
        module: "notifications",
        kind: payload.kind,
        type: payload.path,
        status: payload.outcome,
        reason: payload.skipped_reason ?? payload.delayed_reason ?? null,
        durationMs: payload.duration_ms,
        count: payload.aggregate_count,
    });
}

export type CreateNotificationResult =
    | { notification: null; skipped: true }
    | { notification: typeof userNotifications.$inferSelect | null; skipped: false };

export async function createNotification(
    input: CreateNotificationInput,
    executor?: NotificationWriteExecutor,
    preloadedPreferenceMap?: Map<string, NotificationPreferences>,
): Promise<CreateNotificationResult> {
    const start = Date.now();
    const importance = input.importance ?? "more";
    const hasActor = Boolean(input.actorUserId);
    const tx = getExecutor(executor);
    const preferenceMap = preloadedPreferenceMap
        ?? await getNotificationPreferencesMap(tx, [input.recipientUserId]);
    const check = resolveNotificationDeliveryPolicy({
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId,
        kind: input.kind,
        category: input.category,
        entityRefs: input.entityRefs ?? null,
        importance,
        preferenceMap,
    });
    if (!check.allowed) {
        logEmission({
            kind: input.kind,
            category: input.category,
            importance,
            path: "create",
            outcome: "skipped",
            skipped_reason: check.reason,
            has_actor: hasActor,
            duration_ms: Date.now() - start,
        });
        return { notification: null, skipped: true as const };
    }
    const allowed = await applyBlockRule(tx, input);
    if (!allowed) {
        logEmission({ kind: input.kind, category: input.category, importance, path: "create", outcome: "skipped", skipped_reason: "blocked", has_actor: hasActor, duration_ms: Date.now() - start });
        return { notification: null, skipped: true as const };
    }
    input = allowed;

    const now = new Date();
    const inserted = await tx
        .insert(userNotifications)
        .values({
            userId: input.recipientUserId,
            actorUserId: input.actorUserId ?? null,
            kind: input.kind,
            importance,
            title: input.title,
            body: input.body ?? null,
            href: input.href ?? null,
            entityRefs: input.entityRefs ?? null,
            preview: input.preview ?? null,
            dedupeKey: input.dedupeKey,
            aggregateCount: Math.max(1, input.aggregateCount ?? 1),
            readAt: null,
            seenAt: null,
            dismissedAt: null,
            snoozedUntil: check.delayUntil,
            createdAt: now,
            activityAt: now,
            updatedAt: now,
        })
        .onConflictDoNothing({
            target: [userNotifications.userId, userNotifications.dedupeKey],
        })
        .returning();

    if (inserted[0]) {
        logEmission({
            kind: input.kind,
            category: input.category,
            importance,
            path: "create",
            outcome: "created",
            has_actor: hasActor,
            duration_ms: Date.now() - start,
            aggregate_count: inserted[0].aggregateCount ?? 1,
            delayed_reason: check.delayReason ?? undefined,
        });
        return { notification: inserted[0]!, skipped: false as const };
    }

    const [existing] = await tx
        .select({
            id: userNotifications.id,
            aggregateCount: userNotifications.aggregateCount,
            userId: userNotifications.userId,
            dedupeKey: userNotifications.dedupeKey,
        })
        .from(userNotifications)
        .where(
            and(
                eq(userNotifications.userId, input.recipientUserId),
                eq(userNotifications.dedupeKey, input.dedupeKey),
            ),
        )
        .limit(1);

    logEmission({
        kind: input.kind,
        category: input.category,
        importance,
        path: "create",
        outcome: "dedupe_hit",
        has_actor: hasActor,
        duration_ms: Date.now() - start,
        aggregate_count: existing?.aggregateCount ?? undefined,
    });
    if (!existing) {
        return { notification: null, skipped: true as const };
    }
    return { notification: existing as unknown as typeof userNotifications.$inferSelect, skipped: false as const };
}

export async function upsertAggregatedNotification(
    input: CreateNotificationInput,
    executor?: NotificationWriteExecutor,
    preloadedPreferenceMap?: Map<string, NotificationPreferences>,
) {
    const start = Date.now();
    const importance = input.importance ?? "more";
    const hasActor = Boolean(input.actorUserId);
    const tx = getExecutor(executor);
    const preferenceMap = preloadedPreferenceMap
        ?? await getNotificationPreferencesMap(tx, [input.recipientUserId]);
    const check = resolveNotificationDeliveryPolicy({
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId,
        kind: input.kind,
        category: input.category,
        entityRefs: input.entityRefs ?? null,
        importance,
        preferenceMap,
    });
    if (!check.allowed) {
        logEmission({
            kind: input.kind,
            category: input.category,
            importance,
            path: "aggregate",
            outcome: "skipped",
            skipped_reason: check.reason,
            has_actor: hasActor,
            duration_ms: Date.now() - start,
        });
        return { notification: null, skipped: true as const };
    }
    const allowed = await applyBlockRule(tx, input);
    if (!allowed) {
        logEmission({ kind: input.kind, category: input.category, importance, path: "aggregate", outcome: "skipped", skipped_reason: "blocked", has_actor: hasActor, duration_ms: Date.now() - start });
        return { notification: null, skipped: true as const };
    }
    input = allowed;

    const now = new Date();
    const aggregateDelta = Math.max(1, input.aggregateCount ?? 1);
    const delayUntilIso = check.delayUntil instanceof Date ? check.delayUntil.toISOString() : null;
    // Event identity (COR-016): the last few source ids ride in entity_refs, so one atomic upsert both
    // counts an event and remembers it. A replayed event (same id) changes nothing, not even the read state.
    const source = input.sourceEventId ?? null;
    const AGGREGATE_SOURCE_WINDOW = 20;
    const replayed = source
        ? sql`COALESCE(${userNotifications.entityRefs}->'aggregateSources', '[]'::jsonb) ? ${source}`
        : sql`FALSE`;
    const nextSources = sql`(SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) FROM (
            SELECT value FROM jsonb_array_elements(
                COALESCE(${userNotifications.entityRefs}->'aggregateSources', '[]'::jsonb) || to_jsonb(${source}::text)
            ) WITH ORDINALITY AS t(value, ord) ORDER BY ord DESC LIMIT ${AGGREGATE_SOURCE_WINDOW}
        ) recent)`;
    const withSource = (refs: NotificationEntityRefs | null | undefined) =>
        source ? { ...(refs ?? {}), aggregateSources: [source] } : (refs ?? null);
    const [row] = await tx
        .insert(userNotifications)
        .values({
            userId: input.recipientUserId,
            actorUserId: input.actorUserId ?? null,
            kind: input.kind,
            importance: input.importance ?? "more",
            title: input.title,
            body: input.body ?? null,
            href: input.href ?? null,
            entityRefs: withSource(input.entityRefs) as NotificationEntityRefs | null,
            preview: input.preview ?? null,
            dedupeKey: input.dedupeKey,
            aggregateCount: aggregateDelta,
            readAt: null,
            seenAt: null,
            dismissedAt: null,
            snoozedUntil: check.delayUntil,
            createdAt: now,
            activityAt: now,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: [userNotifications.userId, userNotifications.dedupeKey],
            set: {
                actorUserId: input.actorUserId ?? null,
                kind: input.kind,
                importance: input.importance ?? "more",
                title: input.title,
                body: input.body ?? null,
                href: input.href ?? null,
                entityRefs: source
                    ? sql`CASE WHEN ${replayed} THEN ${userNotifications.entityRefs}
                        ELSE COALESCE(${JSON.stringify(input.entityRefs ?? {})}::jsonb, '{}'::jsonb)
                             || jsonb_build_object('aggregateSources', ${nextSources}) END`
                    : (input.entityRefs ?? null),
                preview: input.preview ?? null,
                aggregateCount: input.exactCount ? aggregateDelta : sql`CASE
                    WHEN ${replayed} THEN ${userNotifications.aggregateCount}
                    WHEN ${userNotifications.readAt} IS NULL THEN ${userNotifications.aggregateCount} + ${aggregateDelta}
                    ELSE ${aggregateDelta}
                END`,
                readAt: sql`CASE WHEN ${replayed} THEN ${userNotifications.readAt} ELSE NULL END`,
                seenAt: sql`CASE WHEN ${replayed} THEN ${userNotifications.seenAt} ELSE NULL END`,
                dismissedAt: sql`CASE WHEN ${replayed} THEN ${userNotifications.dismissedAt} ELSE NULL END`,
                // A new aggregate event must never cancel an explicit future
                // snooze already chosen for the existing inbox item. Policy
                // delays may extend that snooze, but cannot shorten it.
                snoozedUntil: delayUntilIso
                    ? sql`CASE
                        WHEN ${userNotifications.snoozedUntil} > NOW()
                            THEN GREATEST(${userNotifications.snoozedUntil}, ${delayUntilIso}::timestamptz)
                        ELSE ${delayUntilIso}::timestamptz
                    END`
                    : sql`CASE
                        WHEN ${userNotifications.snoozedUntil} > NOW()
                            THEN ${userNotifications.snoozedUntil}
                        ELSE NULL
                    END`,
                activityAt: now,
                updatedAt: now,
            },
        })
        .returning();

    logEmission({
        kind: input.kind,
        category: input.category,
        importance,
        path: "aggregate",
        outcome: "aggregated",
        has_actor: hasActor,
        duration_ms: Date.now() - start,
        aggregate_count: row?.aggregateCount ?? aggregateDelta,
        delayed_reason: check.delayReason ?? undefined,
    });
    return { notification: row ?? null, skipped: false as const };
}

/** Every kind of notification about a post, or about the comments on it. */
export const isUpdateNotification = sql`kind IN ('project_update_activity', 'project_update_comment', 'project_update_reply', 'project_update_mention', 'project_update_like', 'project_update_team')`;

/**
 * A post or comment that's gone takes its notifications with it, text included, wherever they were delivered.
 * ponytail: scans by kind, since the refs have no index. It runs only on a delete or a moderation hide. Upgrade: an expression index.
 */
export async function dismissUpdateNotifications(ref: "updateId" | "commentId", id: string, executor?: NotificationWriteExecutor) {
    await getExecutor(executor).execute(sql`
        UPDATE user_notifications SET dismissed_at = now(), updated_at = now()
        WHERE ${isUpdateNotification} AND dismissed_at IS NULL AND entity_refs->>${ref} = ${id}`);
}

export async function markNotificationRead(
    userId: string,
    notificationId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const readAt = new Date();
    const readAtIso = readAt.toISOString();
    const [row] = await tx
        .update(userNotifications)
        .set({ readAt, seenAt: sql`COALESCE(${userNotifications.seenAt}, ${readAtIso}::timestamptz)`, updatedAt: readAt })
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.id, notificationId), isNull(userNotifications.dismissedAt)))
        .returning();
    return row ?? null;
}

/**
 * Commits a completed notification-tray review without consuming the linked
 * content. In particular, seeing a message alert must not mark the message
 * conversation itself as read.
 */
export async function markNotificationsSeen(
    userId: string,
    notificationIds: string[],
    executor?: NotificationWriteExecutor,
) {
    const ids = Array.from(new Set(notificationIds.filter((id) => typeof id === "string" && id.length > 0))).slice(0, 50);
    if (ids.length === 0) return [] as Array<typeof userNotifications.$inferSelect>;
    const tx = getExecutor(executor);
    const seenAt = new Date();
    const seenAtIso = seenAt.toISOString();
    return tx
        .update(userNotifications)
        .set({
            seenAt,
            readAt: sql`COALESCE(${userNotifications.readAt}, ${seenAtIso}::timestamptz)`,
            updatedAt: seenAt,
        })
        .where(and(
            eq(userNotifications.userId, userId),
            inArray(userNotifications.id, ids),
            isNull(userNotifications.dismissedAt),
            or(isNull(userNotifications.readAt), isNull(userNotifications.seenAt)),
        ))
        .returning();
}

export async function markNotificationUnread(
    userId: string,
    notificationId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const now = new Date();
    const [row] = await tx
        .update(userNotifications)
        .set({ readAt: null, seenAt: null, updatedAt: now })
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.id, notificationId), isNull(userNotifications.dismissedAt)))
        .returning();
    return row ?? null;
}

export async function countUnreadNotifications(
    userId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const now = new Date();
    const [row] = await tx
        .select({
            total: sql<number>`COUNT(*)::int`,
            important: sql<number>`COUNT(*) FILTER (WHERE ${userNotifications.importance} = 'important')::int`,
        })
        .from(userNotifications)
        .where(and(
            eq(userNotifications.userId, userId),
            isNull(userNotifications.seenAt),
            isNull(userNotifications.dismissedAt),
            or(isNull(userNotifications.snoozedUntil), lte(userNotifications.snoozedUntil, now)),
            notFromBlocked,
        ));
    return {
        total: row?.total ?? 0,
        important: row?.important ?? 0,
    };
}

export async function snoozeNotification(
    userId: string,
    notificationId: string,
    snoozedUntil: Date,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const now = new Date();
    const [row] = await tx
        .update(userNotifications)
        .set({
            snoozedUntil,
            readAt: null,
            seenAt: null,
            updatedAt: now,
        })
        .where(and(
            eq(userNotifications.userId, userId),
            eq(userNotifications.id, notificationId),
            isNull(userNotifications.dismissedAt),
        ))
        .returning();
    return row ?? null;
}

export async function dismissNotification(
    userId: string,
    notificationId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const dismissedAt = new Date();
    const dismissedAtIso = dismissedAt.toISOString();
    const [row] = await tx
        .update(userNotifications)
        .set({
            dismissedAt,
            readAt: sql`COALESCE(${userNotifications.readAt}, ${dismissedAtIso}::timestamptz)`,
            seenAt: sql`COALESCE(${userNotifications.seenAt}, ${dismissedAtIso}::timestamptz)`,
            updatedAt: dismissedAt,
        })
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.id, notificationId), isNull(userNotifications.dismissedAt)))
        .returning();
    return row ?? null;
}

export async function dismissAllNotifications(
    userId: string,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const dismissedAt = new Date();
    const dismissedAtIso = dismissedAt.toISOString();
    await tx
        .update(userNotifications)
        .set({
            dismissedAt,
            readAt: sql`COALESCE(${userNotifications.readAt}, ${dismissedAtIso}::timestamptz)`,
            seenAt: sql`COALESCE(${userNotifications.seenAt}, ${dismissedAtIso}::timestamptz)`,
            updatedAt: dismissedAt,
        })
        .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.dismissedAt)));
}

export async function muteNotificationScope(
    userId: string,
    scope: NotificationMuteInput,
    executor?: NotificationWriteExecutor,
) {
    const tx = getExecutor(executor);
    const preferenceMap = await getNotificationPreferencesMap(tx, [userId]);
    const current = preferenceMap.get(userId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
    const mutedAt = new Date().toISOString();
    const nextScope: NotificationMuteScope = {
        kind: scope.kind,
        value: scope.value,
        label: scope.label ?? null,
        mutedAt,
    };
    const existing = current.mutedScopes.filter((entry) => !(entry.kind === nextScope.kind && entry.value === nextScope.value));
    const normalized = normalizeNotificationPreferences({
        ...current,
        mutedScopes: [nextScope, ...existing].slice(0, 100),
    });
    const [row] = await tx
        .update(profiles)
        .set({ notificationPreferences: normalized, updatedAt: new Date() })
        .where(eq(profiles.id, userId))
        .returning({ notificationPreferences: profiles.notificationPreferences });
    return normalizeNotificationPreferences(row?.notificationPreferences ?? normalized);
}

export async function readNotificationsPage(
    userId: string,
    limit: number,
    cursor?: string | null,
    executor?: NotificationWriteExecutor,
): Promise<NotificationFeedPage> {
    const tx = getExecutor(executor);
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const parsedCursor = decodeNotificationCursor(cursor);
    const cursorDate = parsedCursor ? new Date(parsedCursor.activityAt) : null;

    const now = new Date();
    const rows = await tx
        .select({
            id: userNotifications.id,
            userId: userNotifications.userId,
            actorUserId: userNotifications.actorUserId,
            kind: userNotifications.kind,
            importance: userNotifications.importance,
            title: userNotifications.title,
            body: userNotifications.body,
            href: userNotifications.href,
            entityRefs: userNotifications.entityRefs,
            preview: userNotifications.preview,
            dedupeKey: userNotifications.dedupeKey,
            aggregateCount: userNotifications.aggregateCount,
            readAt: userNotifications.readAt,
            seenAt: userNotifications.seenAt,
            dismissedAt: userNotifications.dismissedAt,
            snoozedUntil: userNotifications.snoozedUntil,
            createdAt: userNotifications.createdAt,
            activityAt: userNotifications.activityAt,
            updatedAt: userNotifications.updatedAt,
        })
        .from(userNotifications)
        .where(
            and(
                eq(userNotifications.userId, userId),
                isNull(userNotifications.dismissedAt),
                or(isNull(userNotifications.snoozedUntil), lte(userNotifications.snoozedUntil, now)),
                notFromBlocked,
                parsedCursor && cursorDate
                    ? or(
                        lt(userNotifications.activityAt, cursorDate),
                        and(eq(userNotifications.activityAt, cursorDate), lt(userNotifications.id, parsedCursor.id)),
                    )
                    : undefined,
            ),
        )
        .orderBy(desc(userNotifications.activityAt), desc(userNotifications.id))
        .limit(safeLimit + 1);

    const hasMore = rows.length > safeLimit;
    const slice = hasMore ? rows.slice(0, safeLimit) : rows;
    const actorIds = Array.from(new Set(slice
        .map((row) => row.actorUserId)
        .filter((actorId): actorId is string => Boolean(actorId))));
    const actors = actorIds.length > 0
        ? await tx
            .select({ id: profiles.id, fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl })
            .from(profiles)
            .where(inArray(profiles.id, actorIds))
        : [];
    const actorById = new Map<string, NotificationActor>(actors.map((actor) => [actor.id, {
        name: actor.fullName || actor.username || null,
        avatarUrl: actor.avatarUrl ?? null,
    }]));
    const counts = await countUnreadNotifications(userId, tx);
    const last = slice[slice.length - 1];

    return {
        items: slice.map((row) => toNotificationItem(row, row.actorUserId ? actorById.get(row.actorUserId) ?? null : null)),
        hasMore,
        nextCursor: hasMore && last
            ? encodeNotificationCursor({
                activityAt: toIsoString(last.activityAt) ?? toIsoString(last.updatedAt) ?? toIsoString(last.createdAt) ?? new Date().toISOString(),
                id: last.id,
            })
            : null,
        unreadCount: counts.total,
        unreadImportantCount: counts.important,
    };
}
