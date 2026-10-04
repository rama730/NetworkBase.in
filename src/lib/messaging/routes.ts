// Conversation URLs. The thread and details drawers are query params on the
// conversation, so opening one never unmounts the other or the timeline:
//   /messages/<id>?thread=12&details=members&m=40

export type DetailsTab = "about" | "members";
export const DETAILS_TABS: readonly DetailsTab[] = ["about", "members"];

export type Panes = {
  thread?: number | null;
  details?: DetailsTab | null;
  /** Message to jump to and highlight. */
  m?: number | null;
};

export function asDetailsTab(value: string | null | undefined): DetailsTab | null {
  if (value === "members") return "members";
  // Old links (?tab=pins|settings) and bare ?details open About.
  return value === undefined || value === null ? null : "about";
}

export function conversationHref(channelId: string, panes: Panes = {}) {
  const params = new URLSearchParams();
  if (panes.m) params.set("m", String(panes.m));
  if (panes.thread) params.set("thread", String(panes.thread));
  if (panes.details) params.set("details", panes.details);
  const query = params.toString();
  return `/messages/${channelId}${query ? `?${query}` : ""}`;
}

export function threadHref(channelId: string, rootSeq: number) {
  return conversationHref(channelId, { thread: rootSeq });
}

/** A message's own link: thread replies open their thread (replies aren't in the main timeline). */
export function messageHref(channelId: string, seq: number, threadRootSeq?: number | null) {
  return conversationHref(channelId, threadRootSeq ? { thread: threadRootSeq, m: seq } : { m: seq });
}
