"use client";

import { create } from "zustand";

// The launcher window's in-memory state (C9): survives navigation, not reloads.
type Screen = { type: "list" } | { type: "inbox" } | { type: "channel"; channelId: string; m?: number | null } | { type: "thread"; channelId: string; rootSeq: number; m?: number | null } | { type: "new" };

type ChatWindowState = {
  open: boolean;
  stack: Screen[];
  setOpen: (open: boolean) => void;
  push: (screen: Screen) => void;
  back: () => void;
  /** Close also clears the active chat; drafts stay in localStorage. */
  close: () => void;
};

export const useChatWindow = create<ChatWindowState>()((set) => ({
  open: false,
  stack: [{ type: "list" }],
  setOpen: (open) => set({ open }),
  // Opening the screen already on top (a double click) doesn't stack it twice.
  push: (screen) => set((state) => {
    const top = state.stack[state.stack.length - 1];
    const same = top && JSON.stringify(top) === JSON.stringify(screen);
    return { open: true, stack: same ? state.stack : [...state.stack, screen] };
  }),
  back: () => set((state) => ({ stack: state.stack.length > 1 ? state.stack.slice(0, -1) : state.stack })),
  close: () => set({ open: false, stack: [{ type: "list" }] }),
}));

/** Open a conversation in the floating window (C6). Callers check the route and width first. */
export function openChatWindow(channelId?: string) {
  const { push, setOpen } = useChatWindow.getState();
  if (channelId) push({ type: "channel", channelId });
  else setOpen(true);
}

/** The window (and its launcher) exists at this width and up, never on these routes. */
export const CHAT_WINDOW_QUERY = "(min-width: 768px)";
const NO_WINDOW_PREFIXES = ["/messages", "/projects/new", "/my-profile/edit"];

export function chatWindowHiddenOn(pathname: string) {
  return NO_WINDOW_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** True where "Message" buttons should use the window instead of navigating. */
export function prefersChatWindow() {
  return typeof window !== "undefined"
    && window.matchMedia(CHAT_WINDOW_QUERY).matches
    && !chatWindowHiddenOn(window.location.pathname);
}
