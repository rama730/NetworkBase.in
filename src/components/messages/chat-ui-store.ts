"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";

// In-memory UI state for Messages (L-24): the selected project survives route
// changes inside the tab; a reload starts from the open channel again.
type ChatUiState = {
  /** null = Home. undefined = not chosen yet (follow the open channel). */
  projectId: string | null | undefined;
  switcherOpen: boolean;
  /** The keyboard shortcuts dialog (⌘/). */
  shortcutsOpen: boolean;
  /** Project ids whose Create channel / Invite people dialogs are open. */
  createChannelFor: string | null;
  inviteFor: string | null;
  setProject: (projectId: string | null) => void;
  setSwitcherOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setCreateChannelFor: (projectId: string | null) => void;
  setInviteFor: (projectId: string | null) => void;
};

export const useChatUi = create<ChatUiState>()((set) => ({
  projectId: undefined,
  switcherOpen: false,
  shortcutsOpen: false,
  createChannelFor: null,
  inviteFor: null,
  setProject: (projectId) => set({ projectId }),
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setCreateChannelFor: (createChannelFor) => set({ createChannelFor }),
  setInviteFor: (inviteFor) => set({ inviteFor }),
}));

// Per-device preferences: collapsed sections, the Aa toolbar, Unreads only and
// hidden canvases (localStorage `chat-ui-v1`). Every access tolerates blocked storage.
type StoredUi = { collapsed?: Record<string, boolean>; formatting?: boolean; unreadsOnly?: boolean; hiddenCanvas?: string[] };
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

// Collapsed sections and the Unreads filter follow the account (auth user_metadata, like
// the appearance setting), so they're the same on every device. localStorage is the
// instant copy; the account copy is written a moment after the last change.
let accountTimer: ReturnType<typeof setTimeout> | null = null;
let accountPatch: { chat_sections?: Record<string, boolean>; chat_unreads_only?: boolean } = {};
export function saveAccountUi(patch: { collapsed?: Record<string, boolean>; unreadsOnly?: boolean }) {
  writeChatUi(patch);
  if (patch.collapsed) accountPatch.chat_sections = patch.collapsed;
  if (patch.unreadsOnly !== undefined) accountPatch.chat_unreads_only = patch.unreadsOnly;
  if (accountTimer) clearTimeout(accountTimer);
  accountTimer = setTimeout(() => {
    const data = accountPatch;
    accountPatch = {};
    void import("@/lib/supabase/client")
      .then(({ createClient }) => createClient().auth.updateUser({ data }))
      .catch(() => undefined);
  }, 1_500);
}
