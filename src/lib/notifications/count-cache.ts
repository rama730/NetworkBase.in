import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

/** The bell's count is cached for 60 s; any write that changes it drops the cache (one DEL for a whole batch). */
export function invalidateNotificationCounts(userIds: string[]) {
    const keys = Array.from(new Set(userIds.filter(Boolean))).map((id) => `unread:notif:${id}`);
    const redis = getRedisClient();
    if (!redis || keys.length === 0) return;
    void redis.del(...keys).catch((err: unknown) => {
        logger.warn("notifications.cache_invalidate_failed", {
            module: "notifications",
            keys: keys.length,
            error: err instanceof Error ? err.message : String(err),
        });
    });
}
