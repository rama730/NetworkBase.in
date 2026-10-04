"use client";

import { createContext, useContext } from "react";

/**
 * Inside the floating window, list screens (Inbox) open conversations and threads in the window
 * instead of navigating the page. Absent (null) on full pages.
 */
export type WindowNav = {
  /** `m`: the message to land on (an Inbox mention), not just the latest. */
  open: (channelId: string, rootSeq: number | null, m?: number | null) => void;
  back: () => void;
  actions: React.ReactNode;
};

export const WindowNavContext = createContext<WindowNav | null>(null);
export const useWindowNav = () => useContext(WindowNavContext);
