/**
 * A browser tab runs server actions one at a time, so an organization tab's first read is started on the server while
 * the page renders and handed down as a promise. This uses that promise once; every later call (refetch, reload after
 * a change) loads afresh.
 */
export function serverFirst<T>(started: Promise<T> | null | undefined, load: () => Promise<T>): () => Promise<T> {
  let pending = started ?? null;
  return () => {
    const first = pending;
    pending = null;
    return first ?? load();
  };
}
