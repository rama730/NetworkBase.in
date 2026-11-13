// ponytail: in-memory token bucket per server instance for sends and
// reactions (L-3). ceiling: the effective limit is multiplied by the instance
// count. upgrade: Redis rateLimit() for that action once abuse is seen.
export function createTokenBucket(options: { capacity: number; refillPerSecond: number; maxKeys?: number }) {
  const { capacity, refillPerSecond, maxKeys = 2_000 } = options;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return function take(key: string, now = Date.now()) {
    const bucket = buckets.get(key) ?? { tokens: capacity, at: now };
    const tokens = Math.min(capacity, bucket.tokens + ((now - bucket.at) / 1000) * refillPerSecond);
    if (tokens < 1) {
      buckets.set(key, { tokens, at: now });
      return false;
    }
    if (!buckets.has(key) && buckets.size >= maxKeys) buckets.clear();
    buckets.set(key, { tokens: tokens - 1, at: now });
    return true;
  };
}

/** 10 messages burst, 1 per second sustained, per user. */
export const takeSendToken = createTokenBucket({ capacity: 10, refillPerSecond: 1 });
/** 20 reactions burst, 2 per second sustained, per user. */
export const takeReactToken = createTokenBucket({ capacity: 20, refillPerSecond: 2 });
