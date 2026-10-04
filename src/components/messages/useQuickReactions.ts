"use client";

import { useSyncExternalStore } from "react";

import { DEFAULT_REACTIONS, pushRecent, quickReactions } from "@/lib/messaging/reactions";

// Recently used reactions, per device (localStorage); every access tolerates blocked storage.
const KEY = "chat-recent-reactions";
const listeners = new Set<() => void>();
let snapshot: string[] | null = null;

function readRecent(): string[] {
  if (snapshot) return snapshot;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    snapshot = quickReactions(Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : []);
  } catch {
    snapshot = quickReactions([]);
  }
  return snapshot;
}

/** Remember a reaction you just added. */
export function noteReaction(emoji: string) {
  let recent: string[] = [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    recent = Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    // Storage blocked: the list lives for this page only.
  }
  const next = pushRecent(recent, emoji);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked.
  }
  snapshot = quickReactions(next);
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const serverSnapshot = [...DEFAULT_REACTIONS];

/** Six quick reactions: recently used first, then the defaults. */
export function useQuickReactions() {
  return useSyncExternalStore(subscribe, readRecent, () => serverSnapshot);
}
