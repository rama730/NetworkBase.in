"use client";

import { create } from "zustand";

// The launcher window's in-memory state (C9): survives navigation, not reloads.
type Screen = { type: "list" } | { type: "channel"; channelId: string } | { type: "thread"; channelId: string; rootSeq: number } | { type: "new" };

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
  push: (screen) => set((state) => ({ open: true, stack: [...state.stack, screen] })),
  back: () => set((state) => ({ stack: state.stack.length > 1 ? state.stack.slice(0, -1) : state.stack })),
  close: () => set({ open: false, stack: [{ type: "list" }] }),
}));

/** Open a conversation in the floating window (C6). Callers check the route and width first. */
export function openChatWindow(channelId?: string) {
  const { push, setOpen } = useChatWindow.getState();
  if (channelId) push({ type: "channel", channelId });
  else setOpen(true);
}

/** True where "Message" buttons should use the window instead of navigating. */
export function prefersChatWindow() {
  return typeof window !== "undefined"
    && window.matchMedia("(min-width: 768px)").matches
    && !window.location.pathname.startsWith("/messages");
}
