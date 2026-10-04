// The Inbox's "All" tab merges two feeds (mentions/thread replies, and reactions)
// into one page, newest first, so its "Load more" cursor stays a single created_at.

/** Newest first across both lists, cut to one page. */
export function mergeByTime<T extends { created_at: string }>(a: readonly T[], b: readonly T[], limit: number) {
  return [...a, ...b].sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at)).slice(0, limit);
}

/** "3 mentions", "3 replies", "3 reactions", or "3 updates" when a group mixes kinds. */
export function groupNoun(kinds: readonly string[]) {
  const set = new Set(kinds.map((kind) => (kind === "thread_reply" ? "reply" : kind === "reaction" ? "reaction" : "mention")));
  if (set.size !== 1) return "updates";
  const only = [...set][0];
  return only === "reply" ? "replies" : only === "reaction" ? "reactions" : "mentions";
}
