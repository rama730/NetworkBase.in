// Conversation URLs. The thread and details drawers are query params on the
// conversation, so opening one never unmounts the other or the timeline:
//   /messages/<id>?thread=12&details=members&m=40

export type DetailsTab = "about" | "members";
export const DETAILS_TABS: readonly DetailsTab[] = ["about", "members"];
// ponytail: sequence DTOs currently use PostgreSQL int4. ceiling: 2^31-1 per channel.
// upgrade: change the SQL projections and wire format together before reaching that limit.
export const MAX_MESSAGE_SEQ = 2_147_483_647;
export function isMessageSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_MESSAGE_SEQ;
}
export function parseMessageSeq(value: string | null | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const seq = Number(value);
  return isMessageSeq(seq) ? seq : null;
}

export type Panes = {
  thread?: number | null;
  details?: DetailsTab | null;
  /** Message to jump to and highlight. */
  m?: number | null;
  /** A conversation tab to open (canvas, pins…). */
  tab?: string | null;
  pane?: "thread" | "details" | null;
};

export function asDetailsTab(value: string | null | undefined): DetailsTab | null {
  if (value === "members") return "members";
  // Old links (?tab=pins|settings) and bare ?details open About.
  return value === undefined || value === null ? null : "about";
}

export function readPanes(params: Pick<URLSearchParams, "get">): Panes {
  const thread = parseMessageSeq(params.get("thread"));
  const details = asDetailsTab(params.get("details"));
  const pane = thread && details ? (params.get("pane") === "details" ? "details" : "thread") : null;
  return { m: parseMessageSeq(params.get("m")), thread, details, tab: params.get("tab") || null, pane };
}

/** Patch only owned fields; preserve other URL state. Null explicitly closes a view. */
export function patchConversationParams(current: string, patch: Panes): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const key of ["m", "thread", "details", "tab", "pane"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value == null || value === "" || (key === "tab" && value === "messages")) params.delete(key);
    else params.set(key, String(value));
  }
  for (const key of ["m", "thread"] as const) {
    const value = parseMessageSeq(params.get(key));
    if (value === null) params.delete(key);
    else params.set(key, String(value));
  }
  const details = asDetailsTab(params.get("details"));
  if (details) params.set("details", details);
  if (!params.has("thread") || !details) params.delete("pane");
  else if (params.has("pane")) params.set("pane", params.get("pane") === "details" ? "details" : "thread");
  return params;
}

export function conversationHref(channelId: string, panes: Panes = {}, current = "") {
  const params = patchConversationParams(current, panes);
  const query = params.toString();
  return `/messages/${channelId}${query ? `?${query}` : ""}`;
}

export function threadHref(channelId: string, rootSeq: number, panes: Omit<Panes, "thread"> = {}, current = "") {
  return conversationHref(channelId, { ...panes, thread: rootSeq }, current);
}

/** A message's own link: thread replies open their thread (replies aren't in the main timeline). */
export function messageHref(channelId: string, seq: number, threadRootSeq?: number | null) {
  return conversationHref(channelId, threadRootSeq ? { thread: threadRootSeq, m: seq } : { m: seq });
}

/** "Show in conversation": at 1024px+ the thread stays open beside it; below, the thread covers the screen, so it closes. */
export function showInConversationHref(channelId: string, rootSeq: number, current = "") {
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
  return conversationHref(channelId, { m: rootSeq, thread: wide ? rootSeq : null, tab: null }, current);
}

/** Opened from a profile, workspace or notification rather than from Messages itself (unified back R1). */
export function cameFromOutsideMessages(from: { path: string } | null): boolean {
  return Boolean(from?.path) && !/^\/messages(\/|\?|$)/.test(from!.path);
}
