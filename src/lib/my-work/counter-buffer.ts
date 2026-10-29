import { inngest } from '@/inngest/client';
import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

/** Per-user "refresh already queued" marker; it expires on its own so a lost dispatch cannot suppress refreshes for good (COR-015). */
export const COUNTER_REFRESH_MARKER_TTL_SECONDS = 300;
export const counterRefreshMarkerKey = (userId: string) => `profile_counters:queued:${userId}`;

function dispatchRefresh(userId: string) {
    return inngest.send({
        name: "my-work/counters.refresh",
        data: { userId },
    });
}

/**
 * Queues a counter refresh for a specific user.
 * Instead of recalculating immediately it sets an expiring marker (one refresh per window is enough)
 * and triggers an Inngest background job that debounces and batches. If the trigger fails the marker
 * is removed, and if even that fails it expires, so the next mutation queues work again.
 */
export async function queueCounterRefresh(userId: string) {
    const redis = getRedisClient();
    const failed = (err: unknown) => logger.warn('counter-buffer.inngest.trigger.failed', {
        module: 'workspace',
        userId,
        error: err instanceof Error ? err.message : String(err),
    });
    if (!redis) {
        // Fallback: If Redis is down, dispatch non-blocking refresh trigger
        void dispatchRefresh(userId).catch(failed);
        return;
    }

    const marker = counterRefreshMarkerKey(userId);
    const acquired = await redis.set(marker, "1", { nx: true, ex: COUNTER_REFRESH_MARKER_TTL_SECONDS });

    // Truly non-blocking background trigger: never block user mutation path with network retries
    if (acquired) {
        void dispatchRefresh(userId).catch(async (err) => {
            failed(err);
            await redis.del(marker).catch(() => undefined);
        });
    }
}

/**
 * Best-effort version of counter refresh.
 * Swallows all errors and processes multiple user IDs in parallel.
 */
export async function queueCounterRefreshBestEffort(userIds: (string | null)[]) {
    try {
        const validIds = userIds.filter((id): id is string => id !== null);
        if (validIds.length === 0) return;

        await Promise.allSettled(validIds.map((userId) => queueCounterRefresh(userId)));
    } catch (err) {
        logger.warn('counter-buffer.best-effort.failed', {
            module: 'workspace',
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
