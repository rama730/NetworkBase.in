"use client";

import { create } from "zustand";

// In-memory UI state for Messages (L-24): the selected project survives route
// changes inside the tab; a reload starts from the open channel again.
type ChatUiState = {
  /** null = Home. undefined = not chosen yet (follow the open channel). */
  projectId: string | null | undefined;
  switcherOpen: boolean;
  projectSheetOpen: boolean;
  /** Project ids whose Create channel / Invite people dialogs are open. */
  createChannelFor: string | null;
  inviteFor: string | null;
  setProject: (projectId: string | null) => void;
  setSwitcherOpen: (open: boolean) => void;
  setProjectSheetOpen: (open: boolean) => void;
  setCreateChannelFor: (projectId: string | null) => void;
  setInviteFor: (projectId: string | null) => void;
};

export const useChatUi = create<ChatUiState>()((set) => ({
  projectId: undefined,
  switcherOpen: false,
  projectSheetOpen: false,
  createChannelFor: null,
  inviteFor: null,
  setProject: (projectId) => set({ projectId }),
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  setProjectSheetOpen: (projectSheetOpen) => set({ projectSheetOpen }),
  setCreateChannelFor: (createChannelFor) => set({ createChannelFor }),
  setInviteFor: (inviteFor) => set({ inviteFor }),
}));

// Per-device preferences: collapsed sections, the Aa toolbar, the last open
// conversation (localStorage `chat-ui-v1`). Every access tolerates blocked storage.
type StoredUi = { collapsed?: Record<string, boolean>; formatting?: boolean; last?: string | null };
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

export function writeDraft(key: string, body: string) {
  try {
    if (body.trim()) window.localStorage.setItem(draftKey(key), body);
    else window.localStorage.removeItem(draftKey(key));
  } catch {
    // Storage blocked: the draft lives in the textarea only.
  }
}
