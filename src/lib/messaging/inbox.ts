// The Inbox's "All" tab merges two feeds (mentions/thread replies, and reactions) into one page.
// Both feeds, and the thread list, page by an opaque cursor that names the last row exactly:
// time alone repeats (COR-056), so the key also carries the channel, message and a source tie-break.

/** Position of one feed row: [time (µs, UTC), channel, message seq, source rank, source tie-break, scope]. */
export type FeedCursor = readonly [at: string, channelId: string, seq: number, rank: number, tie: string, scope: string];

const CURSOR_AT = /^(?:-infinity|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)$/;
const CURSOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cursor for `scope`, null when none was sent, or "invalid" when it is malformed or belongs to another feed. */
export function parseFeedCursor(raw: unknown, scope: string): FeedCursor | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 400) return "invalid";
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.length !== 6) return "invalid";
    const [at, channelId, seq, rank, tie, cursorScope] = value as unknown[];
    if (typeof at !== "string" || !CURSOR_AT.test(at)) return "invalid";
    if (typeof channelId !== "string" || !CURSOR_UUID.test(channelId)) return "invalid";
    if (!Number.isSafeInteger(seq) || !Number.isInteger(rank) || typeof tie !== "string" || tie.length > 200) return "invalid";
    if (cursorScope !== scope) return "invalid";
    return [at, channelId, seq as number, rank as number, tie, scope];
  } catch {
    return "invalid";
  }
}

function compareKeys(x: FeedCursor, y: FeedCursor) {
  // ISO strings with fixed width sort as time; "-infinity" sorts first, like the database.
  if (x[0] !== y[0]) return x[0] === "-infinity" ? -1 : y[0] === "-infinity" ? 1 : x[0] < y[0] ? -1 : 1;
  if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
  if (x[2] !== y[2]) return x[2] - y[2];
  if (x[3] !== y[3]) return x[3] - y[3];
  return x[4] === y[4] ? 0 : x[4] < y[4] ? -1 : 1; // code-unit order, the database compares this tie under COLLATE "C"
}

/** Newest first across both lists, cut to one page; rows with a cursor order exactly as the database does. */
export function mergeByTime<T extends { created_at: string; cursor?: string }>(a: readonly T[], b: readonly T[], limit: number) {
  const key = (item: T) => (item.cursor ? (JSON.parse(item.cursor) as FeedCursor) : null);
  return [...a, ...b].sort((x, y) => {
    const kx = key(x);
    const ky = key(y);
    return kx && ky ? compareKeys(ky, kx) : Date.parse(y.created_at) - Date.parse(x.created_at);
  }).slice(0, limit);
}

/** "3 mentions", "3 replies", "3 reactions", or "3 updates" when a group mixes kinds. */
export function groupNoun(kinds: readonly string[]) {
  const set = new Set(kinds.map((kind) => (kind === "thread_reply" ? "reply" : kind === "reaction" ? "reaction" : "mention")));
  if (set.size !== 1) return "updates";
  const only = [...set][0];
  return only === "reply" ? "replies" : only === "reaction" ? "reactions" : "mentions";
}
