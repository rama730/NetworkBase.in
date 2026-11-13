/** Web Push `Topic` must be ≤ 32 URL-safe base64 characters; a uuid without hyphens is exactly 32. */
export function chatPushTopic(channelId: string) {
  return channelId.replaceAll("-", "");
}

// ponytail: per-instance 30 s suppression per (user, channel) (L-11). ceiling:
// each server instance may send one extra push, which the push service then
// coalesces by Topic. upgrade: shared suppression if push volume or complaints grow.
export function createPushSuppressor(windowMs: number, maxEntries = 1_000) {
  const lastSent = new Map<string, number>();
  return function allow(userId: string, channelId: string, now = Date.now()) {
    const key = `${userId}:${channelId}`;
    const previous = lastSent.get(key);
    if (previous !== undefined && now - previous < windowMs) return false;
    if (lastSent.size >= maxEntries) {
      for (const [entry, at] of lastSent) {
        if (now - at >= windowMs) lastSent.delete(entry);
      }
      if (lastSent.size >= maxEntries) lastSent.clear();
    }
    lastSent.set(key, now);
    return true;
  };
}
