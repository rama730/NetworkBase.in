"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";

// UI state for Messages (L-24): the selected project survives route changes and,
// through sessionStorage, a reload of a page without a project in its URL.
type ChatUiState = {
  /** null = Home. undefined = not chosen yet (follow the open channel). */
  projectId: string | null | undefined;
  switcherOpen: boolean;
  /** 1024–1279px with a drawer open: the sidebar shown as a sheet over the conversation. */
  sidebarSheet: boolean;
  setSidebarSheet: (open: boolean) => void;
  /** The keyboard shortcuts dialog (⌘/). */
  shortcutsOpen: boolean;
  /** Project ids whose Create channel / Invite people dialogs are open. */
  createChannelFor: string | null;
  inviteFor: string | null;
  /** ↑ in an Inbox reply box: the thread opens with this reply already in edit mode. */
  pendingEdit: { channelId: string; seq: number } | null;
  setPendingEdit: (edit: { channelId: string; seq: number } | null) => void;
  setProject: (projectId: string | null) => void;
  setSwitcherOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setCreateChannelFor: (projectId: string | null) => void;
  setInviteFor: (projectId: string | null) => void;
};

export const useChatUi = create<ChatUiState>()((set) => ({
  projectId: undefined,
  switcherOpen: false,
  sidebarSheet: false,
  setSidebarSheet: (sidebarSheet) => set({ sidebarSheet }),
  shortcutsOpen: false,
  createChannelFor: null,
  inviteFor: null,
  pendingEdit: null,
  setPendingEdit: (pendingEdit) => set({ pendingEdit }),
  setProject: (projectId) => {
    set({ projectId });
    try {
      window.sessionStorage.setItem(PROJECT_KEY, projectId ?? "");
    } catch {
      // Storage blocked: the pick lasts until reload.
    }
  },
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setCreateChannelFor: (createChannelFor) => set({ createChannelFor }),
  setInviteFor: (inviteFor) => set({ inviteFor }),
}));

const PROJECT_KEY = "chat-project";

/** The project picked earlier in this tab (null = All projects), or undefined if none. */
export function restoredWorkspace(): string | null | undefined {
  try {
    const stored = window.sessionStorage.getItem(PROJECT_KEY);
    return stored === null ? undefined : stored || null;
  } catch {
    return undefined;
  }
}

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

// One stable list while nothing changed (useSyncExternalStore needs the same snapshot back).
let draftsCache: { sig: string; list: DraftEntry[] } = { sig: "", list: [] };
function draftsSnapshot() {
  const list = readDrafts();
  const sig = list.map((d) => `${d.key}\u0000${d.body}`).join("\u0001");
  if (sig !== draftsCache.sig) draftsCache = { sig, list };
  return draftsCache.list;
}
function subscribeDrafts(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith("chat-draft:")) onChange();
  };
  window.addEventListener(DRAFTS_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DRAFTS_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
const NO_DRAFTS: DraftEntry[] = [];

/**
 * Drafts, kept current as composers save and clear them (this tab and others). Read during
 * render, so Drafts never flashes "No drafts" and the sidebar count never starts at 0.
 */
export function useDrafts() {
  return useSyncExternalStore(subscribeDrafts, draftsSnapshot, () => NO_DRAFTS);
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
