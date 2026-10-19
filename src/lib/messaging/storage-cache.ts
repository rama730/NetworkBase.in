/** Purge the retired, account-unscoped timeline cache. Active messages use React Query. */
export function evictCachedTimelines(storage: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith("nb_chat_cache_")) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
