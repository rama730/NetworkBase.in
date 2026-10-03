"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";

// In-memory UI state for Messages (L-24): the selected project survives route
// changes inside the tab; a reload starts from the open channel again.
type ChatUiState = {
  /** null = Home. undefined = not chosen yet (follow the open channel). */
  projectId: string | null | undefined;
  switcherOpen: boolean;
  /** Project ids whose Create channel / Invite people dialogs are open. */
  createChannelFor: string | null;
  inviteFor: string | null;
  activeThreadRootSeq: number | null;
  setProject: (projectId: string | null) => void;
  setSwitcherOpen: (open: boolean) => void;
  setCreateChannelFor: (projectId: string | null) => void;
  setInviteFor: (projectId: string | null) => void;
  setActiveThreadRootSeq: (seq: number | null) => void;
};

export const useChatUi = create<ChatUiState>()((set) => ({
  projectId: undefined,
  switcherOpen: false,
  createChannelFor: null,
  inviteFor: null,
  activeThreadRootSeq: null,
  setProject: (projectId) => set({ projectId }),
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  setCreateChannelFor: (createChannelFor) => set({ createChannelFor }),
  setInviteFor: (inviteFor) => set({ inviteFor }),
  setActiveThreadRootSeq: (activeThreadRootSeq) => set({ activeThreadRootSeq }),
}));

// Per-device preferences: collapsed sections, the Aa toolbar, the last open
// conversation (localStorage `chat-ui-v1`). Every access tolerates blocked storage.
type StoredUi = { collapsed?: Record<string, boolean>; formatting?: boolean; last?: string | null; unreadsOnly?: boolean; hiddenCanvas?: string[] };
const UI_KEY = "chat-ui-v1";

export function readChatUi(): StoredUi {
  try {
    return JSON.parse(window.localStorage.getItem(UI_KEY) ?? "{}") as StoredUi;
  } catch {
    return {};
  }
}

export function writeChatUi(patch: StoredUi) {
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify({ ...readChatUi(), ...patch }));
  } catch {
    // Storage blocked: preferences last for this page only.
  }
}

const draftKey = (key: string) => `chat-draft:${key}`;

export function readDraft(key: string) {
  try {
    return window.localStorage.getItem(draftKey(key)) ?? "";
  } catch {
    return "";
  }
}

const DRAFTS_EVENT = "chat-drafts";

export function writeDraft(key: string, body: string) {
  try {
    const had = window.localStorage.getItem(draftKey(key)) !== null;
    if (body.trim()) window.localStorage.setItem(draftKey(key), body);
    else window.localStorage.removeItem(draftKey(key));
    if (had !== Boolean(body.trim())) window.dispatchEvent(new Event(DRAFTS_EVENT));
  } catch {
    // Storage blocked: the draft lives in the textarea only.
  }
}

export type DraftEntry = { key: string; channelId: string; threadRootSeq: number | null; body: string };

/** Every saved draft on this device (key = channelId or channelId:rootSeq). */
export function readDrafts(): DraftEntry[] {
  const drafts: DraftEntry[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const name = window.localStorage.key(i);
      if (!name?.startsWith("chat-draft:")) continue;
      const key = name.slice("chat-draft:".length);
      const [channelId, root] = key.split(":");
      const body = window.localStorage.getItem(name) ?? "";
      if (channelId && body.trim()) drafts.push({ key, channelId, threadRootSeq: root ? Number(root) || null : null, body });
    }
  } catch {
    // Storage blocked: no drafts to show.
  }
  return drafts;
}

/** Drafts, kept current as composers save and clear them (this tab and others). */
export function useDrafts() {
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  useEffect(() => {
    const sync = () => setDrafts(readDrafts());
    sync();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith("chat-draft:")) sync();
    };
    window.addEventListener(DRAFTS_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DRAFTS_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return drafts;
}

// Collapsed sidebar sections follow the account (auth user_metadata, like the
// appearance setting), so they're the same on every device. localStorage is the
// instant copy; the account copy is written a moment after the last toggle.
let collapsedTimer: ReturnType<typeof setTimeout> | null = null;
export function saveCollapsed(collapsed: Record<string, boolean>) {
  writeChatUi({ collapsed });
  if (collapsedTimer) clearTimeout(collapsedTimer);
  collapsedTimer = setTimeout(() => {
    void import("@/lib/supabase/client")
      .then(({ createClient }) => createClient().auth.updateUser({ data: { chat_sections: collapsed } }))
      .catch(() => undefined);
  }, 1_500);
}
