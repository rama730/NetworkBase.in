import { Redis } from '@upstash/redis'
import { logger } from '@/lib/logger'

export type CacheEnvelope<T> = {
    value: T
    cachedAt: number
    staleAt: number | null
    expiresAt: number | null
}

declare global {
    var __redisClient: Redis | null | undefined
    var __redisCacheFailureLoggedAt: number | undefined
}

const CACHE_FAILURE_LOG_INTERVAL_MS = 60_000

function recordCacheFailure(operation: 'get' | 'set', error: unknown) {
    const now = Date.now()
    if (now - (globalThis.__redisCacheFailureLoggedAt ?? 0) < CACHE_FAILURE_LOG_INTERVAL_MS) return
    globalThis.__redisCacheFailureLoggedAt = now
    logger.warn('redis.cache.unavailable', {
        module: 'redis',
        operation,
        error: error instanceof Error ? error.message : String(error),
    })
}

function hasRedisEnv() {
    return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

function createRedisClient() {
    if (!hasRedisEnv()) {
        return null
    }

    return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
        signal: () => AbortSignal.timeout(1_500),
        retry: { retries: 1, backoff: () => 50 },
    })
}

export function getRedisClient(): Redis | null {
    if (globalThis.__redisClient !== undefined && globalThis.__redisClient !== null) {
        return globalThis.__redisClient
    }
    if (!hasRedisEnv()) {
        return null
    }

    try {
        globalThis.__redisClient = createRedisClient()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('redis.initialization.failed', { module: 'redis', error: message })
        globalThis.__redisClient = null
    }

    return globalThis.__redisClient ?? null
}

/** The shared client, or null when Redis is not configured (MAINT-001): a real null, so `if (!redis)` means what it says. */
export const redis: Redis | null = getRedisClient()

function isFiniteNumberOrNull(value: unknown) {
    return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isCacheEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
    const candidate = value as CacheEnvelope<T>
    return !!value
        && typeof value === 'object'
        && 'value' in candidate
        && typeof candidate.cachedAt === 'number'
        && Number.isFinite(candidate.cachedAt)
        && isFiniteNumberOrNull(candidate.staleAt)
        && isFiniteNumberOrNull(candidate.expiresAt)
}

async function setJsonValue<T>(key: string, payload: T, ttlSeconds: number) {
    const client = getRedisClient()
    if (!client) return
    try {
        await client.set(key, JSON.stringify(payload), { ex: ttlSeconds })
    } catch (error) {
        // Application caches are optional. A cache timeout must not fail the
        // authoritative database request or the page that triggered it.
        recordCacheFailure('set', error)
    }
}

async function getJsonValue<T>(key: string): Promise<T | null> {
    const client = getRedisClient()
    if (!client) return null

    let raw: unknown
    try {
        raw = await client.get<unknown>(key)
    } catch (error) {
        // Treat cache transport failures as misses. Callers will read the
        // authoritative source and may repopulate the cache later.
        recordCacheFailure('get', error)
        return null
    }
    if (!raw) return null

    if (typeof raw !== 'string') {
        return raw as T
    }

    try {
        return JSON.parse(raw) as T
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('redis.parse.failed', { module: 'redis', key, error: message })
        return null
    }
}

export async function cacheData<T>(key: string, data: T, ttlSeconds: number = 60): Promise<void> {
    await setJsonValue(key, data, ttlSeconds)
}

export async function cacheStaleableData<T>(
    key: string,
    value: T,
    input: {
        freshTtlSeconds: number
        staleTtlSeconds?: number
    }
): Promise<void> {
    const freshTtlSeconds = Math.max(1, Math.trunc(input.freshTtlSeconds))
    const staleTtlSeconds = Math.max(0, Math.trunc(input.staleTtlSeconds ?? 0))
    const cachedAt = Date.now()
    const envelope: CacheEnvelope<T> = {
        value,
        cachedAt,
        staleAt: cachedAt + freshTtlSeconds * 1000,
        expiresAt: cachedAt + (freshTtlSeconds + staleTtlSeconds) * 1000,
    }

    await setJsonValue(key, envelope, freshTtlSeconds + staleTtlSeconds)
}

export async function getCacheEnvelope<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const cached = await getJsonValue<CacheEnvelope<T> | T>(key)
    if (!cached) return null

    if (isCacheEnvelope<T>(cached)) {
        return cached
    }

    const now = Date.now()
    return {
        value: cached,
        cachedAt: now,
        staleAt: null,
        expiresAt: null,
    }
}

/**
 * Check if a cache envelope is stale (past freshTtl but not yet expired).
 * Consumers can use this to trigger background revalidation.
 */
export function isCacheStale<T>(envelope: CacheEnvelope<T>): boolean {
    return envelope.staleAt !== null && Date.now() > envelope.staleAt
}

export async function getCachedData<T>(key: string): Promise<T | null> {
    const envelope = await getCacheEnvelope<T>(key)
    return envelope?.value ?? null
}

export async function rateLimit(identifier: string, limit: number = 10, windowSeconds: number = 60): Promise<boolean> {
    const { consumeRateLimit } = await import('@/lib/security/rate-limit')
    const result = await consumeRateLimit(identifier, limit, windowSeconds)
    return result.allowed
}
