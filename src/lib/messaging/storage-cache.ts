/**
 * Client-side fast timeline cache (1M-Scale Pure Performance: Section 2.1).
 * Caches the latest page of messages per channel in memory and sessionStorage/localStorage
 * to enable instant (<5ms) channel switching without blank/skeleton layout shifts.
 */

import type { ChatMessageView } from "./types";

const MEMORY_CACHE = new Map<string, { messages: ChatMessageView[]; cachedAt: number }>();
const STORAGE_PREFIX = "nb_chat_cache_";
const MAX_CACHE_ENTRIES = 25;
const MAX_MESSAGES_PER_CHANNEL = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getCachedTimeline(channelId: string): ChatMessageView[] | null {
  if (!channelId) return null;

  // 1. Check in-memory map first (0ms instantaneous)
  const inMem = MEMORY_CACHE.get(channelId);
  if (inMem && Date.now() - inMem.cachedAt < CACHE_TTL_MS) {
    return inMem.messages;
  }

  // 2. Check web storage
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${channelId}`) || localStorage.getItem(`${STORAGE_PREFIX}${channelId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages: ChatMessageView[]; cachedAt: number };
    if (!parsed || !Array.isArray(parsed.messages)) return null;

    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${channelId}`);
      return null;
    }

    // Populate memory cache for subsequent instant access
    MEMORY_CACHE.set(channelId, parsed);
    return parsed.messages;
  } catch {
    return null;
  }
}

export function setCachedTimeline(channelId: string, messages: ChatMessageView[]): void {
  if (!channelId || !Array.isArray(messages) || messages.length === 0) return;

  // Take the most recent messages up to MAX_MESSAGES_PER_CHANNEL
  const sliced = messages.slice(-MAX_MESSAGES_PER_CHANNEL);
  const entry = { messages: sliced, cachedAt: Date.now() };

  MEMORY_CACHE.set(channelId, entry);

  // Evict oldest in-memory entry if over limit
  if (MEMORY_CACHE.size > MAX_CACHE_ENTRIES) {
    const firstKey = MEMORY_CACHE.keys().next().value;
    if (firstKey) MEMORY_CACHE.delete(firstKey);
  }

  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${channelId}`, JSON.stringify(entry));
  } catch {
    // Quota exceeded: safely clear old cache entries
    try {
      evictCachedTimelines(sessionStorage);
      sessionStorage.setItem(`${STORAGE_PREFIX}${channelId}`, JSON.stringify(entry));
    } catch {
      // Ignore if session storage fails completely
    }
  }
}

/** Remove every cached timeline. Keys are snapshotted first: removing while indexing skips every other key (ITEM-03). */
export function evictCachedTimelines(storage: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
