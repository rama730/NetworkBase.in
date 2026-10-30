const inFlightPromises = new Map<string, Promise<unknown>>();

/** How long identical calls may share one promise. Past it, the next call runs fresh. */
const DEFAULT_SHARE_MS = 10_000;

/**
 * Shares the same in-flight promise for identical keys.
 * This is request dedupe, not result caching. A promise is shared for at most `shareMs`: a task that never
 * settles (a stalled connection) would otherwise make every later call with the key wait forever, until restart.
 */
export function runInFlightDeduped<T>(key: string, task: () => Promise<T>, shareMs = DEFAULT_SHARE_MS): Promise<T> {
  const existing = inFlightPromises.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const forget = () => {
    if (inFlightPromises.get(key) === next) inFlightPromises.delete(key);
  };
  const next = Promise.resolve().then(task).finally(() => {
    clearTimeout(expiry);
    forget();
  });
  const expiry = setTimeout(forget, shareMs);
  expiry.unref?.();

  inFlightPromises.set(key, next);
  return next;
}
