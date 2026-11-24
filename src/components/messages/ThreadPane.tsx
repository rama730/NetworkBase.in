"use client";

import { useBugsAdded } from "@/components/messages/useBugsAdded";
import { useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Check, Link2, MoreHorizontal, SquareArrowOutUpRight } from "lucide-react";
import { LatestBar } from "@/components/messages/parts/LatestBar";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { REVEAL_EVENT, type RevealEvent } from "@/components/messages/Timeline";
import { toast } from "@/lib/feedback";

import { storedFailedSends } from "@/components/messages/failed-sends";
import { joinChannel } from "@/app/actions/chat/channels";
import { listThread, setThreadFollow } from "@/app/actions/chat/messages";
import { markThreadRead } from "@/app/actions/chat/read";
import { ConversationContext, type ConversationContextValue } from "@/components/messages/conversation-context";
import { MessageRow } from "@/components/messages/MessageRow";
import { MessageHistory } from "@/components/messages/MessageHistory";
import { LastItemTracker } from "@/components/messages/Timeline";
import { DropOverlay, draftKeyOf, dropFilesTo, useFileDrop } from "@/components/messages/useFileDrop";
import { seedCards, useChannelDetails, useChannelMembers, useSavedSeqs, useTyping } from "@/components/messages/useConversation";
import { useBlockedIds, useChatShell, useMutedIds } from "@/components/messages/ChatShellProvider";
import { useChatUi } from "@/components/messages/chat-ui-store";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, isSelfDm, personName } from "@/lib/messaging/channel-view";
import { channelTopic } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref, showInConversationHref, threadHref } from "@/lib/messaging/routes";
import { applyReaction, upsertMessage } from "@/lib/messaging/timeline";
import type { ChatMessageView, ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { copyWithToast } from "@/lib/clipboard";

const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), {
  ssr: false,
  loading: () => <div className="nb-message-composer border-t border-border bg-card px-3 pt-2 sm:px-4"><div className="h-[86px] rounded-md border border-input" /></div>,
});
const ShareDialog = dynamic(() => import("@/components/messages/parts/ShareDialog").then((m) => m.ShareDialog), { ssr: false });

// Stable identity so Virtuoso never remounts the footer (VIRT-01). Room for the
// floating typing indicator only while someone types; otherwise the gap rests at h-6 (24px)
// so the bottom reply, reactions, and preview cards never touch the composer border.
const THREAD_COMPONENTS = { Footer: ({ context }: { context?: { typing: boolean } }) => <div className={context?.typing ? "h-10" : "h-6 transition-[height] duration-[180ms] ease-out motion-reduce:transition-none"} /> };

/** Replies loading: rows in the shared shimmer (no pulse). */
function RepliesSkeleton() {
  return (
    <div role="status" className="space-y-3 px-4 py-3">
      <span className="sr-only">Loading replies…</span>
      {[70, 45].map((width) => (
        <div key={width} className="flex gap-2.5">
          <Skeleton className="size-[34px] flex-none rounded-md" />
          <div className="flex-1 space-y-2 pt-1"><Skeleton className="h-3 w-24 rounded-sm" /><Skeleton className="h-3 rounded-sm" style={{ width: `${width}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

type Thread = { root: ChatMessageView | null; replies: ChatMessageView[]; following: boolean; lastReadSeq: number | null; hasOlder: boolean; hasNewer: boolean };
type Row = { type: "root"; message: ChatMessageView } | { type: "summary" } | { type: "loading" } | { type: "older" } | { type: "newer" } | { type: "new" } | { type: "reply"; message: ChatMessageView; grouped: boolean };

/** Who's in the thread: whoever started it, then the repliers. */
function participantsOf(thread: Thread | undefined) {
  const seen = new Map<string, ChatPerson>();
  for (const message of [thread?.root, ...(thread?.replies ?? [])]) if (message?.author && !seen.has(message.author.id)) seen.set(message.author.id, message.author);
  return [...seen.values()];
}

function names(people: ChatPerson[]) {
  const first = people.slice(0, 2).map((p) => personName(p).split(" ")[0]);
  if (people.length <= 2) return first.join(" and ");
  return `${first.join(", ")} and ${people.length - 2} other${people.length === 3 ? "" : "s"}`;
}

/**
 * Root message plus replies (drawer at 1024px+, full screen below). Replies arrive on the channel topic.
 * `headerSlot`: Follow and ⋯ render in the drawer's own header (one header, not two). `focusSeq`: a linked reply (?m=).
 */
export function ThreadPane({ channelId, rootSeq, headerSlot = null, focusSeq = null, autoFocus = false, onClose, surface = "page", onShowInConversation }: {
  channelId: string; rootSeq: number; headerSlot?: HTMLElement | null; focusSeq?: number | null; autoFocus?: boolean; onClose?: () => void; surface?: "page" | "window"; onShowInConversation?: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const details = useChannelDetails(channelId);
  const isMember = Boolean(details.data?.is_member);
  const members = useChannelMembers(channelId, isMember);
  const people = useMemo(() => members.data ?? [], [members.data]);
  const typing = useTyping(channelId, { rootSeq, people, memberCount: details.data?.member_count ?? 0, enabled: isMember });
  const typingNow = typing.names.length > 0;
  const list = useRef<VirtuosoHandle>(null);
  const atBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  // Replies from others that arrived while scrolled up: the pill says how many.
  const [unseen, setUnseen] = useState(0);
  const [tabSeq, setTabSeq] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const latestMode = useRef(false);
  const [announce, setAnnounce] = useState("");
  // The typing gap opened: at the bottom, keep the last reply fully in view. Next frame,
  // once the taller footer is in the DOM; scrolling past the end stops at the real bottom.
  useEffect(() => {
    if (!typingNow || !atBottom.current) return;
    const frame = requestAnimationFrame(() => list.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [typingNow]);
  const saved = useSavedSeqs(channelId, isMember);
  const key = useMemo(() => queryKeys.chat.thread(channelId, rootSeq), [channelId, rootSeq]);
  // ↑ in an Inbox reply box sent you here to edit your last reply: start in edit mode.
  const [editingSeq, setEditingSeq] = useState<number | null>(() => {
    const pending = useChatUi.getState().pendingEdit;
    return pending?.channelId === channelId ? pending.seq : null;
  });
  // Used once: cleared after mount (not in the initializer, which may run twice).
  useEffect(() => {
    if (useChatUi.getState().pendingEdit?.channelId === channelId) useChatUi.getState().setPendingEdit(null);
  }, [channelId]);
  const [shareSeq, setShareSeq] = useState<number | null>(null);

  const thread = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Thread> => {
      const result = await listThread({ channelId, rootSeq, around: !latestMode.current && focusSeq !== rootSeq ? focusSeq ?? undefined : undefined });
      if (!result.success) throw new Error(result.error);
      seedCards(queryClient, result.cards);
      return { root: result.root, replies: result.replies, following: result.following, lastReadSeq: result.lastReadSeq, hasOlder: result.hasOlder, hasNewer: result.hasNewer };
    },
    // The root is usually already in the timeline: show it at once, replies load below it.
    placeholderData: () => {
      const pages = queryClient.getQueryData<InfiniteData<ChatMessageView[]>>(queryKeys.chat.messages(channelId));
      const root = pages?.pages.flat().find((m) => m.seq === rootSeq);
      return root ? { root, replies: [], following: false, lastReadSeq: null, hasOlder: false, hasNewer: false } : undefined;
    },
  });
  const restoredSends = useRef(false);
  useEffect(() => {
    if (!thread.isSuccess || thread.isPlaceholderData || restoredSends.current || !meId) return;
    restoredSends.current = true;
    const stored = storedFailedSends(channelId, rootSeq, meId);
    if (stored.length) queryClient.setQueryData<Thread>(key, (prev) => prev ? { ...prev, replies: [...prev.replies, ...stored.filter((message) => !prev.replies.some((reply) => reply.client_message_id === message.client_message_id))] } : prev);
  }, [thread.isSuccess, thread.isPlaceholderData, channelId, rootSeq, key, meId, queryClient]);
  const previousFocus = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (previousFocus.current === focusSeq) return;
    previousFocus.current = focusSeq;
    latestMode.current = false;
    const cached = queryClient.getQueryData<Thread>(key);
    if (focusSeq && focusSeq !== rootSeq && cached && !cached.replies.some((m) => m.seq === focusSeq)) void thread.refetch();
  }, [focusSeq, rootSeq, key, queryClient, thread.refetch]);
  const loadingReplies = thread.isPlaceholderData || Boolean(focusSeq && focusSeq !== rootSeq && thread.isFetching && !thread.data?.replies.some((m) => m.seq === focusSeq));
  // Where "New replies" goes: the read position when the thread opened (from the real data,
  // never the cached root shown while it loads, which knows nothing about reads).
  const [dividerSeq, setDividerSeq] = useState<number | null>(null);
  useEffect(() => {
    if (dividerSeq === null && thread.data && !thread.isPlaceholderData) setDividerSeq(thread.data.lastReadSeq ?? Number.MAX_SAFE_INTEGER);
  }, [dividerSeq, thread.data, thread.isPlaceholderData]);

  const patch = useCallback((update: (message: ChatMessageView) => ChatMessageView | null, seq: number) => {
    queryClient.setQueryData<Thread>(key, (prev) => {
      if (!prev) return prev;
      const apply = (m: ChatMessageView) => (m.seq === seq ? update(m) ?? m : m);
      return { ...prev, root: prev.root ? apply(prev.root) : prev.root, replies: prev.replies.map(apply) };
    });
  }, [key, queryClient]);

  useEffect(() => {
    const subscription = subscribeBroadcast(channelTopic(channelId), (event, payload) => {
      const seq = typeof payload.seq === "number" ? payload.seq : null;
      if (event === "message.new" && (payload as { thread_root_seq?: number }).thread_root_seq === rootSeq) {
        const message = payload as unknown as ChatMessageView;
        // One quiet announcement per reply from someone else (the list itself isn't a live region).
        if (message.author_id !== meId) {
          const text = `New reply from ${personName(message.author)}`;
          // The same words twice in a row: vary them invisibly so screen readers speak again.
          setAnnounce((previous) => (previous === text ? `${text} ` : text));
          if (!atBottom.current) setUnseen((n) => n + 1);
        }
        queryClient.setQueryData<Thread>(key, (prev) => {
          if (!prev) return prev;
          const existing = prev.replies.some((r) => r.seq === message.seq || (message.client_message_id && r.client_message_id === message.client_message_id));
          return {
            ...prev,
            replies: prev.hasNewer || existing ? prev.replies : [...prev.replies, message],
            // Root counters update even when the composer already reconciled the reply.
            root: prev.root ? upsertMessage([[prev.root]], message)[0]?.[0] ?? prev.root : null,
          };
        });
      } else if (seq !== null && event === "message.edit") {
        patch((m) => ({ ...m, body: String(payload.body ?? m.body), edited_at: String(payload.edited_at) }), seq);
      } else if (seq !== null && event === "message.preview_hidden") {
        patch((m) => ({ ...m, link_preview_hidden: true }), seq);
      } else if (seq !== null && event === "message.delete") {
        patch((m) => ({ ...m, body: "", attachments: [], deleted_at: new Date().toISOString() }), seq);
      } else if (seq !== null && (event === "reaction.add" || event === "reaction.remove")) {
        const on = event === "reaction.add";
        const mine = payload.user_id === meId;
        // This tab already shows its own reaction; one made on another device still needs applying.
        patch((m) => (mine && Boolean(m.reactions.find((r) => r.emoji === payload.emoji)?.me) === on
          ? null
          : { ...m, reactions: applyReaction(m.reactions, String(payload.emoji), on, mine) }), seq);
      }
    });
    return subscription.unsubscribe;
  }, [channelId, key, meId, patch, queryClient, rootSeq]);

  const newest = thread.data?.replies.at(-1)?.seq ?? 0;
  const markRead = useCallback(() => {
    if (newest > 0) void markThreadRead({ channelId, rootSeq, seq: newest });
  }, [channelId, newest, rootSeq]);
  useEffect(markRead, [markRead]);

  const loadOlder = async () => {
    const oldest = thread.data?.replies[0]?.seq;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const result = await listThread({ channelId, rootSeq, before: oldest }).finally(() => setLoadingOlder(false));
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    seedCards(queryClient, result.cards);
    queryClient.setQueryData<Thread>(key, (prev) => (prev ? { ...prev, replies: [...result.replies, ...prev.replies], hasOlder: result.hasOlder } : prev));
  };

  const loadNewer = async () => {
    const newest = thread.data?.replies.at(-1)?.seq;
    if (!newest || loadingNewer) return;
    setLoadingNewer(true);
    const result = await listThread({ channelId, rootSeq, after: newest }).finally(() => setLoadingNewer(false));
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    seedCards(queryClient, result.cards);
    queryClient.setQueryData<Thread>(key, (prev) => prev ? {
      ...prev, replies: [...prev.replies, ...result.replies.filter((m) => !prev.replies.some((r) => r.seq === m.seq))], hasNewer: result.hasNewer,
    } : prev);
  };
  const loadLatest = async () => {
    latestMode.current = true;
    const result = await thread.refetch();
    if (result.error) { latestMode.current = false; throw result.error; }
    requestAnimationFrame(() => list.current?.scrollToIndex({ index: "LAST", align: "end" }));
    setUnseen(0);
  };

  const follow = async (on: boolean) => {
    queryClient.setQueryData<Thread>(key, (prev) => (prev ? { ...prev, following: on } : prev));
    const result = await setThreadFollow({ channelId, rootSeq, on });
    if (!result.success) {
      queryClient.setQueryData<Thread>(key, (prev) => (prev ? { ...prev, following: !on } : prev));
      return void toast.error(chatErrorMessage(result.error));
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
    const muted = shell.data?.channels.find((c) => c.id === channelId)?.notify === "mute";
    toast.success(on
      ? (muted ? "Following. This conversation is muted, so new replies won’t notify you or show as new. Unmute it to hear about them." : "You’ll be notified about new replies")
      : "You won’t be notified about this thread");
  };

  const join = async () => {
    const result = await joinChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    void queryClient.invalidateQueries({ queryKey: key });
    shell.refresh();
  };
  const drop = useFileDrop((files) => dropFilesTo(draftKeyOf(channelId, rootSeq), files));

  const nameMap = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  const channelNames = useMemo(() => new Map((shell.data?.channels ?? []).filter((c) => c.name).map((c) => [c.id, c.name!])), [shell.data?.channels]);
  const blockedIds = useBlockedIds();
  const mutedIds = useMutedIds();
  const oneToOne = details.data?.kind === "dm";
  const bugs = useBugsAdded(details.data?.project_id);
  const ctx = useMemo<ConversationContextValue>(() => ({
    channelId, meId, canAdmin: Boolean(details.data?.can_admin), isDm: details.data?.kind === "dm",
    people, nameOf: (id) => nameMap.get(id), channelNameOf: (id) => channelNames.get(id),
    editingSeq, setEditingSeq, openThread: () => undefined, inThread: true,
    isMember, projectId: details.data?.project_id ?? null, bugs,
    savedSeqs: saved.seqs, setSaved: (seq, on, remindAt) => void saved.setSaved(seq, on, remindAt), share: setShareSeq,
    blockedIds: oneToOne ? undefined : blockedIds, mutedIds: oneToOne ? undefined : mutedIds,
  }), [blockedIds, mutedIds, oneToOne, channelId, channelNames, details.data?.can_admin, details.data?.kind, bugs, details.data?.project_id, editingSeq, isMember, meId, nameMap, people, saved]);

  const editLast = useCallback(() => {
    const replies = thread.data?.replies ?? [];
    for (let i = replies.length - 1; i >= 0; i -= 1) {
      const m = replies[i]!;
      if (m.author_id === meId && m.seq > 0 && !m.deleted_at && !m.card && m.kind === "user") return setEditingSeq(m.seq);
    }
  }, [meId, thread.data?.replies]);

  // Replying follows the thread; the divider moves past your own reply, and your reply comes into view.
  // No refetch: the reply is already in the list (a long thread isn't downloaded again per reply).
  const onSent = () => {
    queryClient.setQueryData<Thread>(key, (prev) => (prev ? { ...prev, following: true } : prev));
    setDividerSeq(Number.MAX_SAFE_INTEGER);
    requestAnimationFrame(() => list.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" }));
  };

  const participants = participantsOf(thread.data);
  const rows = useMemo<Row[]>(() => {
    if (!thread.data?.root) return [];
    const list: Row[] = [{ type: "root", message: thread.data.root }, { type: "summary" }];
    if (loadingReplies) list.push({ type: "loading" });
    if (thread.data.hasOlder) list.push({ type: "older" });
    let placed = false;
    thread.data.replies.forEach((m, i) => {
      if (!placed && dividerSeq !== null && m.seq > dividerSeq && m.author_id !== meId && m.seq > 0) {
        placed = true;
        list.push({ type: "new" });
      }
      const prev = thread.data!.replies[i - 1];
      const grouped = Boolean(prev && prev.author_id === m.author_id && Date.parse(m.created_at) - Date.parse(prev.created_at) < 300_000);
      list.push({ type: "reply", message: m, grouped });
    });
    if (thread.data.hasNewer) list.push({ type: "newer" });
    return list;
  }, [dividerSeq, loadingReplies, meId, thread.data]);

  const lastReplyKey = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i]!;
      if (row.type === "reply") return `${row.type}:${row.message.client_message_id ?? row.message.seq}`;
    }
    return null;
  }, [rows]);

  const onLastReplyHeightIncrease = useCallback(() => {
    if (atBottom.current) {
      requestAnimationFrame(() => {
        list.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
      });
    }
  }, []);

  // ↑/↓ walk the replies like the timeline (roving tabindex); Tab lands on the latest one.
  const replySeqs = useMemo(() => rows.flatMap((row) => (row.type === "reply" || row.type === "root") && row.message.kind !== "system" ? [row.message.seq] : []), [rows]);
  const rowTab = tabSeq ?? replySeqs.at(-1) ?? null;
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const row = e.target as HTMLElement;
    if (!row.hasAttribute("data-message-row")) return;
    const at = replySeqs.indexOf(Number(row.dataset.seq));
    const next = replySeqs[at + (e.key === "ArrowDown" ? 1 : -1)];
    if (at < 0 || next === undefined) return;
    e.preventDefault();
    setTabSeq(next);
    const index = rows.findIndex((r) => (r.type === "reply" || r.type === "root") && r.message.seq === next);
    list.current?.scrollIntoView({ index });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.closest("[data-thread-list]")?.querySelector<HTMLElement>(`[data-message-row][data-seq="${next}"]`)?.focus({ preventScroll: true });
    }));
  };
  // A linked reply (?m=) is highlighted for a moment, counted from when the replies are really there.
  const [highlight, setHighlight] = useState<number | null>(focusSeq);
  useEffect(() => setHighlight(focusSeq), [focusSeq]);
  useEffect(() => {
    if (!highlight || loadingReplies) return;
    const timer = setTimeout(() => setHighlight(null), 2_500);
    return () => clearTimeout(timer);
  }, [highlight, loadingReplies]);

  // ↑ to edit your last reply brings it into view (once per edit).
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    if (editingSeq === null) {
      revealed.current = null;
      return;
    }
    if (revealed.current === editingSeq) return;
    const index = rows.findIndex((row) => (row.type === "reply" || row.type === "root") && row.message.seq === editingSeq);
    if (index < 0) return;
    revealed.current = editingSeq;
    list.current?.scrollIntoView({ index });
  }, [editingSeq, rows]);

  const channelLabel = details.data?.name ? `#${details.data.name}` : null;
  // DMs and groups by their name ("Also send to Alice"), channels by #name.
  const conversationLabel = details.data ? channelLabel ?? channelTitle(details.data, meId) : null;
  const archived = Boolean(details.data?.channel_archived_at);
  const canReply = isMember && !archived;
  // A note to yourself has nowhere else to send a copy.
  const alsoSendTo = details.data && isSelfDm(details.data, meId) ? null : conversationLabel;
  const showInConversation = () => {
    if (onShowInConversation) return onShowInConversation();
    // On a phone the thread was pushed like a page: go back to the conversation (not a second
    // copy of it in history), then bring the root into view there.
    if (onClose && !window.matchMedia("(min-width: 1024px)").matches) {
      onClose();
      window.dispatchEvent(new CustomEvent<RevealEvent>(REVEAL_EVENT, { detail: { channelId, seq: rootSeq } }));
      return;
    }
    router.replace(showInConversationHref(channelId, rootSeq, surface === "window" ? "" : window.location.search), { scroll: false });
  };
  const controls = (
    <>
      {isMember && thread.data && !loadingReplies && !archived ? (
        <button
          type="button"
          onClick={() => void follow(!thread.data!.following)}
          aria-pressed={thread.data.following}
          title={thread.data.following ? "You’re notified about new replies. Click to stop." : "Get notified about new replies"}
          className={`inline-flex h-7 flex-none items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium hover:bg-muted pointer-coarse:h-11 ${thread.data.following ? "border-primary/40 bg-accent text-accent-foreground" : "border-border"}`}
        >
          {thread.data.following ? <><Check size={14} aria-hidden="true" /> Following</> : "Follow"}
        </button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger className="nb-icon-button nb-touch-target size-8 flex-none" aria-label="Thread options">
          <MoreHorizontal size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => { void copyWithToast(`${window.location.origin}${threadHref(channelId, rootSeq, { m: focusSeq, pane: "thread" }, surface === "window" ? "" : window.location.search)}`, "Thread link copied"); }}>
            <Link2 /> Copy link to thread
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={showInConversation}>
            <SquareArrowOutUpRight /> Show in conversation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  // The root's count is the true total (replies may be paged).
  const replyCount = thread.data?.root?.reply_count ?? thread.data?.replies.length ?? 0;
  const lastReply = thread.data?.replies.at(-1)?.created_at;

  return (
    <ConversationContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Follow and ⋯ live in the drawer's header; without one (the floating window) they get their own row. */}
        {headerSlot ? createPortal(controls, headerSlot) : <div className="flex min-h-11 flex-none items-center justify-end gap-2 border-b border-border px-3">{controls}</div>}
        <p className="sr-only" aria-live="polite">{announce}</p>
        <MessageHistory
          variant="thread"
          className="relative min-h-0 flex-1"
          role="log"
          aria-live="off"
          aria-label="Thread replies"
          data-thread-list=""
          onKeyDown={onListKeyDown}
          onFocus={(e) => {
            const seq = Number((e.target as HTMLElement).dataset?.seq);
            if ((e.target as HTMLElement).hasAttribute?.("data-message-row") && seq) setTabSeq(seq);
          }}
          // Files dropped here go to the reply box only when you can reply (never vanish).
          {...(canReply ? drop.handlers : {})}
        >
          {canReply ? <DropOverlay show={drop.dragging} /> : null}
          {thread.isLoading ? <RepliesSkeleton /> : null}
          {thread.isError || (thread.data && !thread.data.root) ? (
            <div className="space-y-3 bg-card p-4">
              {thread.isError
                ? <ErrorNotice what="This thread" onRetry={() => void thread.refetch()} />
                : <p role="alert" className="text-center text-[13px] text-muted-foreground">This thread isn’t available. It may have been deleted.</p>}
              <div className="flex justify-center">
                {onClose
                  ? <Button type="button" variant="outline" size="sm" onClick={onClose}>Back to conversation</Button>
                  : <Button asChild variant="outline" size="sm"><Link href={conversationHref(channelId)}>Back to conversation</Link></Button>}
              </div>
            </div>
          ) : null}
          {rows.length ? (
            <Virtuoso
              // Rebuilt once the real replies land, so it starts at the linked or first unread reply
              // (the cached root alone would pin it to the bottom).
              key={loadingReplies ? "cached" : `loaded:${focusSeq ?? "latest"}`}
              ref={list}
              context={{ typing: typingNow }}
              atBottomStateChange={(bottom) => { atBottom.current = bottom; setShowLatest(!bottom); if (bottom) setUnseen(0); }}
              className="app-scroll app-scroll-y h-full"
              data={rows}
              // A linked reply, else the first unread one, else the latest (never the top of a long thread).
              initialTopMostItemIndex={focusSeq && rows.some((row) => row.type === "reply" && row.message.seq === focusSeq)
                ? { index: rows.findIndex((row) => row.type === "reply" && row.message.seq === focusSeq), align: "center" }
                : rows.some((row) => row.type === "new") ? rows.findIndex((row) => row.type === "new") : { index: rows.length - 1, align: "end" }}
              followOutput={(bottom) => (bottom ? "smooth" : false)}
              computeItemKey={(index, row) => (row.type === "reply" || row.type === "root" ? `${row.type}:${row.message.client_message_id ?? row.message.seq}` : `${row.type}:${index}`)}
              itemContent={(_index, row) => {
                if (row.type === "newer") return <div className="px-4 py-1"><Button type="button" variant="ghost" size="sm" disabled={loadingNewer} onClick={() => void loadNewer()}>{loadingNewer ? "Loading…" : "Load newer replies"}</Button></div>;
                if (row.type === "root") return <div className="pt-2"><MessageRow message={row.message} grouped={false} tabStop={rowTab === row.message.seq} /></div>;
                if (row.type === "loading") return <RepliesSkeleton />;
                if (row.type === "new") {
                  return (
                    <div className="flex items-center gap-3 px-4 py-1" role="separator" aria-label="New replies">
                      <span className="h-px flex-1 bg-primary" />
                      <span className="nb-micro rounded-sm bg-card px-1 text-primary">New replies</span>
                    </div>
                  );
                }
                if (row.type === "older") {
                  return (
                    <div className="px-4 py-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder} className="-ml-2.5 text-primary pointer-coarse:h-11">
                        {loadingOlder ? "Loading…" : "Load earlier replies"}
                      </Button>
                    </div>
                  );
                }
                if (row.type === "summary") {
                  return (
                    <div className="space-y-1.5 px-4 py-2">
                      {/* Who replied: nothing to list until someone has. */}
                      {replyCount > 0 && participants.length ? (
                        <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
                          <span className="inline-flex -space-x-1.5">
                            {participants.slice(0, 4).map((p) => <span key={p.id} className="inline-block rounded-sm ring-2 ring-card"><UserAvatar identity={p} size={20} /></span>)}
                          </span>
                          <span className="truncate">{names(participants)}</span>
                        </span>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <span className="nb-meta">{replyCount ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : loadingReplies ? "Replies" : "No replies yet"}</span>
                        {lastReply ? <span className="nb-meta" title={new Date(lastReply).toLocaleString()}>· last reply {formatChatTime(lastReply, "ago")}</span> : null}
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    </div>
                  );
                }
                const itemKey = `${row.type}:${row.message.client_message_id ?? row.message.seq}`;
                const rowItem = <MessageRow message={row.message} grouped={row.grouped} highlighted={highlight === row.message.seq} tabStop={rowTab === row.message.seq} />;
                if (itemKey === lastReplyKey) {
                  return <LastItemTracker onHeightIncrease={onLastReplyHeightIncrease}>{rowItem}</LastItemTracker>;
                }
                return rowItem;
              }}
              components={THREAD_COMPONENTS}
            />
          ) : null}
        </MessageHistory>
        {(showLatest || thread.data?.hasNewer) && rows.length ? <LatestBar onClick={() => { if (thread.data?.hasNewer) void loadLatest().catch(() => toast.error("Couldn’t load the latest replies", { description: "Try again." })); else { list.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" }); setUnseen(0); } }} unseen={unseen} label="Jump to latest reply" /> : null}
        {canReply ? (
          <Composer
            channelId={channelId}
            threadRootSeq={rootSeq}
            placeholder="Reply…"
            people={people}
            allowBroadcast={false}
            canCreateTask={false}
            beforeSend={thread.data?.hasNewer ? loadLatest : undefined}
            onSent={onSent}
            onTyping={typing.notify}
            typingNames={typing.names}
            onEditLast={editLast}
            alsoSendTo={alsoSendTo}
            autoFocus={autoFocus}
          />
        ) : details.data ? (
          <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
            {details.data.channel_archived_at ? (
              <span>This channel is archived. You can read it, but not reply.</span>
            ) : details.data.kind === "public" ? (
              <>
                <span>Join {channelLabel ?? "the channel"} to reply.</span>
                <Button type="button" size="sm" onClick={() => void join()} className="pointer-coarse:h-11">Join</Button>
              </>
            ) : (
              <span>You’re not in this conversation.</span>
            )}
          </div>
        ) : null}
      </div>
      {shareSeq !== null ? <ShareDialog channelId={channelId} seq={shareSeq} onClose={() => setShareSeq(null)} /> : null}
    </ConversationContext.Provider>
  );
}
