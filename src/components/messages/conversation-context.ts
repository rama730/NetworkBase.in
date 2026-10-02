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
};

export const ConversationContext = createContext<ConversationContextValue | null>(null);

export function useConversationContext() {
  const value = useContext(ConversationContext);
  if (!value) throw new Error("ConversationContext missing");
  return value;
}
