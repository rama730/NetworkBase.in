"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, AtSign, CheckCheck, ChevronDown, Clock, Hash, MessageSquareText, Paperclip, Pencil, Plus, Search, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { listDirectMessages, listInbox, listThreads, markInboxRead, type InboxFilter, type InboxItem, type ThreadItem } from "@/app/actions/chat/activity";
import { browseChannels, joinChannel } from "@/app/actions/chat/channels";
import { cancelScheduled, listSaved, listScheduled, saveMessage, type SavedItem } from "@/app/actions/chat/later";
import { searchMessages, type SearchHit } from "@/app/actions/chat/search";
import { useChatUi, useDrafts, writeDraft } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListOrHome } from "@/components/messages/HomePane";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, isDirectLike, isUnread, needsAttention, personName, rowCount } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref, threadHref } from "@/lib/messaging/routes";
import { tokensToPlainText } from "@/lib/messaging/tokens";
import type { ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), { ssr: false });

const when = (value: string | null) => (value ? formatChatTime(value) : "");

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** Loads the next page when it scrolls into view (infinite lists). */
function LoadMore({ hasMore, loading, onLoad }: { hasMore: boolean; loading: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const load = useRef(onLoad);
  useEffect(() => { load.current = onLoad; });
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load.current();
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore]);
  if (!hasMore) return null;
  return <div ref={ref} className="p-4 text-center text-[12px] text-muted-foreground">{loading ? "Loading…" : ""}</div>;
}

function where(item: { channel_name: string | null; channel_title?: string | null; channel_kind: string }) {
  if (item.channel_name) return `#${item.channel_name}`;
  return item.channel_title || (item.channel_kind === "dm" ? "a direct message" : "a group conversation");
}

/** /messages/p/[projectId]: select the project; displays channels in sidebar while main pane shows placeholder. */
export function ProjectLanding({ projectId }: { projectId: string }) {
  const setProject = useChatUi((state) => state.setProject);
  useEffect(() => setProject(projectId), [projectId, setProject]);
  return <ListOrHome />;
}

type BrowseSort = "name" | "members";
type BrowseShow = "all" | "joined" | "open";

/** Public channels in a project: filter, sort, join (D5). Private channels are never listed. */
export function BrowseChannels({ projectId }: { projectId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, refresh } = useChatShell();
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<BrowseSort>("name");
  const [show, setShow] = useState<BrowseShow>("all");
  const channels = useQuery({
    queryKey: queryKeys.chat.browse(projectId),
    queryFn: async () => {
      const result = await browseChannels({ projectId });
      if (!result.success) throw new Error(result.error);
      return result.channels;
    },
  });
  const title = data?.projects?.find((p) => p.id === projectId)?.title;
  const needle = filter.toLowerCase();
  const visible = (channels.data ?? [])
    .filter((c) => !needle || c.name.includes(needle) || (c.description ?? "").toLowerCase().includes(needle))
    .filter((c) => show === "all" || (show === "joined" ? c.joined : !c.joined))
    .sort((a, b) => (sort === "members" ? b.member_count - a.member_count : 0) || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  const join = async (channelId: string) => {
    const result = await joinChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refresh();
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.browse(projectId) });
    router.push(conversationHref(channelId));
  };
  return (
    <ViewScreen
      title={title ? `Browse channels in ${title}` : "Browse channels"}
      action={<button type="button" onClick={() => setCreateFor(projectId)} className="inline-flex min-h-11 items-center gap-1 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground sm:min-h-[var(--ui-control-height)]"><Plus size={14} /> Create channel</button>}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-4">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Filter channels</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels" className="h-[var(--ui-control-height)] w-full max-w-md rounded-[5px] border border-input bg-card px-3 text-[15px] pointer-coarse:h-11 pointer-coarse:text-[17px]" />
        </label>
        <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as BrowseShow)} className="h-[var(--ui-control-height)] rounded-[5px] border border-input bg-card px-2 text-[13px]">
          <option value="all">All channels</option>
          <option value="joined">Joined</option>
          <option value="open">Not joined</option>
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as BrowseSort)} className="h-[var(--ui-control-height)] rounded-[5px] border border-input bg-card px-2 text-[13px]">
          <option value="name">Sort: Name</option>
          <option value="members">Sort: Most members</option>
        </select>
      </div>
      <p className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">Private channels aren&apos;t listed. Ask a member to add you.</p>
      {channels.isLoading ? <Empty>Loading channels…</Empty> : null}
      {channels.isError ? <Empty>Channels are unavailable. You may not be a member of this project.</Empty> : null}
      <ul aria-label="Channels">
        {visible.map((channel) => (
          <li key={channel.id} className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-2">
            <Hash size={16} aria-hidden="true" className="flex-none text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <Link href={conversationHref(channel.id)} className="block truncate text-[15px] font-medium hover:underline">{channel.name}</Link>
              <p className="truncate text-[13px] text-muted-foreground">{channel.description || channel.topic || "No description"} · <span className="font-mono text-[12px]">{channel.member_count} members</span></p>
            </div>
            {channel.joined ? (
              <Link href={conversationHref(channel.id)} className="font-mono text-[12px] text-muted-foreground hover:text-foreground">Joined · Open</Link>
            ) : (
              <>
                <Link href={conversationHref(channel.id)} className="hidden min-h-11 items-center rounded-[5px] px-3 text-[13px] text-muted-foreground hover:text-foreground sm:inline-flex sm:min-h-[var(--ui-control-height)]">Preview</Link>
                <button type="button" onClick={() => void join(channel.id)} className="min-h-11 rounded-[5px] border border-border px-3 text-[13px] font-medium sm:min-h-[var(--ui-control-height)]">Join</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {channels.data && !visible.length ? <Empty>No channels match.</Empty> : null}
    </ViewScreen>
  );
}

const FILTERS: Array<{ id: InboxFilter | "threads"; label: string }> = [
  { id: "all", label: "All" },
  { id: "mentions", label: "Mentions" },
  { id: "threads", label: "Threads" },
  { id: "reactions", label: "Reactions" },
];

function InboxIcon({ kind }: { kind: InboxItem["kind"] }) {
  const Icon = kind === "thread_reply" ? MessageSquareText : kind === "reaction" ? SmilePlus : AtSign;
  return <Icon size={12} aria-hidden="true" className="flex-none" />;
}

function describe(item: InboxItem) {
  if (item.kind === "reaction") return `reacted ${item.emoji} to your message`;
  if (item.kind === "thread_reply") return "replied in a thread";
  if (item.kind === "channel" || item.kind === "here") return `mentioned @${item.kind}`;
  return "mentioned you";
}

/** One Inbox row: who, what, where, when; unread ones are bold with a dot. */
function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: (item: InboxItem) => void }) {
  const href = item.thread_root_seq ? threadHref(item.channel_id, item.thread_root_seq) : conversationHref(item.channel_id, { m: item.seq });
  return (
    <Link href={href} onClick={() => onOpen(item)} className="flex min-h-16 gap-3 px-4 py-3 hover:bg-muted" data-unread={item.read ? undefined : "true"}>
      <UserAvatar identity={item.author} size={34} roundedClassName="rounded-[5px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px]">
          <InboxIcon kind={item.kind} />
          <span className={item.read ? "font-medium" : "font-semibold"}>{personName(item.author)}</span>
          <span className="min-w-0 truncate text-muted-foreground">{describe(item)} in {where(item)}</span>
          {item.project_title ? <span className="hidden flex-none rounded-[3px] bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">{item.project_title}</span> : null}
          <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(item.created_at)}</span>
        </span>
        <span className={`mt-0.5 line-clamp-2 block text-[15px] ${item.read ? "text-muted-foreground" : ""}`}>{tokensToPlainText(item.body) || "Attachment"}</span>
      </span>
      {!item.read ? <span className="mt-2 size-2 flex-none rounded-full bg-[var(--chat-accent)]" aria-label="Unread" /> : null}
    </Link>
  );
}

/** Consecutive items from one conversation collapse under "3 mentions in #design". */
function groupByConversation(items: InboxItem[]) {
  const groups: InboxItem[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0]!.channel_id === item.channel_id) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

function InboxGroup({ items, onOpen }: { items: InboxItem[]; onOpen: (item: InboxItem) => void }) {
  const [open, setOpen] = useState(items.some((item) => !item.read));
  if (items.length === 1) return <li className="border-b border-border"><InboxRow item={items[0]!} onOpen={onOpen} /></li>;
  const unread = items.filter((item) => !item.read).length;
  const kinds = new Set(items.map((item) => item.kind));
  const noun = kinds.size === 1 && kinds.has("reaction") ? "reactions" : kinds.size === 1 && kinds.has("thread_reply") ? "replies" : "mentions";
  return (
    <li className="border-b border-border">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-[13px] hover:bg-muted">
        <ChevronDown size={14} aria-hidden="true" className={open ? "" : "-rotate-90"} />
        <span className={unread ? "font-semibold" : "font-medium"}>{items.length} {noun} in {where(items[0]!)}</span>
        {unread ? <span className="nb-chat-count">{unread}</span> : null}
        <span className="ml-auto font-mono text-[12px] text-muted-foreground">{when(items[0]!.created_at)}</span>
      </button>
      {open ? <ul className="border-l-2 border-border pl-2">{items.map((item) => <li key={`${item.seq}:${item.kind}:${item.emoji ?? ""}`}><InboxRow item={item} onOpen={onOpen} /></li>)}</ul> : null}
    </li>
  );
}

function ThreadRow({ thread }: { thread: ThreadItem }) {
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const label = thread.channel_name ? `#${thread.channel_name}` : thread.channel_title ?? "Direct message";
  return (
    <li className="border-b border-border">
      <div className="flex gap-3 px-4 py-3 hover:bg-muted/60" data-unread={thread.unread ? "true" : undefined}>
        <UserAvatar identity={thread.author} size={34} roundedClassName="rounded-[5px]" />
        <Link href={threadHref(thread.channel_id, thread.root_seq)} className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px]">
            <MessageSquareText size={12} aria-hidden="true" />
            <span className={thread.unread ? "font-semibold" : "font-medium"}>{label}</span>
            {thread.project_title ? <span className="hidden rounded-[3px] bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">{thread.project_title}</span> : null}
            <span className="text-muted-foreground">{thread.reply_count} {thread.reply_count === 1 ? "reply" : "replies"}</span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground">{when(thread.last_reply_at)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[15px]">{tokensToPlainText(thread.body) || "Attachment"}</span>
          {thread.participants?.length ? (
            <span className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className="inline-flex -space-x-1">{thread.participants.slice(0, 4).map((p: ChatPerson) => <span key={p.id} className="inline-block rounded-[3px] ring-2 ring-card"><UserAvatar identity={p} size={16} roundedClassName="rounded-[3px]" /></span>)}</span>
              {thread.participants.map((p) => personName(p).split(" ")[0]).slice(0, 3).join(", ")}
            </span>
          ) : null}
        </Link>
        <div className="flex flex-none flex-col items-end gap-2">
          {thread.unread ? <span className="mt-1 size-2 rounded-full bg-[var(--chat-accent)]" aria-label="Unread" /> : <span className="mt-1 size-2" />}
          <button type="button" onClick={() => setReplying(!replying)} aria-expanded={replying} className="rounded-[5px] border border-border px-2 py-0.5 text-[12px] font-medium hover:bg-card pointer-coarse:min-h-11 pointer-coarse:px-3">Reply</button>
        </div>
      </div>
      {replying ? (
        <Composer
          channelId={thread.channel_id}
          threadRootSeq={thread.root_seq}
          placeholder={`Reply in ${label}…`}
          people={[]}
          allowBroadcast={false}
          canCreateTask={false}
          onSent={() => {
            setReplying(false);
            toast.success("Reply sent");
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
          }}
        />
      ) : null}
    </li>
  );
}

/** The Inbox: mentions, thread replies and reactions in one place, with read state (report 7.8). */
export function InboxView() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const shell = useChatShell();
  const raw = params?.get("filter");
  const filter = FILTERS.some((f) => f.id === raw) ? (raw as InboxFilter | "threads") : "all";
  const feed = useInfiniteQuery({
    queryKey: queryKeys.chat.inbox(filter),
    enabled: filter !== "threads",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listInbox({ filter: filter as InboxFilter, before: pageParam });
      return result.success ? result.items : [];
    },
    getNextPageParam: (page) => (page.length === 50 ? page.at(-1)?.created_at : undefined),
  });
  const threads = useQuery({
    queryKey: queryKeys.chat.threads(),
    enabled: filter === "threads",
    queryFn: async () => {
      const result = await listThreads();
      return result.success ? result.threads : [];
    },
  });
  const items = feed.data?.pages.flat() ?? [];
  const groups = groupByConversation(items);
  const unread = shell.data?.inbox_unread ?? 0;

  const refreshInbox = () => {
    void queryClient.invalidateQueries({ queryKey: ["chat-v3", "inbox"] });
    shell.refresh();
  };
  const open = (item: InboxItem) => {
    if (item.read || item.kind === "reaction") return;
    void markInboxRead({ items: [{ channelId: item.channel_id, seq: item.seq }] }).then(refreshInbox);
  };
  const markAll = async () => {
    const result = await markInboxRead({ all: true });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshInbox();
    toast.success("Inbox marked as read");
  };

  return (
    <ViewScreen
      title="Inbox"
      action={unread && filter !== "threads" && filter !== "reactions" ? (
        <button type="button" onClick={() => void markAll()} className="inline-flex min-h-11 items-center gap-1.5 rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted sm:min-h-[var(--ui-control-height)]">
          <CheckCheck size={14} /> Mark all read
        </button>
      ) : null}
    >
      <div className="flex flex-none gap-1 overflow-x-auto border-b border-border px-3 py-2" role="tablist" aria-label="Inbox filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => router.replace(f.id === "all" ? "/messages/inbox" : `/messages/inbox?filter=${f.id}`)}
            className={`h-8 flex-none rounded-full px-3 text-[13px] font-medium pointer-coarse:h-11 ${filter === f.id ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}{f.id === "all" && unread ? ` · ${unread}` : ""}
          </button>
        ))}
      </div>
      {filter === "threads" ? (
        <>
          {threads.isLoading ? <Empty>Loading threads…</Empty> : null}
          {threads.data && !threads.data.length ? <Empty>Threads you start, reply to or follow show up here.</Empty> : null}
          <ul aria-label="Threads">{(threads.data ?? []).map((t) => <ThreadRow key={`${t.channel_id}:${t.root_seq}`} thread={t} />)}</ul>
        </>
      ) : (
        <>
          {feed.isLoading ? <Empty>Loading…</Empty> : null}
          {feed.data && !items.length ? (
            <Empty>{filter === "reactions" ? "Reactions to your messages show up here." : "Mentions and replies to your threads show up here."}</Empty>
          ) : null}
          <ul aria-label="Inbox">{groups.map((group) => <InboxGroup key={`${group[0]!.channel_id}:${group[0]!.seq}:${group[0]!.kind}`} items={group} onOpen={open} />)}</ul>
          <LoadMore hasMore={Boolean(feed.hasNextPage)} loading={feed.isFetchingNextPage} onLoad={() => void feed.fetchNextPage()} />
        </>
      )}
    </ViewScreen>
  );
}

const REMIND_OPTIONS = [
  { label: "In 1 hour", at: () => new Date(Date.now() + 60 * 60_000) },
  { label: "In 3 hours", at: () => new Date(Date.now() + 3 * 60 * 60_000) },
  { label: "Tomorrow at 9:00", at: () => { const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(9, 0, 0, 0); return at; } },
];

/** Saved for later, with reminders; due ones first. */
export function SavedView() {
  const queryClient = useQueryClient();
  const [now] = useState(() => Date.now());
  const saved = useQuery({
    queryKey: queryKeys.chat.saved(),
    queryFn: async () => {
      const result = await listSaved();
      return result.success ? result.items : [];
    },
  });
  const act = async (item: SavedItem, on: boolean, remindAt: Date | null = null) => {
    const result = await saveMessage({ channelId: item.channel_id, seq: item.seq, on, remindAt: remindAt?.toISOString() ?? null });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.saved() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.savedSeqs(item.channel_id) });
    toast(on ? `Reminder set for ${remindAt?.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Marked done", on ? undefined : {
      action: { label: "Undo", onClick: () => void act(item, true) },
    });
  };
  return (
    <ViewScreen title="Saved">
      {saved.isLoading ? <Empty>Loading…</Empty> : null}
      {saved.data && !saved.data.length ? <Empty>Save messages to come back to them: hover a message and choose Save for later (or press S).</Empty> : null}
      <ul aria-label="Saved messages">
        {(saved.data ?? []).map((item) => {
          const due = item.remind_at && !item.reminded_at && Date.parse(item.remind_at) <= now + 60_000;
          const href = item.thread_root_seq ? threadHref(item.channel_id, item.thread_root_seq) : conversationHref(item.channel_id, { m: item.seq });
          return (
            <li key={`${item.channel_id}:${item.seq}`} className="flex gap-3 border-b border-border px-4 py-3">
              <UserAvatar identity={item.author} size={34} roundedClassName="rounded-[5px]" />
              <Link href={href} className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-medium">{personName(item.author)}</span>
                  <span className="truncate text-muted-foreground">in {where(item)}</span>
                  <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(item.created_at)}</span>
                </span>
                <span className="mt-0.5 line-clamp-3 block text-[15px]">{tokensToPlainText(item.body) || "Attachment"}</span>
                {item.remind_at ? (
                  <span className={`mt-1 inline-flex items-center gap-1 text-[12px] ${due || item.reminded_at ? "font-medium text-[var(--status-warning)]" : "text-muted-foreground"}`}>
                    <AlarmClock size={12} aria-hidden="true" />
                    {item.reminded_at ? "Reminded" : due ? "Due now" : "Reminder"} · {new Date(item.remind_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                  </span>
                ) : null}
              </Link>
              <div className="flex flex-none items-start gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label="Remind me" title="Remind me">
                    <AlarmClock size={15} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {REMIND_OPTIONS.map((option) => <DropdownMenuItem key={option.label} onSelect={() => void act(item, true, option.at())}>{option.label}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button type="button" onClick={() => void act(item, false)} className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label="Mark done" title="Done (remove from Saved)">
                  <CheckCheck size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </ViewScreen>
  );
}

/** Unsent drafts on this device and messages scheduled to send later. */
export function DraftsView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const drafts = useDrafts();
  const { data } = useChatShell();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const scheduled = useQuery({
    queryKey: queryKeys.chat.scheduled(),
    queryFn: async () => {
      const result = await listScheduled();
      return result.success ? result.items : [];
    },
  });
  const titleOf = (channelId: string) => {
    const channel = data?.channels.find((c) => c.id === channelId);
    if (!channel) return "a conversation";
    const title = channelTitle(channel, meId);
    return isDirectLike(channel) ? title : `#${title}`;
  };
  const cancel = async (id: string, keepAsDraft?: { channelId: string; threadRootSeq: number | null; body: string }) => {
    const result = await cancelScheduled({ id });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.scheduled() });
    if (keepAsDraft) {
      writeDraft(keepAsDraft.threadRootSeq ? `${keepAsDraft.channelId}:${keepAsDraft.threadRootSeq}` : keepAsDraft.channelId, keepAsDraft.body);
      router.push(keepAsDraft.threadRootSeq ? threadHref(keepAsDraft.channelId, keepAsDraft.threadRootSeq) : conversationHref(keepAsDraft.channelId));
    } else toast("Scheduled message cancelled");
  };
  return (
    <ViewScreen title="Drafts & scheduled">
      <section aria-labelledby="scheduled-heading">
        <h2 id="scheduled-heading" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] font-semibold text-muted-foreground"><Clock size={13} aria-hidden="true" /> Scheduled</h2>
        {scheduled.data && !scheduled.data.length ? <p className="border-b border-border px-4 py-4 text-[13px] text-muted-foreground">Nothing scheduled. Use the arrow next to Send to send a message later.</p> : null}
        <ul>
          {(scheduled.data ?? []).map((item) => (
            <li key={item.id} className="flex gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-medium">To {item.channel_name ? `#${item.channel_name}` : titleOf(item.channel_id)}</span>
                  <span className={item.failed_reason ? "text-destructive" : "text-muted-foreground"}>
                    {item.failed_reason ? `Couldn't send: ${chatErrorMessage(item.failed_reason)}` : new Date(item.send_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[15px]">{tokensToPlainText(item.body)}</p>
              </div>
              <div className="flex flex-none items-start gap-1">
                <button type="button" onClick={() => void cancel(item.id, { channelId: item.channel_id, threadRootSeq: item.thread_root_seq, body: item.body })} className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Edit (move back to drafts)" title="Edit"><Pencil size={15} /></button>
                <button type="button" onClick={() => void cancel(item.id)} className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Cancel scheduled message" title="Cancel"><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] font-semibold text-muted-foreground"><Pencil size={13} aria-hidden="true" /> Drafts on this device</h2>
        {!drafts.length ? <p className="px-4 py-4 text-[13px] text-muted-foreground">No drafts. Anything you start typing and leave is kept here.</p> : null}
        <ul>
          {drafts.map((draft) => (
            <li key={draft.key} className="flex gap-3 border-b border-border px-4 py-3">
              <Link href={draft.threadRootSeq ? threadHref(draft.channelId, draft.threadRootSeq) : conversationHref(draft.channelId)} className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{draft.threadRootSeq ? "Thread in " : ""}{titleOf(draft.channelId)}</p>
                <p className="mt-0.5 line-clamp-2 text-[15px] text-muted-foreground">{tokensToPlainText(draft.body)}</p>
              </Link>
              <button type="button" onClick={() => writeDraft(draft.key, "")} className="grid size-8 flex-none place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Discard draft" title="Discard"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      </section>
    </ViewScreen>
  );
}

/** Highlight the searched words in a hit. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const words = query.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter((w) => w.length > 1);
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(pattern).map((part, i) => (i % 2 ? <mark key={i} className="rounded-[2px] bg-[var(--status-warning-soft)] px-0.5 text-foreground">{part}</mark> : part))}</>;
}

/** Message search: words plus in:, from:, has:file and a date range (report L-4, now built). */
export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const { data } = useChatShell();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const q = params?.get("q") ?? "";
  const inChannel = params?.get("in") ?? "";
  const from = params?.get("from") ?? "";
  const hasFile = params?.get("has") === "file";
  const after = params?.get("after") ?? "";
  const before = params?.get("before") ?? "";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`/messages/search?${next.toString()}`);
  };
  const conversations = useMemo(() => (data?.channels ?? []).filter((c) => !c.archived_at).map((c) => ({ id: c.id, title: isDirectLike(c) ? channelTitle(c, meId) : `#${channelTitle(c, meId)}` })).sort((a, b) => a.title.localeCompare(b.title)), [data?.channels, meId]);
  const people = useMemo(() => {
    const map = new Map<string, ChatPerson>();
    for (const c of data?.channels ?? []) {
      if (c.dm_user) map.set(c.dm_user.id, c.dm_user);
      for (const p of c.members_preview ?? []) map.set(p.id, p);
    }
    return [...map.values()].sort((a, b) => personName(a).localeCompare(personName(b)));
  }, [data?.channels]);

  const active = q.trim().length >= 2 || Boolean(from) || hasFile;
  const results = useQuery({
    queryKey: queryKeys.chat.search(params?.toString() ?? ""),
    enabled: active,
    queryFn: async () => {
      const result = await searchMessages({
        query: q,
        channelId: inChannel || null,
        authorId: from || null,
        hasFile,
        after: after || null,
        before: before ? new Date(Date.parse(before) + 86_400_000).toISOString() : null,
      });
      if (!result.success) throw new Error(result.error);
      return result.hits;
    },
    staleTime: 30_000,
  });
  const select = "h-8 rounded-[5px] border border-input bg-card px-2 text-[13px]";
  return (
    <ViewScreen title="Search">
      <form
        className="space-y-2 border-b border-border p-3 sm:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft.trim() || null });
        }}
      >
        <label className="flex items-center gap-2 rounded-[5px] border border-input bg-card px-3 focus-within:ring-1 focus-within:ring-ring">
          <Search size={15} aria-hidden="true" className="text-muted-foreground" />
          <span className="sr-only">Search messages</span>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search messages" className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
          <button type="submit" className="text-[13px] font-medium text-primary">Search</button>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="In" value={inChannel} onChange={(e) => set({ in: e.target.value || null })} className={select}>
            <option value="">In: everywhere</option>
            {conversations.map((c) => <option key={c.id} value={c.id}>In: {c.title}</option>)}
          </select>
          <select aria-label="From" value={from} onChange={(e) => set({ from: e.target.value || null })} className={select}>
            <option value="">From: anyone</option>
            {meId ? <option value={meId}>From: me</option> : null}
            {people.filter((p) => p.id !== meId).map((p) => <option key={p.id} value={p.id}>From: {personName(p)}</option>)}
          </select>
          <button type="button" aria-pressed={hasFile} onClick={() => set({ has: hasFile ? null : "file" })} className={`inline-flex h-8 items-center gap-1.5 rounded-[5px] border px-2 text-[13px] ${hasFile ? "border-primary bg-accent text-accent-foreground" : "border-input text-muted-foreground"}`}>
            <Paperclip size={13} /> Has file
          </button>
          <label className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">After <input type="date" value={after} onChange={(e) => set({ after: e.target.value || null })} className={select} /></label>
          <label className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">Before <input type="date" value={before} onChange={(e) => set({ before: e.target.value || null })} className={select} /></label>
        </div>
      </form>
      {!active ? <Empty>Search words in every conversation you&apos;re in. Narrow it down with In, From, Has file and dates.</Empty> : null}
      {results.isLoading ? <Empty>Searching…</Empty> : null}
      {results.isError ? <Empty>{chatErrorMessage(results.error.message)}</Empty> : null}
      {results.data && !results.data.length ? <Empty>No messages match.</Empty> : null}
      {results.data?.length ? <p className="px-4 pt-3 text-[12px] text-muted-foreground">{results.data.length === 50 ? "Newest 50 results" : `${results.data.length} result${results.data.length === 1 ? "" : "s"}`}</p> : null}
      <ul aria-label="Search results">
        {(results.data ?? []).map((hit: SearchHit) => (
          <li key={`${hit.channel_id}:${hit.seq}`}>
            <Link href={hit.thread_root_seq ? `${threadHref(hit.channel_id, hit.thread_root_seq)}` : conversationHref(hit.channel_id, { m: hit.seq })} className="flex gap-3 border-b border-border px-4 py-3 hover:bg-muted">
              <UserAvatar identity={hit.author} size={30} roundedClassName="rounded-[5px]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-medium">{personName(hit.author)}</span>
                  <span className="truncate text-muted-foreground">in {hit.channel_name ? `#${hit.channel_name}` : conversations.find((c) => c.id === hit.channel_id)?.title ?? "a conversation"}{hit.thread_root_seq ? " · thread" : ""}</span>
                  {hit.has_file ? <Paperclip size={12} aria-label="Has a file" className="text-muted-foreground" /> : null}
                  <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(hit.created_at)}</span>
                </span>
                <span className="mt-0.5 line-clamp-3 block text-[15px]"><Highlighted text={tokensToPlainText(hit.body)} query={q} /></span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </ViewScreen>
  );
}

/** Every DM and group chat with previews, a filter and Unread only (L-30: the sidebar shows the 8 most recent). */
export function DmList() {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const [filter, setFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const dms = useInfiniteQuery({
    queryKey: queryKeys.chat.dms(),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listDirectMessages({ before: pageParam });
      return result.success ? result.channels : [];
    },
    getNextPageParam: (page) => (page.length === 50 ? page.at(-1)?.last_message_at ?? undefined : undefined),
  });
  const channels = useMemo(() => (dms.data?.pages.flat() ?? [])
    .filter((c) => !c.archived_at)
    .filter((c) => !unreadOnly || needsAttention(c))
    .filter((c) => !filter || channelTitle(c, meId).toLowerCase().includes(filter.toLowerCase())), [dms.data, filter, meId, unreadOnly]);
  return (
    <ViewScreen title="Direct messages" action={<Link href="/messages/new" prefetch={true} className="inline-flex min-h-11 items-center rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground sm:min-h-[var(--ui-control-height)]">New message</Link>}>
      <div className="flex items-center gap-2 border-b border-border p-3 sm:px-4">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Find a conversation</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a conversation" className="h-[var(--ui-control-height)] w-full rounded-[5px] border border-input bg-card px-3 text-[15px] pointer-coarse:h-11" />
        </label>
        <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)} className={`inline-flex h-[var(--ui-control-height)] flex-none items-center gap-1.5 rounded-[5px] border px-3 text-[13px] pointer-coarse:h-11 ${unreadOnly ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}>
          <CheckCheck size={14} /> Unread
        </button>
      </div>
      {dms.isLoading ? <Empty>Loading…</Empty> : null}
      {dms.data && !channels.length ? <Empty>{filter || unreadOnly ? "No conversations match." : "No direct messages yet."}</Empty> : null}
      <ul aria-label="Direct messages">
        {channels.map((c) => {
          const count = rowCount(c);
          return (
            <li key={c.id}>
              <Link href={conversationHref(c.id)} className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-3 hover:bg-muted" data-testid={`chat-row-${c.id}`}>
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
      <LoadMore hasMore={Boolean(dms.hasNextPage)} loading={dms.isFetchingNextPage} onLoad={() => void dms.fetchNextPage()} />
    </ViewScreen>
  );
}
