"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AtSign, Hash, MessageSquareText, Plus } from "lucide-react";
import { toast } from "sonner";

import { listActivity, listDirectMessages, listThreads } from "@/app/actions/chat/activity";
import { browseChannels, joinChannel } from "@/app/actions/chat/channels";
import { useChatUi, readChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListOrHome } from "@/components/messages/HomePane";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, isUnread, personName, rowCount } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { tokensToPlainText } from "@/lib/messaging/tokens";
import { queryKeys } from "@/lib/query-keys";

const when = (value: string | null) => (value ? formatChatTime(value) : "");

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** /messages/p/[projectId]: select the project; on desktop open its last or default channel. */
export function ProjectLanding({ projectId }: { projectId: string }) {
  const router = useRouter();
  const setProject = useChatUi((state) => state.setProject);
  const { data } = useChatShell();
  useEffect(() => setProject(projectId), [projectId, setProject]);
  useEffect(() => {
    if (!data || !window.matchMedia("(min-width: 1024px)").matches) return;
    const last = readChatUi().last;
    const inProject = data.channels.filter((c) => c.project_id === projectId && !c.channel_archived_at);
    const target = inProject.find((c) => c.id === last) ?? inProject.find((c) => c.is_default) ?? inProject[0];
    if (target) router.replace(`/messages/${target.id}`);
  }, [data, projectId, router]);
  return <ListOrHome />;
}

/** Public channels in a project, client-side filter, Join (D5). Private channels are never listed. */
export function BrowseChannels({ projectId }: { projectId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, refresh } = useChatShell();
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const [filter, setFilter] = useState("");
  const channels = useQuery({
    queryKey: queryKeys.chat.browse(projectId),
    queryFn: async () => {
      const result = await browseChannels({ projectId });
      if (!result.success) throw new Error(result.error);
      return result.channels;
    },
  });
  const title = data?.projects?.find((p) => p.id === projectId)?.title;
  const visible = (channels.data ?? []).filter((c) => !filter || c.name.includes(filter.toLowerCase()) || (c.description ?? "").toLowerCase().includes(filter.toLowerCase()));
  const join = async (channelId: string) => {
    const result = await joinChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refresh();
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.browse(projectId) });
    router.push(`/messages/${channelId}`);
  };
  return (
    <ViewScreen
      title={title ? `Browse channels in ${title}` : "Browse channels"}
      action={<button type="button" onClick={() => setCreateFor(projectId)} className="inline-flex min-h-11 items-center gap-1 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground sm:min-h-[var(--ui-control-height)]"><Plus size={14} /> Create channel</button>}
    >
      <div className="border-b border-border p-3 sm:px-4">
        <label className="block">
          <span className="sr-only">Filter channels</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels" className="h-[var(--ui-control-height)] w-full max-w-md rounded-[5px] border border-input bg-card px-3 text-[15px] pointer-coarse:h-11 pointer-coarse:text-[17px]" />
        </label>
      </div>
      {channels.isLoading ? <Empty>Loading channels…</Empty> : null}
      {channels.isError ? <Empty>Channels are unavailable. You may not be a member of this project.</Empty> : null}
      <ul aria-label="Channels">
        {visible.map((channel) => (
          <li key={channel.id} className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-2">
            <Hash size={16} aria-hidden="true" className="flex-none text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <Link href={`/messages/${channel.id}`} className="block truncate text-[15px] font-medium hover:underline">{channel.name}</Link>
              <p className="truncate text-[13px] text-muted-foreground">{channel.description || channel.topic || "No description"} · <span className="font-mono text-[12px]">{channel.member_count} members</span></p>
            </div>
            {channel.joined ? (
              <span className="font-mono text-[12px] text-muted-foreground">Joined</span>
            ) : (
              <button type="button" onClick={() => void join(channel.id)} className="min-h-11 rounded-[5px] border border-border px-3 text-[13px] font-medium sm:min-h-[var(--ui-control-height)]">Join</button>
            )}
          </li>
        ))}
      </ul>
      {channels.data && !visible.length ? <Empty>No channels match.</Empty> : null}
    </ViewScreen>
  );
}

/** Mentions and thread replies (from chat_mentions), newest first. */
export function ActivityView() {
  const activity = useInfiniteQuery({
    queryKey: queryKeys.chat.activity(),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listActivity({ before: pageParam });
      return result.success ? result.items : [];
    },
    getNextPageParam: (page) => (page.length === 50 ? page.at(-1)?.created_at : undefined),
  });
  const items = activity.data?.pages.flat() ?? [];
  return (
    <ViewScreen title="Activity">
      {activity.isLoading ? <Empty>Loading activity…</Empty> : null}
      {activity.data && !items.length ? <Empty>Mentions and replies to your threads show up here.</Empty> : null}
      <ul aria-label="Activity">
        {items.map((item) => {
          const href = item.thread_root_seq ? `/messages/${item.channel_id}/thread/${item.thread_root_seq}` : `/messages/${item.channel_id}?m=${item.seq}`;
          return (
            <li key={`${item.channel_id}:${item.seq}:${item.kind}`}>
              <Link href={href} className="flex min-h-16 gap-3 border-b border-border px-4 py-3 hover:bg-muted">
                <UserAvatar identity={item.author} size={34} roundedClassName="rounded-[5px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 text-[13px]">
                    {item.kind === "thread_reply" ? <MessageSquareText size={12} aria-hidden="true" /> : <AtSign size={12} aria-hidden="true" />}
                    <span className="font-medium">{personName(item.author)}</span>
                    <span className="text-muted-foreground">{item.kind === "thread_reply" ? "replied in a thread" : "mentioned you"}{item.channel_name ? ` in #${item.channel_name}` : ""}</span>
                    <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(item.created_at)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[15px]">{tokensToPlainText(item.body)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {activity.hasNextPage ? (
        <div className="p-4 text-center"><button type="button" onClick={() => void activity.fetchNextPage()} className="min-h-11 rounded-[5px] border border-border px-4 text-[13px]">Load more</button></div>
      ) : null}
    </ViewScreen>
  );
}

export function ThreadsView() {
  const threads = useQuery({
    queryKey: queryKeys.chat.threads(),
    queryFn: async () => {
      const result = await listThreads();
      return result.success ? result.threads : [];
    },
  });
  return (
    <ViewScreen title="Threads">
      {threads.isLoading ? <Empty>Loading threads…</Empty> : null}
      {threads.data && !threads.data.length ? <Empty>Threads you start or reply to show up here.</Empty> : null}
      <ul aria-label="Threads">
        {(threads.data ?? []).map((t) => (
          <li key={`${t.channel_id}:${t.root_seq}`}>
            <Link href={`/messages/${t.channel_id}/thread/${t.root_seq}`} className="flex min-h-16 gap-3 border-b border-border px-4 py-3 hover:bg-muted" data-unread={t.unread ? "true" : undefined}>
              <UserAvatar identity={t.author} size={34} roundedClassName="rounded-[5px]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-[13px]">
                  <span className={t.unread ? "font-semibold" : "font-medium"}>{t.channel_name ? `#${t.channel_name}` : "Direct message"}</span>
                  <span className="text-muted-foreground">{t.reply_count} {t.reply_count === 1 ? "reply" : "replies"}</span>
                  <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(t.last_reply_at)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[15px]">{tokensToPlainText(t.body)}</span>
              </span>
              {t.unread ? <span className="mt-2 size-2 flex-none rounded-full bg-[var(--chat-accent)]" aria-label="Unread" /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </ViewScreen>
  );
}

/** Every DM and group chat with previews (L-30: the sidebar shows the 8 most recent). */
export function DmList() {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const dms = useInfiniteQuery({
    queryKey: queryKeys.chat.dms(),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listDirectMessages({ before: pageParam });
      return result.success ? result.channels : [];
    },
    getNextPageParam: (page) => (page.length === 50 ? page.at(-1)?.last_message_at ?? undefined : undefined),
  });
  const channels = useMemo(() => (dms.data?.pages.flat() ?? []).filter((c) => !c.archived_at), [dms.data]);
  return (
    <ViewScreen title="Direct messages" action={<Link href="/messages/new" className="inline-flex min-h-11 items-center rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground sm:min-h-[var(--ui-control-height)]">New message</Link>}>
      {dms.isLoading ? <Empty>Loading…</Empty> : null}
      {dms.data && !channels.length ? <Empty>No direct messages yet.</Empty> : null}
      <ul aria-label="Direct messages">
        {channels.map((c) => {
          const count = rowCount(c);
          return (
            <li key={c.id}>
              <Link href={`/messages/${c.id}`} className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-3 hover:bg-muted" data-testid={`chat-row-${c.id}`}>
                <UserAvatar identity={c.dm_user ?? c.members_preview?.[0]} size={34} roundedClassName="rounded-[5px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`truncate text-[15px] ${isUnread(c) ? "font-semibold" : "font-medium"}`}>{channelTitle(c, meId)}</span>
                    <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(c.last_message_at)}</span>
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">{c.last_preview ? `${c.last_author_id === meId ? "You: " : ""}${c.last_preview}` : "No messages yet"}</span>
                </span>
                {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {dms.hasNextPage ? <div className="p-4 text-center"><button type="button" onClick={() => void dms.fetchNextPage()} className="min-h-11 rounded-[5px] border border-border px-4 text-[13px]">Load more</button></div> : null}
    </ViewScreen>
  );
}
