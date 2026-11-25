"use client";

import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast, feedbackDate } from "@/lib/feedback";

import { getCanvas } from "@/app/actions/chat/canvas";
import { getChannel, listChannelTabs, listMembers } from "@/app/actions/chat/channels";
import { getPersonContext } from "@/app/actions/chat/members";
import { listSavedSeqs, saveMessage } from "@/app/actions/chat/later";
import { listMessages, resolveMessageTarget } from "@/app/actions/chat/messages";
import { markRead } from "@/app/actions/chat/read";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useAuth } from "@/hooks/useAuth";
import {
  CHAT_PAGE_SIZE,
  CHAT_READ_DEBOUNCE_MS,
  CHAT_TYPING_MAX_MEMBERS,
  channelTopic,
  typingTopic,
} from "@/lib/messaging/constants";
import { formatChatTime, personName } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { pruneTypers, shouldSendTyping, withoutTyper, type Typers } from "@/lib/messaging/typing";
import { applyReaction, patchPages, upsertMessage, type MessagePages } from "@/lib/messaging/timeline";
import { storedFailedSends } from "@/components/messages/failed-sends";
import type { ChatCardView, ChatMessageView, ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast, type BroadcastStatus } from "@/lib/realtime/private-broadcast";

type Paged = InfiniteData<ChatMessageView[], number | null>;

export function seedCards(queryClient: ReturnType<typeof useQueryClient>, cards: Record<string, ChatCardView | null | undefined> | undefined) {
  for (const [key, card] of Object.entries(cards ?? {})) {
    const [kind, refId] = key.split(":");
    if (kind && refId) queryClient.setQueryData(queryKeys.chat.card(kind, refId), card ?? null);
  }
}

export function useChannelDetails(channelId: string) {
  const { data } = useChatShell();
  const { user } = useAuth();
  const cached = useMemo(() => {
    const found = data?.channels.find((c) => c.id === channelId);
    if (!found) return undefined;
    return {
      ...found,
      is_member: true,
      can_admin: found.role === "admin" || found.role === "owner",
    };
  }, [data?.channels, channelId]);

  return useQuery({
    queryKey: queryKeys.chat.channel(channelId),
    enabled: Boolean(user),
    queryFn: async () => {
      const result = await getChannel({ channelId });
      if (!result.success) throw new Error(result.error);
      return result.channel;
    },
    initialData: cached as any,
    // The cached copy is a placeholder: marked old so the real row loads right away.
    initialDataUpdatedAt: cached ? 0 : undefined,
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
      // A failed list shows Retry, never "No members match".
      if (!result.success) throw new Error(result.error);
      return result.members;
    },
    staleTime: 5 * 60_000,
  });
}

/** The channel's shared canvas row; null until someone writes one. */
export function useChannelCanvas(channelId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.chat.canvas(channelId),
    enabled,
    queryFn: async () => {
      const result = await getCanvas({ channelId });
      if (!result.success) throw new Error(result.error);
      return result.canvas;
    },
    staleTime: 60_000,
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
 * ?m=<seq>), live events from chat:channel:<id>, and a 3 s debounced
 * read cursor while the newest message is visible.
 */
export function useChannelMessages(channelId: string, options: { around?: number | null; memberCount: number; isMember: boolean; canPreview?: boolean }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const { applyRead, data: shell } = useChatShell();
  const key = useMemo(() => queryKeys.chat.messages(channelId), [channelId]);
  const update = useUpdatePages(channelId);
  const [status, setStatus] = useState<BroadcastStatus>("connecting");
  const wasDisconnected = useRef(false);
  // The channel's newest top-level message, from the shell (0 until it loads).
  const shellTopSeq = shell?.channels.find((c) => c.id === channelId)?.last_top_seq ?? 0;

  // The cached pages can't be shown when they miss what we need: a jump (?m=) outside them,
  // or (no jump) newer messages they don't have. Showing them would place the "New" divider
  // and the start position wrong and then scroll past the unread ones once fresh data lands,
  // so the timeline starts over from a skeleton instead.
  const around = options.around ?? null;
  const unusable = useCallback((cached: Paged | undefined, target: number | null) => {
    if (!cached) return false;
    if (target) return !cached.pages.some((page) => page.some((m) => m.seq === target));
    return (cached.pages[0]?.at(-1)?.seq ?? 0) < shellTopSeq;
  }, [shellTopSeq]);
  const lastAround = useRef(around);
  useEffect(() => {
    if (around === lastAround.current) return;
    lastAround.current = around;
    // Leaving a jump also starts over: the window around it isn't the newest page.
    if (unusable(queryClient.getQueryData<Paged>(key), around)) void queryClient.resetQueries({ queryKey: key });
  }, [around, key, queryClient, unusable]);

  /** "Latest" from an old window: load the newest page instead of the end of this one. */
  const reloadLatest = useCallback(() => {
    void queryClient.resetQueries({ queryKey: key });
  }, [key, queryClient]);

  const query = useInfiniteQuery({
    queryKey: key,
    enabled: options.isMember || Boolean(options.canPreview),
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
            break;
          // A system line (a status change) is written by the database, so there is no payload to insert: reload the pages.
          case "message.system":
            void queryClient.invalidateQueries({ queryKey: key });
            break;
          case "message.edit":
            if (seq !== null) update((pages) => patchPages(pages, seq, (m) => ({ ...m, body: String(payload.body ?? m.body), edited_at: String(payload.edited_at ?? new Date().toISOString()) })));
            break;
          case "message.delete":
            void queryClient.invalidateQueries({ queryKey: ["chat-v3", "target", channelId] });
            if (seq !== null) update((pages) => patchPages(pages, seq, (m) => ({ ...m, body: "", attachments: [], deleted_at: new Date().toISOString() })));
            break;
          case "reaction.add":
          case "reaction.remove": {
            if (seq === null) break;
            const on = event === "reaction.add";
            const mine = payload.user_id === meId;
            update((pages) => patchPages(pages, seq, (m) => {
              // This tab already shows its own reaction; one made on another device still needs applying.
              if (mine && Boolean(m.reactions.find((r) => r.emoji === payload.emoji)?.me) === on) return m;
              return { ...m, reactions: applyReaction(m.reactions, String(payload.emoji), on, mine, typeof payload.user_id === "string" ? payload.user_id : undefined) };
            }));
            break;
          }
          case "message.preview_hidden":
            if (seq !== null) update((pages) => patchPages(pages, seq, (m) => ({ ...m, link_preview_hidden: payload.hidden !== false })));
            break;
          case "pin.changed":
            if (seq !== null) update((pages) => patchPages(pages, seq, (m) => ({ ...m, pinned: Boolean(payload.pinned) })));
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.pins(channelId) });
            break;
          case "canvas.changed":
            if (payload.updated_by !== meId) void queryClient.invalidateQueries({ queryKey: queryKeys.chat.canvas(channelId) });
            break;
          case "card.changed":
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.card(String(payload.kind), String(payload.ref_id)) });
            break;
          case "tabs.changed":
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.tabs(channelId) });
            break;
          // The "joined"/"renamed" line itself arrives as message.new; pages stay (REAL-03).
          case "member.changed":
          case "channel.updated":
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channelId) });
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
    return () => subscription.unsubscribe();
  }, [channelId, key, meId, options.isMember, queryClient, update]);

  // Live updates down (no session, flag off, socket lost): the shell poll still learns the
  // channel's newest seq, so catch the open timeline up instead of waiting for a reload.
  const loadedTopSeq = query.data?.pages[0]?.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (status === "connected" || !query.isSuccess || shellTopSeq <= loadedTopSeq) return;
    void queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
  }, [key, loadedTopSeq, query.isSuccess, queryClient, shellTopSeq, status]);

  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readSent = useRef(0);
  const pendingSeq = useRef(0);

  const flushRead = useCallback((seqToFlush?: number) => {
    const seq = seqToFlush ?? pendingSeq.current;
    if (seq <= readSent.current || seq <= 0) return;
    if (readTimer.current) {
      clearTimeout(readTimer.current);
      readTimer.current = null;
    }
    readSent.current = seq;
    applyRead(channelId, seq);
    void markRead({ channelId, seq });
  }, [applyRead, channelId]);

  const markSeen = useCallback((seq: number) => {
    if (seq <= readSent.current || seq <= 0) return;
    pendingSeq.current = Math.max(pendingSeq.current, seq);
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      readTimer.current = null;
      if (document.visibilityState !== "visible") return;
      flushRead(seq);
    }, 1_000);
  }, [flushRead]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && pendingSeq.current > readSent.current) {
        flushRead();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (pendingSeq.current > readSent.current) {
        flushRead();
      }
    };
  }, [flushRead]);

  const messages = useMemo(() => query.data ? [...query.data.pages].reverse().flat() : [], [query.data]);

  // Sends that failed before a reload come back with their Retry (failed-sends.ts).
  const restored = useRef(false);
  useEffect(() => {
    if (!query.isSuccess || restored.current) return;
    restored.current = true;
    const stored = storedFailedSends(channelId, null, meId);
    if (stored.length) update((pages) => stored.reduce((acc, message) => upsertMessage(acc, message), pages));
  }, [channelId, meId, query.isSuccess, update]);

  return { query, messages, status, markSeen, flushRead, reloadLatest };
}

/**
 * Who is typing in a channel (rootSeq null) or one thread, on chat:typing:<id>.
 * Names come from the member list, never the payload, and unknown senders are
 * ignored, so nobody can show up as someone else. `notify(true)` while keys are
 * pressed (throttled), `notify(false)` when the draft empties or is sent.
 */
export function useTyping(channelId: string, options: { rootSeq: number | null; people: ChatPerson[]; memberCount: number; enabled: boolean }) {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const { rootSeq } = options;
  // Typing is off in big rooms, so don't join their typing topic at all (REAL-01).
  const enabled = options.enabled && options.memberCount <= CHAT_TYPING_MAX_MEMBERS;
  const [typers, setTypers] = useState<Typers>({});
  const people = useRef(options.people);
  const sendRef = useRef<(event: string, payload: Record<string, unknown>) => boolean>(() => false);
  const lastSent = useRef(0);
  const allowed = Boolean(meId) && options.memberCount <= CHAT_TYPING_MAX_MEMBERS;
  useEffect(() => {
    people.current = options.people;
  });

  useEffect(() => {
    if (!enabled) return;
    const typing = subscribeBroadcast(typingTopic(channelId), (event, payload) => {
      const userId = payload.user_id;
      if (event !== "typing" || typeof userId !== "string" || userId === meId) return;
      if ((payload.root ?? null) !== rootSeq) return;
      const person = people.current.find((p) => p.id === userId);
      if (!person) return;
      setTypers((current) => (payload.on === false ? withoutTyper(current, userId) : { ...current, [userId]: { name: personName(person), at: Date.now() } }));
    });
    // A sent message ends its author's typing at once.
    const messages = subscribeBroadcast(channelTopic(channelId), (event, payload) => {
      if (event === "message.new" && typeof payload.author_id === "string") setTypers((current) => withoutTyper(current, payload.author_id as string));
    });
    sendRef.current = typing.send;
    return () => {
      if (lastSent.current && meId) typing.send("typing", { user_id: meId, root: rootSeq, on: false });
      lastSent.current = 0;
      sendRef.current = () => false;
      typing.unsubscribe();
      messages.unsubscribe();
      setTypers({});
    };
  }, [channelId, enabled, meId, rootSeq]);

  // Expire typers that went quiet without a stop (closed tab, lost connection).
  useEffect(() => {
    if (!Object.keys(typers).length) return;
    const timer = setInterval(() => setTypers((current) => pruneTypers(current, Date.now())), 1_000);
    return () => clearInterval(timer);
  }, [typers]);

  const notify = useCallback((active: boolean) => {
    if (!allowed) return;
    const now = Date.now();
    if (!active) {
      if (!lastSent.current) return;
      lastSent.current = 0;
      sendRef.current("typing", { user_id: meId, root: rootSeq, on: false });
      return;
    }
    if (!shouldSendTyping(lastSent.current, now)) return;
    // Throttle only what actually went out; a drop before connect retries on the next key.
    if (sendRef.current("typing", { user_id: meId, root: rootSeq, on: true })) lastSent.current = now;
  }, [allowed, meId, rootSeq]);

  const names = useMemo(() => Object.values(typers).map((t) => t.name), [typers]);
  return { names, notify };
}

/** The open conversation's saved-for-later messages, with an optimistic toggle. */
export function useSavedSeqs(channelId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = useMemo(() => queryKeys.chat.savedSeqs(channelId), [channelId]);
  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const result = await listSavedSeqs({ channelId });
      return result.success ? result.seqs : [];
    },
    staleTime: 60_000,
  });
  const seqs = useMemo(() => new Set(query.data ?? []), [query.data]);
  // Named, so Undo can call it again.
  const setSaved = useCallback(async function save(seq: number, on: boolean, remindAt: string | null = null): Promise<void> {
    const previous = queryClient.getQueryData<number[]>(key) ?? [];
    queryClient.setQueryData<number[]>(key, on ? [...new Set([...previous, seq])] : previous.filter((s) => s !== seq));
    const result = await saveMessage({ channelId, seq, on, remindAt });
    if (!result.success) {
      queryClient.setQueryData(key, previous);
      return void toast.error(chatErrorMessage(result.error));
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.saved() });
    const viewSaved = { label: "View saved", onClick: () => router.push("/messages/saved") };
    if (!on) toast.success("Removed from Saved", { action: { label: "Undo", onClick: () => void save(seq, true) } });
    else if (remindAt) toast.success("Reminder set", { description: feedbackDate(remindAt), action: viewSaved });
    else toast.success("Saved", { action: viewSaved });
  }, [channelId, key, queryClient, router]);
  // Stable identity: the conversation context depends on it, and every row reads that (REND-01).
  return useMemo(() => ({ seqs, setSaved }), [seqs, setSaved]);
}

/** Bookmarks and Tasks tabs, shared by everyone in the channel. */
export function useChannelTabs(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.chat.tabs(channelId),
    enabled,
    queryFn: async () => {
      const result = await listChannelTabs({ channelId });
      return result.success ? result.tabs : [];
    },
    staleTime: 60_000,
  });
}

/** A DM partner's context (their time zone, what you share), for Details and the line above the composer. */
export function usePersonContext(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["chat-v3", "person-context", userId ?? ""],
    enabled: enabled && Boolean(userId),
    queryFn: async () => {
      const result = await getPersonContext({ userId: userId! });
      return result.success ? result.context : null;
    },
    staleTime: 5 * 60_000,
  });
}

/** Only message identity is exposed; reads use the timeline's authorization. */
export function useMessageTarget(channelId: string, seq: number | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.chat.target(channelId, seq, user?.id ?? null),
    enabled: Boolean(seq && user),
    queryFn: async () => {
      const result = await resolveMessageTarget({ channelId, seq: seq! });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    staleTime: 0,
    retry: false,
  });
}
