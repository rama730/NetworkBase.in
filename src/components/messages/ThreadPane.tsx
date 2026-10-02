"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { listThread } from "@/app/actions/chat/messages";
import { markThreadRead } from "@/app/actions/chat/read";
import { Composer } from "@/components/messages/Composer";
import { ConversationContext, type ConversationContextValue } from "@/components/messages/conversation-context";
import { MessageRow } from "@/components/messages/MessageRow";
import { seedCards, useChannelDetails, useChannelMembers } from "@/components/messages/useConversation";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useAuth } from "@/hooks/useAuth";
import { personName } from "@/lib/messaging/channel-view";
import { channelTopic } from "@/lib/messaging/constants";
import { applyReaction } from "@/lib/messaging/timeline";
import type { ChatMessageView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";

type Thread = { root: ChatMessageView | null; replies: ChatMessageView[] };

/** Root message plus replies (drawer at 1024px+, full screen below). Replies arrive on the channel topic. */
export function ThreadPane({ channelId, rootSeq }: { channelId: string; rootSeq: number }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const details = useChannelDetails(channelId);
  const members = useChannelMembers(channelId, Boolean(details.data?.is_member));
  const people = useMemo(() => members.data ?? [], [members.data]);
  const key = useMemo(() => queryKeys.chat.thread(channelId, rootSeq), [channelId, rootSeq]);
  const [editingSeq, setEditingSeq] = useState<number | null>(null);

  const thread = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Thread> => {
      const result = await listThread({ channelId, rootSeq });
      if (!result.success) throw new Error(result.error);
      seedCards(queryClient, result.cards);
      return { root: result.root, replies: result.replies };
    },
  });

  const patch = useCallback((update: (message: ChatMessageView) => ChatMessageView | null, seq: number) => {
    queryClient.setQueryData<Thread>(key, (prev) => {
      if (!prev) return prev;
      const apply = (m: ChatMessageView) => (m.seq === seq ? update(m) ?? m : m);
      return { root: prev.root ? apply(prev.root) : prev.root, replies: prev.replies.map(apply) };
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
  useEffect(() => {
    if (newest > 0) void markThreadRead({ channelId, rootSeq, seq: newest });
  }, [channelId, newest, rootSeq]);

  const names = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  const channelNames = useMemo(() => new Map((shell.data?.channels ?? []).filter((c) => c.name).map((c) => [c.id, c.name!])), [shell.data?.channels]);
  const ctx = useMemo<ConversationContextValue>(() => ({
    channelId, meId, canAdmin: Boolean(details.data?.can_admin), isDm: details.data?.kind === "dm",
    people, nameOf: (id) => names.get(id), channelNameOf: (id) => channelNames.get(id),
    editingSeq, setEditingSeq, openThread: () => undefined, inThread: true,
  }), [channelId, channelNames, details.data?.can_admin, details.data?.kind, editingSeq, meId, names, people]);

  const onSent = useCallback(() => void queryClient.invalidateQueries({ queryKey: key }), [key, queryClient]);

  return (
    <ConversationContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="app-scroll app-scroll-y min-h-0 flex-1 py-2" role="log" aria-label="Thread replies" aria-live="polite">
          {thread.isLoading ? <p role="status" className="p-6 text-center text-[13px] text-muted-foreground">Loading thread…</p> : null}
          {thread.isError ? <p role="alert" className="p-6 text-center text-[13px] text-muted-foreground">This thread isn&apos;t available.</p> : null}
          {thread.data?.root ? <MessageRow message={thread.data.root} grouped={false} /> : null}
          {thread.data ? (
            <div className="flex items-center gap-3 px-4 py-2">
              <span className="font-mono text-[12px] text-muted-foreground">{thread.data.replies.length} {thread.data.replies.length === 1 ? "reply" : "replies"}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}
          {thread.data?.replies.map((m, i) => {
            const prev = thread.data!.replies[i - 1];
            const grouped = Boolean(prev && prev.author_id === m.author_id && Date.parse(m.created_at) - Date.parse(prev.created_at) < 300_000);
            return <MessageRow key={m.client_message_id ?? m.seq} message={m} grouped={grouped} />;
          })}
        </div>
        {details.data?.is_member && !details.data.channel_archived_at ? (
          // ponytail: no "also send to the channel" (L-31). upgrade: when requested.
          <Composer channelId={channelId} threadRootSeq={rootSeq} placeholder="Reply…" people={people} allowBroadcast={false} canCreateTask={false} onSent={onSent} />
        ) : null}
      </div>
    </ConversationContext.Provider>
  );
}
