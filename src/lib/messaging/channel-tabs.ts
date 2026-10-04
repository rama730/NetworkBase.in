// The tabs over a conversation. Messages, Pins and the canvas are built in;
// Files, Tasks and bookmarks are added from "+" and stored in chat_channel_tabs,
// shared by everyone in the channel (0187, 0188), so a tab you add is there for the team.

export type ChannelTabKind = "messages" | "pins" | "files" | "canvas" | "tasks" | "link";

export type ChannelTabItem = {
  id: string;
  kind: ChannelTabKind;
  title: string;
  url?: string | null;
  /** Shared tabs (Files, Tasks, bookmarks) can be closed, renamed and reordered. */
  shared?: boolean;
};

/** Built-in tabs first, then the shared ones in their saved order. */
export function conversationTabs(options: {
  pinCount: number;
  canvasTitle: string | null;
  canvasHidden: boolean;
  active: string;
  shared: { id: string; kind: "tasks" | "link" | "files"; title: string; url: string | null }[];
  projectId: string | null;
}): ChannelTabItem[] {
  const tabs: ChannelTabItem[] = [{ id: "messages", kind: "messages", title: "Messages" }];
  if (options.canvasTitle !== null && (!options.canvasHidden || options.active === "canvas")) tabs.push({ id: "canvas", kind: "canvas", title: options.canvasTitle });
  if (options.pinCount > 0 || options.active === "pins") tabs.push({ id: "pins", kind: "pins", title: "Pins" });
  // Files opened from the menu or Details before anyone added the tab shows while open.
  if (options.active === "files" && !options.shared.some((tab) => tab.kind === "files")) tabs.push({ id: "files", kind: "files", title: "Files" });
  for (const tab of options.shared) {
    // Tasks need a project; a stale Tasks tab in a project-less channel stays hidden.
    if (tab.kind === "tasks" && !options.projectId) continue;
    tabs.push({ id: tab.id, kind: tab.kind, title: tab.title, url: tab.url, shared: true });
  }
  return tabs;
}
