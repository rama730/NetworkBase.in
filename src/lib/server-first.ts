/**
 * A browser tab runs server actions one at a time, so a page's first reads are started on the server while the page
 * renders and handed down as a promise. This answers with that promise until it has settled and been used (a second
 * ask while it's still in flight, such as React's dev double mount, shares it); every later call (refetch, reload
 * after a change) loads afresh. If the started read failed, the first call loads instead.
 */
export function serverFirst<T>(started: PromiseLike<T> | null | undefined, load: () => Promise<T>): () => Promise<T> {
  // The promise React hands a client component is its own thenable whose `then` returns nothing, so `.catch` on it
  // gives undefined: wrap it in a real promise first.
  const first = started ? Promise.resolve(started).catch(() => load()) : null;
  let used = false;
  let settled = false;
  first?.then(() => { settled = true; });
  return () => {
    if (first && (!used || !settled)) {
      used = true;
      return first;
    }
    return load();
  };
}
