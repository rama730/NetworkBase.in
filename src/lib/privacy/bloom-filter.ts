/**
 * Redis SET for O(1) blocked-pair lookups.
 * Uses Redis SET commands (SADD, SREM, SISMEMBER) for exact membership checks.
 * No false positives or false negatives.
 *
 * PURE OPTIMIZATION: Eliminates DB queries for the common case
 * where users are NOT blocked (99%+ of all privacy checks).
 */

import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

const BLOCKED_PAIRS_KEY = 'blocked_pairs';

/**
 * Normalizes a pair to a canonical key so A:B == B:A.
 */
function canonicalPairKey(userA: string, userB: string): string {
    return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}

/**
 * Adds a blocked pair to the Redis SET.
 * Call this whenever a user blocks another.
 */
export async function addBlockedPair(userA: string, userB: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const key = canonicalPairKey(userA, userB);
        await redis.sadd(BLOCKED_PAIRS_KEY, key);
    } catch (error) {
        logger.warn('[blocked-pairs] addBlockedPair failed:', { error: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * Removes a blocked pair from the Redis SET.
 * Call this whenever a user unblocks another.
 */
export async function removeBlockedPair(userA: string, userB: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const key = canonicalPairKey(userA, userB);
        await redis.srem(BLOCKED_PAIRS_KEY, key);
    } catch (error) {
        logger.warn('[blocked-pairs] removeBlockedPair failed:', { error: error instanceof Error ? error.message : String(error) });
    }
}

