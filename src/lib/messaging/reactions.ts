// One quick-reaction set for the hover bar, the touch sheet and the picker:
// your recently used first, then the defaults.

export const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"] as const;
export const QUICK_COUNT = 6;
const RECENT_MAX = 6;

export function quickReactions(recent: readonly string[]) {
  return [...new Set([...recent, ...DEFAULT_REACTIONS])].slice(0, QUICK_COUNT);
}

/** `emoji` moves to the front of the recent list. */
export function pushRecent(recent: readonly string[], emoji: string) {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
}
