const BATCH_WINDOW_MS = 16;
const BATCH_MAX = 100;

/**
 * Collects ids requested in the same tick into one server call (≤100 per
 * call), so a page of 40 cards makes one request, not 40.
 */
export function createBatcher<T>(load: (ids: string[]) => Promise<Map<string, T>>) {
  let pending = new Map<string, Array<{ resolve: (value: T | null) => void; reject: (error: unknown) => void }>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    const batch = pending;
    pending = new Map();
    timer = null;
    const ids = Array.from(batch.keys());
    for (let index = 0; index < ids.length; index += BATCH_MAX) {
      const slice = ids.slice(index, index + BATCH_MAX);
      try {
        const map = await load(slice);
        for (const id of slice) batch.get(id)?.forEach((waiter) => waiter.resolve(map.get(id) ?? null));
      } catch (error) {
        for (const id of slice) batch.get(id)?.forEach((waiter) => waiter.reject(error));
      }
    }
  };
  return (id: string) => new Promise<T | null>((resolve, reject) => {
    const waiters = pending.get(id) ?? [];
    waiters.push({ resolve, reject });
    pending.set(id, waiters);
    timer ??= setTimeout(() => void flush(), BATCH_WINDOW_MS);
  });
}
