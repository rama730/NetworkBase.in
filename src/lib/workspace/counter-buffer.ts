import { inngest } from '@/inngest/client';
import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

/**
 * Queues a counter refresh for a specific user.
 * This is the high-scale entry point for all counter updates.
 * Instead of recalculating immediately, it adds the user to a "dirty" set
 * and triggers an Inngest background job to handle batching and debouncing.
 */
export async function queueCounterRefresh(userId: string) {
    const redis = getRedisClient();
    if (!redis) {
        // Fallback: If Redis is down, dispatch non-blocking refresh trigger
        void inngest.send({
            name: "workspace/counters.refresh",
            data: { userId },
        }).catch((err) => {
            logger.warn('counter-buffer.inngest.trigger.failed', {
                module: 'workspace',
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        });
        return;
    }

    const alreadyQueued = await redis.sadd('profile_counters:dirty_users', userId);

    // Truly non-blocking background trigger: never block user mutation path with network retries
    if (alreadyQueued > 0) {
        void inngest.send({
            name: "workspace/counters.refresh",
            data: { userId },
        }).catch((err) => {
            logger.warn('counter-buffer.inngest.trigger.failed', {
                module: 'workspace',
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
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
