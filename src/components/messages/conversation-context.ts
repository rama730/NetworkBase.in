"use client";

import { createContext, useContext } from "react";

import type { ChatPerson } from "@/lib/messaging/types";

export type ConversationContextValue = {
  channelId: string;
  meId: string | null;
  canAdmin: boolean;
  isDm: boolean;
  people: ChatPerson[];
  nameOf: (userId: string) => string | undefined;
  channelNameOf: (channelId: string) => string | undefined;
  /** Seq of the message being edited inline, if any. */
  editingSeq: number | null;
  setEditingSeq: (seq: number | null) => void;
  openThread: (rootSeq: number) => void;
  /** Inside the thread pane replies have no reply line. */
  inThread: boolean;
  /** Show the Pins tab (after pinning). */
  openPinsTab?: () => void;
  /** The viewer can post and act (false while previewing a public channel). */
  isMember?: boolean;
  /** Project channels can turn messages into tasks. */
  projectId?: string | null;
  /** Saved-for-later messages of this conversation, and the toggle. */
  savedSeqs?: ReadonlySet<number>;
  setSaved?: (seq: number, on: boolean, remindAt?: string | null) => void;
  /** Open the Share dialog for a message. */
  share?: (seq: number) => void;
  /** People the viewer blocked: their messages fold away outside DMs (Blocking B34). */
  blockedIds?: ReadonlySet<string>;
  /** People the viewer muted: folded like blocked people, nothing else changes (B26). */
  mutedIds?: ReadonlySet<string>;
  /** Block a message's author from its ⋯ menu (Blocking B5). */
  openBlock?: (person: { id: string; name: string }) => void;
  /** Mute or unmute a message's author (B26). */
  toggleMute?: (person: { id: string; name: string }, mute: boolean) => void;
};

export const ConversationContext = createContext<ConversationContextValue | null>(null);

export function useConversationContext() {
  const value = useContext(ConversationContext);
  if (!value) throw new Error("ConversationContext missing");
  return value;
}
