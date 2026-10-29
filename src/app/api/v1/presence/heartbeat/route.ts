import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/app/api/v1/_envelope';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { isTransientDbError, readDbErrorCode, withDbRetry } from '@/lib/db/retry';
import { profiles } from '@/lib/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { validateCsrf } from '@/lib/security/csrf';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { logger } from '@/lib/logger';
import { LIVE_TTL_SECONDS } from '@/lib/presence/model';
import { getRedisClient } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LAST_SEEN_WINDOW_MS = 5 * 60_000;
const TIME_ZONE_TTL_SECONDS = 30 * 24 * 60 * 60;

function isTimeZone(value: string) {
    if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value) || value.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;
        const rlResponse = await enforceRouteLimit(request, 'api:v1:presence:heartbeat', 30, 60);
        if (rlResponse) return rlResponse;

        const auth = await getViewerAuthContext();
        if (!auth.userId || !auth.user) return jsonError('Sign in to continue', 401, 'UNAUTHORIZED');

        const userId = auth.userId;
        // Hidden activity: record nothing (no live key, no last-active).
        const [own] = await db.select({ showActivity: profiles.showActivity }).from(profiles).where(eq(profiles.id, userId)).limit(1);
        if (own && !own.showActivity) return jsonSuccess({ updated: false, hidden: true });
        // "Active now" everywhere: a short-lived key per engaged person, kept off the database.
        // ponytail: one Redis SET per engaged user per minute. ceiling: Upstash request
        // budget at very large concurrency. upgrade: batch via a presence worker.
        await getRedisClient()?.set(`presence:live:${userId}`, '1', { ex: LIVE_TTL_SECONDS }).catch(() => undefined);
        // The viewer's time zone, for "local time" in chat details; hidden activity never reaches here.
        const tz = await request.json().then((body: { tz?: unknown }) => body?.tz).catch(() => null);
        if (typeof tz === 'string' && isTimeZone(tz)) {
            await getRedisClient()?.set(`presence:tz:${userId}`, tz, { ex: TIME_ZONE_TTL_SECONDS }).catch(() => undefined);
        }
        try {
            const updated = await withDbRetry("presence.heartbeat.last_active", () => db
                .update(profiles)
                .set({ lastActiveAt: new Date() })
                .where(and(
                    eq(profiles.id, userId),
                    eq(profiles.showActivity, true),
                    or(isNull(profiles.lastActiveAt), lt(profiles.lastActiveAt, new Date(Date.now() - LAST_SEEN_WINDOW_MS))),
                ))
                .returning({ id: profiles.id }), { module: "presence" });
            return jsonSuccess({ updated: updated.length > 0 });
        } catch (error) {
            if (!isTransientDbError(error)) throw error;
            logger.warn("presence.heartbeat_last_active_skipped", {
                module: "presence",
                userId,
                errorCode: readDbErrorCode(error),
                error: error instanceof Error ? error.message : String(error),
            });
            return jsonSuccess({ updated: false, skipped: "transient_db" });
        }
    } catch (error) {
        console.error('Presence heartbeat error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}

/** Tab closing: drop the live key so others see "not live" now, not after the TTL. */
export async function DELETE(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;
        const auth = await getViewerAuthContext();
        if (!auth.userId) return jsonError('Sign in to continue', 401, 'UNAUTHORIZED');
        await getRedisClient()?.del(`presence:live:${auth.userId}`).catch(() => undefined);
        return jsonSuccess({ live: false });
    } catch (error) {
        console.error('Presence offline error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
