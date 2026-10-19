import { getRedisClient } from '@/lib/redis';
import { randomUUID } from 'node:crypto';

const IDEMPOTENCY_RESULT_TTL_SECONDS = 86_400; // 24 hours
const IDEMPOTENCY_PENDING_TTL_SECONDS = 60;
const PENDING_PREFIX = '__PENDING__:';

// Lua atomic publish: only overwrite the pending marker if we are still its owner.
const PUBLISH_RESULT_LUA = `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

type RedisEvaller = {
  eval: (script: string, keys: string[], args: string[]) => Promise<number | string | null>;
};

async function publishIdempotencyResult(
  redis: unknown,
  redisKey: string,
  pendingMarker: string,
  result: string,
  ttlSeconds: number = IDEMPOTENCY_RESULT_TTL_SECONDS,
): Promise<boolean> {
  try {
    const ret = await (redis as RedisEvaller).eval(
      PUBLISH_RESULT_LUA,
      [redisKey],
      [pendingMarker, result, String(ttlSeconds)],
    );
    return Number(ret) === 1;
  } catch {
    return false;
  }
}

type IdempotencyCheckResult =
  | { isDuplicate: false; lockToken?: string }
  | { isDuplicate: true; cachedResponse?: string; isPending?: boolean };

export type RunIdempotentOptions = {
  /** Logical namespace so keys never collide across features. */
  namespace: string;
  /** Optional scope (e.g., user id) so a key from user A does not replay user B's result. */
  scopeId?: string | null;
  /** The caller-supplied idempotency key. If empty/undefined, the operation runs without dedup. */
  key: string | null | undefined;
  /** How long (seconds) to hold the pending marker while the operation runs. */
  pendingTtlSeconds?: number;
  /** How long (seconds) to retain the serialized result for replay. */
  resultTtlSeconds?: number;
};

export type RunIdempotentOutcome<T> = {
  result: T;
  /** True when we returned a cached result instead of running `fn`. */
  replayed: boolean;
  /** True when Redis was unavailable and we executed without dedup protection. */
  degraded: boolean;
};

export class IdempotencyConflictError extends Error {
  constructor(message = 'A request with this idempotency key is already in flight.') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

function normalizeIdempotencyScope(scopeId: string | null | undefined) {
  const normalized = scopeId?.trim();
  return normalized || "anonymous";
}

function getIdempotencyRedisKey(namespace: string, key: string, scopeId?: string | null) {
  return `idempotency:${namespace}:${normalizeIdempotencyScope(scopeId)}:${key}`;
}

function getPendingMarker(lockToken: string) {
  return `${PENDING_PREFIX}${lockToken}`;
}

/**
 * Check if an idempotency key has already been used for a given namespace.
 * Returns { isDuplicate: true, cachedResponse } if the key was already processed.
 * Returns { isDuplicate: false } if this is a new request.
 */
async function checkIdempotencyKey(
  request: Request,
  namespace: string,
  scopeId?: string | null,
): Promise<IdempotencyCheckResult> {
  const key = request.headers.get('idempotency-key');
  if (!key) return { isDuplicate: false };

  const redis = getRedisClient();
  if (!redis) return { isDuplicate: false };

  const redisKey = getIdempotencyRedisKey(namespace, key, scopeId);
  const lockToken = randomUUID();
  const pendingMarker = getPendingMarker(lockToken);

  try {
    const acquired = await redis.set(redisKey, pendingMarker, {
      nx: true,
      ex: IDEMPOTENCY_PENDING_TTL_SECONDS,
    });

    if (acquired) {
      return { isDuplicate: false, lockToken };
    }

    const cached = await redis.get(redisKey);
    if (cached !== null) {
      if (typeof cached === 'string' && cached.startsWith(PENDING_PREFIX)) {
        return { isDuplicate: true, isPending: true };
      }

      return {
        isDuplicate: true,
        cachedResponse: typeof cached === 'string' ? cached : JSON.stringify(cached),
      };
    }
  } catch {
    // Redis failure should not block the request
  }

  return { isDuplicate: false };
}

/**
 * Save the result of an idempotent operation so duplicate requests
 * return the same response.
 */
async function saveIdempotencyResult(
  request: Request,
  namespace: string,
  result: string,
  lockToken?: string,
  scopeId?: string | null,
): Promise<boolean> {
  const key = request.headers.get('idempotency-key');
  if (!key || !lockToken) return false;

  const redis = getRedisClient();
  if (!redis) return false;

  const redisKey = getIdempotencyRedisKey(namespace, key, scopeId);
  const pendingMarker = getPendingMarker(lockToken);

  try {
    const publishResult = await (redis as unknown as {
      eval: (script: string, keys: string[], args: string[]) => Promise<number | string | null>
    }).eval(
      `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
      `,
      [redisKey],
      [pendingMarker, result, String(IDEMPOTENCY_RESULT_TTL_SECONDS)],
    );

    return Number(publishResult) === 1;
  } catch {
    // Best-effort — don't fail the original request
    return false;
  }
}

/**
 * SEC-H14: server-action-level idempotency.
 *
 * Wraps a state-changing callback with a Redis-backed "run once, replay the
 * result on retry" guarantee. Unlike `checkIdempotencyKey` which operates on
 * the HTTP `Idempotency-Key` header for route handlers, this variant is for
 * RPC-style Next.js server actions where the caller passes the key in the
 * action payload.
 *
 * Behavior:
 *   - If `key` is empty/undefined, the fn is executed directly with no dedup.
 *   - If Redis is unavailable, the fn is executed directly and `degraded=true`.
 *   - If a previous call with the same (namespace, scopeId, key) finished and
 *     its serialized result is still cached, we skip `fn` and return the
 *     cached result (`replayed=true`). The result is round-tripped through
 *     JSON, so `T` must be JSON-serializable — Date/Map/Set/undefined will not
 *     survive the trip. Callers that need richer types should narrow before
 *     invoking.
 *   - If the previous call is still in flight (pending marker present), we
 *     throw `IdempotencyConflictError` so the caller can tell the user "your
 *     previous request is still running" instead of double-submitting.
 *   - On successful execution we publish the result atomically via Lua, only
 *     if we are still the owner of the pending marker (otherwise the TTL
 *     expired and someone else may have taken over — we return our result but
 *     do not stomp theirs).
 */
export async function runIdempotent<T>(
  options: RunIdempotentOptions,
  fn: () => Promise<T>,
): Promise<RunIdempotentOutcome<T>> {
  const key = options.key?.trim();
  if (!key) {
    const result = await fn();
    return { result, replayed: false, degraded: false };
  }

  const redis = getRedisClient();
  if (!redis) {
    const result = await fn();
    return { result, replayed: false, degraded: true };
  }

  const redisKey = getIdempotencyRedisKey(options.namespace, key, options.scopeId);
  const pendingTtl = options.pendingTtlSeconds ?? IDEMPOTENCY_PENDING_TTL_SECONDS;
  const resultTtl = options.resultTtlSeconds ?? IDEMPOTENCY_RESULT_TTL_SECONDS;
  const lockToken = randomUUID();
  const pendingMarker = getPendingMarker(lockToken);

  let acquired = false;
  try {
    const acquireResult = await redis.set(redisKey, pendingMarker, {
      nx: true,
      ex: pendingTtl,
    });
    acquired = Boolean(acquireResult);
  } catch {
    // Redis hiccup while acquiring — fall through to direct execution.
    const result = await fn();
    return { result, replayed: false, degraded: true };
  }

  if (!acquired) {
    try {
      const cached = await redis.get(redisKey);
      if (cached !== null && cached !== undefined) {
        const serialized = typeof cached === 'string' ? cached : JSON.stringify(cached);
        if (serialized.startsWith(PENDING_PREFIX)) {
          throw new IdempotencyConflictError();
        }
        const parsed = JSON.parse(serialized) as { __idem_v?: number; value?: unknown };
        if (parsed && typeof parsed === 'object' && parsed.__idem_v === 1) {
          return {
            result: parsed.value as T,
            replayed: true,
            degraded: false,
          };
        }
        // Unknown envelope shape — treat as poisoned and re-run rather than
        // returning something the caller does not expect.
      }
    } catch (err) {
      if (err instanceof IdempotencyConflictError) throw err;
      // Unreadable cache: fall through to run directly.
    }
    const result = await fn();
    return { result, replayed: false, degraded: true };
  }

  // We own the pending marker — execute and publish.
  const result = await fn();
  const serialized = JSON.stringify({ __idem_v: 1, value: result });
  // Intentionally fire-and-forget the publish failure case: the operation
  // already committed, so we still return the value even if we can no longer
  // stamp the result (e.g., TTL lapsed and another caller took over).
  await publishIdempotencyResult(redis, redisKey, pendingMarker, serialized, resultTtl).catch(() => false);
  return { result, replayed: false, degraded: false };
}

const RELEASE_LOCK_LUA = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Deletes our pending marker (compare-token), so a retry with the same key can run. */
export async function releaseIdempotencyLock(
  request: Request,
  namespace: string,
  lockToken: string | undefined,
  scopeId?: string | null,
): Promise<void> {
  const key = request.headers.get('idempotency-key');
  if (!key || !lockToken) return;
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await (redis as unknown as RedisEvaller).eval(
      RELEASE_LOCK_LUA,
      [getIdempotencyRedisKey(namespace, key, scopeId)],
      [getPendingMarker(lockToken)],
    );
  } catch {
    // The marker expires on its own after IDEMPOTENCY_PENDING_TTL_SECONDS.
  }
}

/**
 * Route-level idempotency with the `Idempotency-Key` header (best-effort, Redis-backed: when Redis is
 * unavailable the handler simply runs). The handler's own response is what gets cached and replayed,
 * so a replay is byte-identical to the first answer (API-010).
 *   - 2xx: the exact response body is stored and replayed with status 200. Responses carrying secrets
 *     (`replayBody: false`) are never stored: the marker stays until it expires and duplicates get 409.
 *   - 4xx: the request was rejected before doing its work (validation, authorization, proof), so the
 *     pending marker is released and the client may retry with the same key (API-011).
 *   - 5xx or a thrown error: the outcome is unknown, so the marker stays until it expires.
 * Run validation and authorization inside the handler, before the side effect.
 */
export async function withIdempotentRoute(
  request: Request,
  options: { namespace: string; scopeId?: string | null; replayBody?: boolean },
  handler: () => Promise<Response>,
): Promise<Response> {
  const check = await checkIdempotencyKey(request, options.namespace, options.scopeId);
  if (check.isDuplicate) {
    if (check.cachedResponse) {
      return new Response(check.cachedResponse, {
        status: 200,
        headers: { 'content-type': 'application/json', 'idempotency-replayed': 'true' },
      });
    }
    return Response.json(
      { success: false, message: 'Request is already being processed', errorCode: 'CONFLICT' },
      { status: 409 },
    );
  }

  const response = await handler();
  if (response.status >= 200 && response.status < 300) {
    if (options.replayBody !== false) await saveIdempotencyResult(request, options.namespace, await response.clone().text(), check.lockToken, options.scopeId);
  } else if (response.status >= 400 && response.status < 500) {
    await releaseIdempotencyLock(request, options.namespace, check.lockToken, options.scopeId);
  }
  return response;
}
