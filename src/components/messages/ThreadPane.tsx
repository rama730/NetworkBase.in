"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Bell, BellOff, Check, Link2, MoreHorizontal, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";

import { listThread, setThreadFollow } from "@/app/actions/chat/messages";
import { markThreadRead } from "@/app/actions/chat/read";
import { ConversationContext, type ConversationContextValue } from "@/components/messages/conversation-context";
import { MessageRow } from "@/components/messages/MessageRow";
import { seedCards, useChannelDetails, useChannelMembers, useSavedSeqs, useTyping } from "@/components/messages/useConversation";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { formatChatTime, personName } from "@/lib/messaging/channel-view";
import { channelTopic } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref, threadHref } from "@/lib/messaging/routes";
import { applyReaction } from "@/lib/messaging/timeline";
import type { ChatMessageView, ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";

const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), {
  ssr: false,
  loading: () => <div className="nb-message-composer border-t border-border bg-card px-3 pt-2 sm:px-4"><div className="h-[86px] rounded-lg border border-input" /></div>,
});
const ShareDialog = dynamic(() => import("@/components/messages/parts/ShareDialog").then((m) => m.ShareDialog), { ssr: false });

// Stable identity so Virtuoso never remounts the footer (VIRT-01).
const THREAD_COMPONENTS = { Footer: () => <div className="h-6" /> };

type Thread = { root: ChatMessageView | null; replies: ChatMessageView[]; following: boolean; lastReadSeq: number | null };
type Row = { type: "root"; message: ChatMessageView } | { type: "summary" } | { type: "new" } | { type: "reply"; message: ChatMessageView; grouped: boolean };

function participantsOf(thread: Thread | undefined) {
  const seen = new Map<string, ChatPerson>();
  for (const reply of thread?.replies ?? []) if (reply.author && !seen.has(reply.author.id)) seen.set(reply.author.id, reply.author);
  return [...seen.values()];
}

function names(people: ChatPerson[]) {
  const first = people.slice(0, 2).map((p) => personName(p).split(" ")[0]);
  if (people.length <= 2) return first.join(" and ");
  return `${first.join(", ")} and ${people.length - 2} other${people.length === 3 ? "" : "s"}`;
}

/** Root message plus replies (drawer at 1024px+, full screen below). Replies arrive on the channel topic. */
export function ThreadPane({ channelId, rootSeq }: { channelId: string; rootSeq: number }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const details = useChannelDetails(channelId);
  const isMember = Boolean(details.data?.is_member);
  const members = useChannelMembers(channelId, isMember);
  const people = useMemo(() => members.data ?? [], [members.data]);
  const typing = useTyping(channelId, { rootSeq, people, memberCount: details.data?.member_count ?? 0, enabled: isMember });
  const saved = useSavedSeqs(channelId, isMember);
  const key = useMemo(() => queryKeys.chat.thread(channelId, rootSeq), [channelId, rootSeq]);
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [shareSeq, setShareSeq] = useState<number | null>(null);

  const thread = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Thread> => {
      const result = await listThread({ channelId, rootSeq });
      if (!result.success) throw new Error(result.error);
      seedCards(queryClient, result.cards);
      return { root: result.root, replies: result.replies, following: result.following, lastReadSeq: result.lastReadSeq };
    },
  });
  // Where "New replies" goes: the read position when the thread opened.
  const [dividerSeq, setDividerSeq] = useState<number | null>(null);
  useEffect(() => {
    if (dividerSeq === null && thread.data) setDividerSeq(thread.data.lastReadSeq ?? Number.MAX_SAFE_INTEGER);
  }, [dividerSeq, thread.data]);

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
        queryClient.setQueryData<Thread>(key, (prev) => (prev && !prev.replies.some((r) => r.seq === message.seq || (message.client_message_id && r.client_message_id === message.client_message_id))
          ? { ...prev, replies: [...prev.replies, message] }
          : prev));
      } else if (seq !== null && event === "message.edit") {
        patch((m) => ({ ...m, body: String(payload.body ?? m.body), edited_at: String(payload.edited_at) }), seq);
      } else if (seq !== null && event === "message.delete") {
        patch((m) => ({ ...m, body: "", attachments: [], deleted_at: new Date().toISOString() }), seq);
      } else if (seq !== null && (event === "reaction.add" || event === "reaction.remove") && payload.user_id !== meId) {
        patch((m) => ({ ...m, reactions: applyReaction(m.reactions, String(payload.emoji), event === "reaction.add", false) }), seq);
      }
    });
    return subscription.unsubscribe;
  }, [channelId, key, meId, patch, queryClient, rootSeq]);

  const newest = thread.data?.replies.at(-1)?.seq ?? 0;
  const markRead = useCallback(() => {
    if (newest > 0) void markThreadRead({ channelId, rootSeq, seq: newest });
  }, [channelId, newest, rootSeq]);
  useEffect(markRead, [markRead]);

  const follow = async (on: boolean) => {
    queryClient.setQueryData<Thread>(key, (prev) => (prev ? { ...prev, following: on } : prev));
    const result = await setThreadFollow({ channelId, rootSeq, on });
    if (!result.success) {
      queryClient.setQueryData<Thread>(key, (prev) => (prev ? { ...prev, following: !on } : prev));
      return void toast.error(chatErrorMessage(result.error));
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
    toast(on ? "You'll be notified about new replies" : "You won't be notified about this thread");
  };

  const nameMap = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  const channelNames = useMemo(() => new Map((shell.data?.channels ?? []).filter((c) => c.name).map((c) => [c.id, c.name!])), [shell.data?.channels]);
  const ctx = useMemo<ConversationContextValue>(() => ({
    channelId, meId, canAdmin: Boolean(details.data?.can_admin), isDm: details.data?.kind === "dm",
    people, nameOf: (id) => nameMap.get(id), channelNameOf: (id) => channelNames.get(id),
    editingSeq, setEditingSeq, openThread: () => undefined, inThread: true,
    isMember, projectId: details.data?.project_id ?? null,
    savedSeqs: saved.seqs, setSaved: (seq, on, remindAt) => void saved.setSaved(seq, on, remindAt), share: setShareSeq,
  }), [channelId, channelNames, details.data?.can_admin, details.data?.kind, details.data?.project_id, editingSeq, isMember, meId, nameMap, people, saved]);

  const editLast = useCallback(() => {
    const replies = thread.data?.replies ?? [];
    for (let i = replies.length - 1; i >= 0; i -= 1) {
      const m = replies[i]!;
      if (m.author_id === meId && m.seq > 0 && !m.deleted_at && !m.card) return setEditingSeq(m.seq);
    }
  }, [meId, thread.data?.replies]);

  const onSent = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key });
    // Replying follows the thread; the divider moves past your own reply.
    setDividerSeq(Number.MAX_SAFE_INTEGER);
  }, [key, queryClient]);

  const participants = participantsOf(thread.data);
  const rows = useMemo<Row[]>(() => {
    if (!thread.data?.root) return [];
    const list: Row[] = [{ type: "root", message: thread.data.root }, { type: "summary" }];
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
    return list;
  }, [dividerSeq, meId, thread.data]);

  const channelLabel = details.data?.name ? `#${details.data.name}` : null;
  const replyCount = thread.data?.replies.length ?? 0;
  const lastReply = thread.data?.replies.at(-1)?.created_at;

  return (
    <ConversationContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-11 flex-none items-center gap-2 border-b border-border px-3">
          {participants.length ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-muted-foreground">
              <span className="inline-flex -space-x-1.5">
                {participants.slice(0, 4).map((p) => <span key={p.id} className="inline-block rounded-[4px] ring-2 ring-card"><UserAvatar identity={p} size={20} roundedClassName="rounded-[4px]" /></span>)}
              </span>
              <span className="truncate">{names(participants)}</span>
            </span>
          ) : <span className="flex-1" />}
          {isMember && thread.data ? (
            <button
              type="button"
              onClick={() => void follow(!thread.data!.following)}
              aria-pressed={thread.data.following}
              className="inline-flex h-7 flex-none items-center gap-1.5 rounded-[5px] border border-border px-2 text-[12px] font-medium hover:bg-muted pointer-coarse:h-11"
            >
              {thread.data.following ? <BellOff size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />}
              {thread.data.following ? "Unfollow" : "Follow"}
            </button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="grid size-7 flex-none place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label="Thread options">
              <MoreHorizontal size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => { markRead(); setDividerSeq(Number.MAX_SAFE_INTEGER); }}><Check size={14} className="mr-2" /> Mark as read</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void navigator.clipboard?.writeText(`${window.location.origin}${threadHref(channelId, rootSeq)}`); toast.success("Thread link copied"); }}>
                <Link2 size={14} className="mr-2" /> Copy link to thread
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={conversationHref(channelId, { m: rootSeq })}><SquareArrowOutUpRight size={14} className="mr-2" /> Show in conversation</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative min-h-0 flex-1" role="log" aria-label="Thread replies" aria-live="polite">
          {thread.isLoading ? <p role="status" className="p-6 text-center text-[13px] text-muted-foreground">Loading thread…</p> : null}
          {thread.isError ? <p role="alert" className="p-6 text-center text-[13px] text-muted-foreground">This thread isn&apos;t available.</p> : null}
          {rows.length ? (
            <Virtuoso
              className="app-scroll app-scroll-y h-full"
              data={rows}
              initialTopMostItemIndex={Math.max(0, rows.findIndex((row) => row.type === "new"))}
              followOutput={(bottom) => (bottom ? "smooth" : false)}
              computeItemKey={(index, row) => (row.type === "reply" || row.type === "root" ? `${row.type}:${row.message.client_message_id ?? row.message.seq}` : `${row.type}:${index}`)}
              itemContent={(_index, row) => {
                if (row.type === "root") return <div className="pt-2"><MessageRow message={row.message} grouped={false} /></div>;
                if (row.type === "new") {
                  return (
                    <div className="flex items-center gap-3 px-4 py-1" role="separator" aria-label="New replies">
                      <span className="h-px flex-1 bg-[var(--chat-accent)]" />
                      <span className="font-mono text-[11px] uppercase text-[var(--chat-accent)]">New replies</span>
                    </div>
                  );
                }
                if (row.type === "summary") {
                  return (
                    <div className="flex items-center gap-2 px-4 py-2">
                      <span className="font-mono text-[12px] text-muted-foreground">{replyCount} {replyCount === 1 ? "reply" : "replies"}</span>
                      {lastReply ? <span className="text-[12px] text-muted-foreground">· last {formatChatTime(lastReply, "ago")}</span> : null}
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  );
                }
                return <MessageRow message={row.message} grouped={row.grouped} />;
              }}
              components={THREAD_COMPONENTS}
            />
          ) : null}
        </div>
        {isMember && !details.data?.channel_archived_at ? (
          <Composer
            channelId={channelId}
            threadRootSeq={rootSeq}
            placeholder="Reply…"
            people={people}
            allowBroadcast={false}
            canCreateTask={false}
            onSent={onSent}
            onTyping={typing.notify}
            typingNames={typing.names}
            onEditLast={editLast}
            alsoSendTo={channelLabel ?? (details.data ? "the conversation" : null)}
          />
        ) : null}
      </div>
      {shareSeq !== null ? <ShareDialog channelId={channelId} seq={shareSeq} onClose={() => setShareSeq(null)} /> : null}
    </ConversationContext.Provider>
  );
}
