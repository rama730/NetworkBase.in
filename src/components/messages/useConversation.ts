"use client";

import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getChannel, listMembers } from "@/app/actions/chat/channels";
import { listMessages } from "@/app/actions/chat/messages";
import { markRead } from "@/app/actions/chat/read";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useAuth } from "@/hooks/useAuth";
import {
  CHAT_PAGE_SIZE,
  CHAT_READ_DEBOUNCE_MS,
  CHAT_TYPING_MAX_MEMBERS,
  CHAT_TYPING_THROTTLE_MS,
  channelTopic,
} from "@/lib/messaging/constants";
import { applyReaction, patchPages, upsertMessage, type MessagePages } from "@/lib/messaging/timeline";
import type { ChatCardView, ChatMessageView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast, type BroadcastStatus } from "@/lib/realtime/private-broadcast";

type Paged = InfiniteData<ChatMessageView[], number | null>;
const TYPING_TTL_MS = 6_000;

export function seedCards(queryClient: ReturnType<typeof useQueryClient>, cards: Record<string, ChatCardView | null | undefined> | undefined) {
  for (const [key, card] of Object.entries(cards ?? {})) {
    const [kind, refId] = key.split(":");
    if (kind && refId) queryClient.setQueryData(queryKeys.chat.card(kind, refId), card ?? null);
  }
}

export function useChannelDetails(channelId: string) {
  return useQuery({
    queryKey: queryKeys.chat.channel(channelId),
    queryFn: async () => {
      const result = await getChannel({ channelId });
      if (!result.success) throw new Error(result.error);
      return result.channel;
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useChannelMembers(channelId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.chat.members(channelId),
    enabled,
    queryFn: async () => {
      const result = await listMembers({ channelId });
      return result.success ? result.members : [];
    },
    staleTime: 5 * 60_000,
  });
}

/** Mutate the cached pages of a channel (optimistic sends, edits, reactions). */
export function useUpdatePages(channelId: string) {
  const queryClient = useQueryClient();
  return useCallback((update: (pages: MessagePages) => MessagePages) => {
    queryClient.setQueryData<Paged>(queryKeys.chat.messages(channelId), (prev) => {
      if (!prev) return prev;
      const pages = update(prev.pages);
      return pages === prev.pages ? prev : { ...prev, pages };
    });
  }, [channelId, queryClient]);
}

/**
 * The open channel: newest page first, older pages on scroll (or a page around
 * ?m=<seq>), live events from chat:channel:<id>, typing, and a 3 s debounced
 * read cursor while the newest message is visible.
 */
export function useChannelMessages(channelId: string, options: { around?: number | null; memberCount: number; isMember: boolean }) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const meId = user?.id ?? null;
  const { applyRead } = useChatShell();
  const key = useMemo(() => queryKeys.chat.messages(channelId), [channelId]);
  const update = useUpdatePages(channelId);
  const [status, setStatus] = useState<BroadcastStatus>("connecting");
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const sendRef = useRef<(event: string, payload: Record<string, unknown>) => void>(() => undefined);
  const lastTypingSent = useRef(0);
  const wasDisconnected = useRef(false);

  const query = useInfiniteQuery({
    queryKey: key,
    enabled: options.isMember,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      const around = pageParam === null && options.around ? options.around : undefined;
      const result = await listMessages({ channelId, before: pageParam ?? undefined, around });
      if (!result.success) throw new Error(result.error);
      seedCards(queryClient, result.cards);
      return result.messages;
    },
    getNextPageParam: (page) => (page.length < CHAT_PAGE_SIZE / (options.around ? 2 : 1) ? undefined : page[0]?.seq),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!options.isMember) return;
    const subscription = subscribeBroadcast(
      channelTopic(channelId),
      (event, payload) => {
        const seq = typeof payload.seq === "number" ? payload.seq : null;
        switch (event) {
          case "message.new":
            update((pages) => upsertMessage(pages, payload as unknown as ChatMessageView));
            setTyping((current) => {
              const authorId = (payload as { author_id?: string }).author_id;
              if (!authorId || !current[authorId]) return current;
              const { [authorId]: _gone, ...rest } = current;
              return rest;
            });
            break;
          case "message.edit":
            if (seq !== null) update((pages) => patchPages(pages, seq, (m) => ({ ...m, body: String(payload.body ?? m.body), edited_at: String(payload.edited_at ?? new Date().toISOString()) })));
            break;
          case "message.delete":
            if (seq !== null) update((pages) => patchPages(pages, seq, (m) => ({ ...m, body: "", attachments: [], deleted_at: new Date().toISOString() })));
            break;
          case "reaction.add":
          case "reaction.remove":
            if (seq !== null && payload.user_id !== meId) {
              update((pages) => patchPages(pages, seq, (m) => ({ ...m, reactions: applyReaction(m.reactions, String(payload.emoji), event === "reaction.add", false) })));
            }
            break;
          case "pin.changed":
            if (seq !== null) update((pages) => patchPages(pages, seq, (m) => ({ ...m, pinned: Boolean(payload.pinned) })));
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.pins(channelId) });
            break;
          case "card.changed":
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.card(String(payload.kind), String(payload.ref_id)) });
            break;
          case "member.changed":
          case "channel.updated":
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channelId) });
            void queryClient.invalidateQueries({ queryKey: key });
            break;
          case "typing":
            if (typeof payload.user_id === "string" && payload.user_id !== meId) {
              const name = String(payload.name ?? "Someone");
              setTyping((current) => ({ ...current, [payload.user_id as string]: { name, at: Date.now() } }));
            }
            break;
        }
      },
      (next) => {
        setStatus(next);
        if (next === "disconnected") wasDisconnected.current = true;
        // ponytail: catch-up refetches the loaded pages (L-1). ceiling: a gap
        // longer than the loaded pages shows from the newest page. upgrade: after=<seq>.
        if (next === "connected" && wasDisconnected.current) {
          wasDisconnected.current = false;
          void queryClient.invalidateQueries({ queryKey: key });
        }
      },
    );
    sendRef.current = subscription.send;
    return () => {
      sendRef.current = () => undefined;
      subscription.unsubscribe();
    };
  }, [channelId, key, meId, options.isMember, queryClient, update]);

  // Expire typing names that stopped updating.
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const timer = setInterval(() => {
      setTyping((current) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(current).filter(([, value]) => now - value.at < TYPING_TTL_MS));
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
    }, 2_000);
    return () => clearInterval(timer);
  }, [typing]);

  const notifyTyping = useCallback(() => {
    if (options.memberCount > CHAT_TYPING_MAX_MEMBERS || !meId) return;
    const now = Date.now();
    if (now - lastTypingSent.current < CHAT_TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    sendRef.current("typing", { user_id: meId, name: profile?.fullName || profile?.username || "Someone" });
  }, [meId, options.memberCount, profile?.fullName, profile?.username]);

  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readSent = useRef(0);
  const markSeen = useCallback((seq: number) => {
    if (seq <= readSent.current || seq <= 0) return;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      if (document.visibilityState !== "visible" || seq <= readSent.current) return;
      readSent.current = seq;
      applyRead(channelId, seq);
      void markRead({ channelId, seq });
    }, CHAT_READ_DEBOUNCE_MS);
  }, [applyRead, channelId]);
  useEffect(() => () => {
    if (readTimer.current) clearTimeout(readTimer.current);
  }, []);

  const messages = useMemo(() => (query.data ? [...query.data.pages].reverse().flat() : []), [query.data]);
  const typingNames = useMemo(() => Object.values(typing).map((t) => t.name), [typing]);
  return { query, messages, status, typingNames, notifyTyping, markSeen };
}
