"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, AtSign, BellOff, CalendarClock, Check, CheckCheck, ChevronDown, Clock, Hash, ListFilter, MoreHorizontal, MessageSquareText, Paperclip, Pencil, Plus, Search, SmilePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { listInbox, listThreads, markInboxRead, markInboxUnread, type InboxFilter, type InboxItem, type ThreadItem } from "@/app/actions/chat/activity";
import { setThreadFollow } from "@/app/actions/chat/messages";
import { markThreadRead } from "@/app/actions/chat/read";
import { browseChannels, joinChannel } from "@/app/actions/chat/channels";
import { cancelScheduled, listSaved, listScheduled, rescheduleScheduled, saveMessage, sendScheduledNow, type SavedItem } from "@/app/actions/chat/later";
import { searchMessages, type SearchHit } from "@/app/actions/chat/search";
import { useChatUi, useDrafts, writeDraft, readDraft } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListOrHome } from "@/components/messages/HomePane";
import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TimePickerDialog } from "@/components/messages/parts/TimePickerDialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, isDirectLike, personName } from "@/lib/messaging/channel-view";
import { CHAT_LIST_PAGE } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { groupNoun } from "@/lib/messaging/inbox";
import { conversationHref, threadHref } from "@/lib/messaging/routes";
import { laterTimes } from "@/lib/messaging/reminders";
import { tokensToPlainText } from "@/lib/messaging/tokens";
import type { ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { useChannelMembers } from "@/components/messages/useConversation";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { useWindowNav } from "@/components/messages/window-nav";
import { rovingTabKey } from "@/components/messages/keys";

const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), { ssr: false });

const when = (value: string | null) => (value ? formatChatTime(value) : "");

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** An error is not an empty list: say so, with Retry (a failed later page retries that page). */
function ListError({ what, detail, query }: { what: string; detail?: string; query: { data?: unknown; refetch: () => unknown; fetchNextPage?: () => unknown } }) {
  return (
    <div role="alert" className="px-4 py-10 text-center text-[13px]">
      <p>{what} didn&apos;t load.</p>
      {detail ? <p className="mt-1 text-muted-foreground">{detail}</p> : null}
      <button type="button" onClick={() => void (query.data && query.fetchNextPage ? query.fetchNextPage() : query.refetch())} className="mt-2 rounded-[5px] border border-border px-3 py-1.5 font-medium hover:bg-muted">Retry</button>
    </div>
  );
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

/** "in #design · Acme": the project travels with the place, on every screen size. */
function Place({ item }: { item: { channel_name: string | null; channel_title?: string | null; channel_kind: string; project_title?: string | null } }) {
  return <>{where(item)}{item.project_title ? <span className="text-muted-foreground/80"> · {item.project_title}</span> : null}</>;
}

/** One row for Inbox, Threads, Saved and Search: avatar, who · where · when, then the message. */
function SnippetRow({ href, target, onOpen, author, head, time, body, dim, unread, extra, aside }: {
  href: string; target?: { channelId: string; rootSeq: number | null; m?: number | null }; onOpen?: () => void; author: ChatPerson | null; head: React.ReactNode; time: string | null; body: React.ReactNode;
  dim?: boolean; unread?: boolean; extra?: React.ReactNode; aside?: React.ReactNode;
}) {
  const win = useWindowNav();
  return (
    <div className="group/snippet flex gap-3 px-4 py-3 hover:bg-muted/60" data-unread={unread ? "true" : undefined}>
      <UserAvatar identity={author} size={34} roundedClassName="rounded-[5px]" />
      <Link
        href={href}
        onClick={(event) => {
          onOpen?.();
          // In the window, open it there, at the message itself.
          if (win && target && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            win.open(target.channelId, target.rootSeq, target.m ?? null);
          }
        }}
        className="min-w-0 flex-1"
      >
        <span className="flex items-center gap-1.5 text-[13px]">
          {head}
          <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(time)}</span>
        </span>
        <span className={`mt-0.5 line-clamp-2 block text-[15px] ${dim ? "text-muted-foreground" : ""}`}>{body}</span>
        {extra}
      </Link>
      {aside}
    </div>
  );
}

/** Reply in place (Inbox rows): focused when it opens, Esc closes it, and the toast links to the thread. */
function InlineReply({ channelId, rootSeq, label, onDone }: { channelId: string; rootSeq: number; label: string; onDone: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // @mentions in the reply need the conversation's people.
  const members = useChannelMembers(channelId, true);
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <Composer
        channelId={channelId}
        threadRootSeq={rootSeq}
        placeholder={`Reply in ${label}…`}
        people={members.data ?? []}
        allowBroadcast={false}
        canCreateTask={false}
        autoFocus
        onSent={() => {
          onDone();
          toast.success("Reply sent", { action: { label: "View thread", onClick: () => router.push(threadHref(channelId, rootSeq)) } });
          void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
        }}
      />
    </div>
  );
}

/** /messages/p/[projectId]: select the project; displays channels in sidebar while main pane shows placeholder. */
export function ProjectLanding({ projectId }: { projectId: string }) {
  const setProject = useChatUi((state) => state.setProject);
  const { data } = useChatShell();
  const router = useRouter();
  // A project you left (old link, Back): go to All instead of keeping a stale pick.
  const known = !data?.projects || data.projects.some((p) => p.id === projectId);
  useEffect(() => {
    if (known) setProject(projectId);
    else router.replace("/messages");
  }, [known, projectId, router, setProject]);
  return <ListOrHome />;
}

type BrowseSort = "name" | "members";
type BrowseShow = "all" | "joined" | "open" | "archived";
const FILTER_CONTROL = "h-[var(--ui-control-height)] rounded-[5px] border border-input bg-card px-2 text-[13px] pointer-coarse:h-11";

/** Public channels in a project: filter, sort, join (D5). Private channels are never listed. */
export function BrowseChannels({ projectId }: { projectId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, refresh } = useChatShell();
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<BrowseSort>("name");
  const [show, setShow] = useState<BrowseShow>("all");
  const [joining, setJoining] = useState<string | null>(null);
  const channels = useQuery({
    queryKey: queryKeys.chat.browse(projectId),
    queryFn: async () => {
      const result = await browseChannels({ projectId });
      if (!result.success) throw new Error(result.error);
      return result.channels;
    },
  });
  const title = data?.projects?.find((p) => p.id === projectId)?.title;
  // "#gen" finds #general: channel names have no "#".
  const needle = filter.trim().toLowerCase().replace(/^#/, "");
  const visible = (channels.data ?? [])
    // Archived channels only under Archived (where admins find one to unarchive).
    .filter((c) => (show === "archived" ? c.archived : !c.archived))
    .filter((c) => !needle || c.name.includes(needle) || (c.description ?? "").toLowerCase().includes(needle))
    .filter((c) => show === "all" || show === "archived" || (show === "joined" ? c.joined : !c.joined))
    .sort((a, b) => (sort === "members" ? b.member_count - a.member_count : 0) || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  const join = async (channelId: string) => {
    if (joining) return;
    setJoining(channelId);
    const result = await joinChannel({ channelId }).finally(() => setJoining(null));
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refresh();
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.browse(projectId) });
    router.push(conversationHref(channelId));
  };
  const nothingYet = channels.data && !channels.data.some((c) => !c.archived) && show !== "archived" && !needle;
  return (
    <ViewScreen closable
      back={`/messages/p/${projectId}`}
      title={title ? `Browse channels in ${title}` : "Browse channels"}
      action={<button type="button" onClick={() => setCreateFor(projectId)} className="inline-flex min-h-11 items-center gap-1 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground sm:min-h-[var(--ui-control-height)]"><Plus size={14} /> Create channel</button>}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-4">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Filter channels</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels" className="h-[var(--ui-control-height)] w-full max-w-md rounded-[5px] border border-input bg-card px-3 text-[15px] pointer-coarse:h-11 pointer-coarse:text-[17px]" />
        </label>
        <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as BrowseShow)} className={FILTER_CONTROL}>
          <option value="all">All channels</option>
          <option value="joined">Joined</option>
          <option value="open">Not joined</option>
          <option value="archived">Archived</option>
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as BrowseSort)} className={FILTER_CONTROL}>
          <option value="name">Sort: Name</option>
          <option value="members">Sort: Most members</option>
        </select>
      </div>
      <p className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">Private channels aren&apos;t listed. Ask a member to add you.</p>
      {channels.isLoading ? <ListSkeleton header={false} label="Loading channels" rows={4} /> : null}
      {channels.isError ? <ListError what="Channels" detail={chatErrorMessage(channels.error.message)} query={channels} /> : null}
      <ul aria-label="Channels">
        {visible.map((channel) => (
          <li key={channel.id} className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-2">
            <Hash size={16} aria-hidden="true" className="flex-none text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <Link href={conversationHref(channel.id)} className="block truncate text-[15px] font-medium hover:underline">{channel.name}</Link>
              <p className="truncate text-[13px] text-muted-foreground">{channel.description || channel.topic || "No description"} · <span className="font-mono text-[12px]">{channel.member_count} members</span></p>
            </div>
            {channel.archived ? (
              <Link href={conversationHref(channel.id)} className="inline-flex min-h-11 items-center rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted sm:min-h-[var(--ui-control-height)]">View</Link>
            ) : channel.joined ? (
              <>
                <span className="flex-none rounded-[3px] bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Joined</span>
                <Link href={conversationHref(channel.id)} className="inline-flex min-h-11 items-center rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted sm:min-h-[var(--ui-control-height)]">Open</Link>
              </>
            ) : (
              <>
                <Link href={conversationHref(channel.id)} className="inline-flex min-h-11 items-center rounded-[5px] px-3 text-[13px] text-muted-foreground hover:text-foreground sm:min-h-[var(--ui-control-height)]">Preview</Link>
                <button type="button" onClick={() => void join(channel.id)} disabled={joining !== null} aria-busy={joining === channel.id} className="min-h-11 rounded-[5px] border border-border px-3 text-[13px] font-medium disabled:opacity-60 sm:min-h-[var(--ui-control-height)]">{joining === channel.id ? "Joining…" : "Join"}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {nothingYet ? (
        <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
          <p>No public channels yet.</p>
          <button type="button" onClick={() => setCreateFor(projectId)} className="mt-2 font-medium text-primary hover:underline">Create channel</button>
        </div>
      ) : channels.data && !visible.length ? <Empty>{show === "archived" ? "No archived channels." : "No channels match."}</Empty> : null}
    </ViewScreen>
  );
}

const FILTERS: Array<{ id: InboxFilter | "threads"; label: string }> = [
  { id: "all", label: "All" },
  { id: "mentions", label: "Mentions" },
  { id: "threads", label: "Threads" },
  { id: "reactions", label: "Reactions" },
];

/** Each tab says what belongs there (#132). */
const EMPTY_TEXT: Record<InboxFilter, string> = {
  all: "Mentions, thread replies and reactions show up here.",
  mentions: "When someone @mentions you, it shows up here.",
  reactions: "Reactions to your messages show up here.",
};

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

const ROW_BUTTON = "rounded-[5px] px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-card hover:text-foreground pointer-coarse:min-h-11";

/** One Inbox row: who, what, where, when; unread ones are bold with a dot. Mentions and replies can be answered in place. */
function InboxRow({ item, onOpen, onToggleRead }: { item: InboxItem; onOpen: (item: InboxItem) => void; onToggleRead: (item: InboxItem) => void }) {
  const href = item.thread_root_seq ? threadHref(item.channel_id, item.thread_root_seq) : conversationHref(item.channel_id, { m: item.seq });
  const [replying, setReplying] = useState(false);
  const reaction = item.kind === "reaction";
  const text = tokensToPlainText(item.body) || "Attachment";
  return (
    <>
      <SnippetRow
        href={href}
        target={{ channelId: item.channel_id, rootSeq: item.thread_root_seq, m: item.seq }}
        onOpen={() => onOpen(item)}
        author={item.author}
        unread={!item.read}
        dim={item.read || reaction}
        time={item.created_at}
        // A reaction row shows your own message next to the reactor: say so.
        body={reaction ? <>You: {text}</> : text}
        head={<>
          <InboxIcon kind={item.kind} />
          <span className={item.read ? "font-medium" : "font-semibold"}>{personName(item.author)}</span>
          <span className="min-w-0 truncate text-muted-foreground">{describe(item)} in <Place item={item} /></span>
        </>}
        aside={
          <div className="flex flex-none flex-col items-end gap-1.5">
            {!item.read ? <span className="mt-2 size-2 rounded-full bg-[var(--chat-accent)]" role="img" aria-label="Unread" /> : <span className="mt-2 size-2" />}
            {!reaction ? (
              <span className="flex gap-1">
                <button type="button" onClick={() => setReplying(!replying)} aria-expanded={replying} className={`${ROW_BUTTON} font-medium`}>Reply</button>
                {/* "Mark unread" on read rows only on hover or focus (always on touch); "Mark as read" always. */}
                <button type="button" onClick={() => onToggleRead(item)} className={`${ROW_BUTTON} ${item.read ? "pointer-fine:opacity-0 pointer-fine:group-hover/inbox:opacity-100 focus-visible:opacity-100" : ""}`}>
                  {item.read ? "Mark unread" : "Mark as read"}
                </button>
              </span>
            ) : null}
          </div>
        }
      />
      {replying ? <InlineReply channelId={item.channel_id} rootSeq={item.thread_root_seq ?? item.seq} label={where(item)} onDone={() => setReplying(false)} /> : null}
    </>
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

function InboxGroup({ items, onOpen, onToggleRead, onMarkRead }: { items: InboxItem[]; onOpen: (item: InboxItem) => void; onToggleRead: (item: InboxItem) => void; onMarkRead: (items: InboxItem[]) => void }) {
  const [open, setOpen] = useState(items.some((item) => !item.read));
  if (items.length === 1) return <li className="group/inbox border-b border-border"><InboxRow item={items[0]!} onOpen={onOpen} onToggleRead={onToggleRead} /></li>;
  const unreadItems = items.filter((item) => !item.read && item.kind !== "reaction");
  const unread = items.filter((item) => !item.read).length;
  const noun = groupNoun(items.map((item) => item.kind));
  return (
    <li className="border-b border-border">
      <div className="flex min-h-11 items-center gap-2 px-4 hover:bg-muted">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-[13px]">
          <ChevronDown size={14} aria-hidden="true" className={open ? "" : "-rotate-90"} />
          <span className={`min-w-0 truncate ${unread ? "font-semibold" : "font-medium"}`}>{items.length} {noun} in <Place item={items[0]!} /></span>
          {unread ? <span className="nb-chat-count">{unread}<span className="sr-only"> unread</span></span> : null}
          <span className="ml-auto flex-none font-mono text-[12px] text-muted-foreground">{when(items[0]!.created_at)}</span>
        </button>
        {unreadItems.length ? <button type="button" onClick={() => onMarkRead(unreadItems)} className={ROW_BUTTON}>Mark as read</button> : null}
      </div>
      {open ? <ul className="border-l-2 border-border pl-2">{items.map((item) => <li key={`${item.seq}:${item.kind}:${item.emoji ?? ""}`} className="group/inbox"><InboxRow item={item} onOpen={onOpen} onToggleRead={onToggleRead} /></li>)}</ul> : null}
    </li>
  );
}

function ThreadRow({ thread }: { thread: ThreadItem }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
  const markRead = async () => {
    if (!thread.last_reply_seq) return;
    const result = await markThreadRead({ channelId: thread.channel_id, rootSeq: thread.root_seq, seq: thread.last_reply_seq });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refresh();
  };
  const unfollow = async () => {
    const result = await setThreadFollow({ channelId: thread.channel_id, rootSeq: thread.root_seq, on: false });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refresh();
    toast("Unfollowed", { action: { label: "Undo", onClick: () => void setThreadFollow({ channelId: thread.channel_id, rootSeq: thread.root_seq, on: true }).then(refresh) } });
  };
  const [replying, setReplying] = useState(false);
  const label = where(thread);
  const shown = (thread.participants ?? []).slice(0, 3);
  const more = Math.max(0, (thread.participant_count ?? shown.length) - shown.length);
  return (
    <li className="border-b border-border">
      <SnippetRow
        href={threadHref(thread.channel_id, thread.root_seq)}
        target={{ channelId: thread.channel_id, rootSeq: thread.root_seq }}
        author={thread.author}
        unread={thread.unread}
        time={thread.last_reply_at}
        body={tokensToPlainText(thread.body) || "Attachment"}
        // Who started it and where; the time is the latest reply's.
        head={<>
          <MessageSquareText size={12} aria-hidden="true" className="flex-none" />
          <span className={`flex-none ${thread.unread ? "font-semibold" : "font-medium"}`}>{personName(thread.author)}</span>
          <span className="min-w-0 truncate text-muted-foreground">in <Place item={thread} /> · {thread.reply_count} {thread.reply_count === 1 ? "reply" : "replies"}, latest</span>
        </>}
        extra={shown.length ? (
          <span className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="inline-flex -space-x-1">{shown.map((p: ChatPerson) => <span key={p.id} className="inline-block rounded-[3px] ring-2 ring-card"><UserAvatar identity={p} size={16} roundedClassName="rounded-[3px]" /></span>)}</span>
            {shown.map((p) => personName(p).split(" ")[0]).join(", ")}{more ? ` +${more}` : ""}
          </span>
        ) : null}
        aside={
          <div className="flex flex-none items-start gap-1">
            {thread.unread ? <span className="mt-2.5 size-2 rounded-full bg-[var(--chat-accent)]" role="img" aria-label="Unread" /> : null}
            <button type="button" onClick={() => setReplying(!replying)} aria-expanded={replying} className="rounded-[5px] border border-border px-2 py-0.5 text-[12px] font-medium hover:bg-card pointer-coarse:min-h-11 pointer-coarse:px-3">Reply</button>
            {/* Everything else in one menu, so a row stays one line tall on phones. */}
            <DropdownMenu>
              <DropdownMenuTrigger className="grid size-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label={`More for the thread in ${label}`}>
                <MoreHorizontal size={15} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {thread.unread ? <DropdownMenuItem onSelect={() => void markRead()}><Check size={14} /> Mark as read</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={() => void unfollow()}><BellOff size={14} /> Unfollow</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {replying ? <InlineReply channelId={thread.channel_id} rootSeq={thread.root_seq} label={label} onDone={() => setReplying(false)} /> : null}
    </li>
  );
}

/** A failed next page: say so where it happened (the bottom), not as if the whole list failed. */
function MoreError({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="alert" className="flex items-center justify-center gap-2 p-4 text-[13px] text-muted-foreground">
      Couldn&apos;t load more. <button type="button" onClick={onRetry} className="font-medium text-primary hover:underline">Retry</button>
    </p>
  );
}

/** The Inbox: mentions, thread replies and reactions in one place, with read state (report 7.8). */
export function InboxView() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const shell = useChatShell();
  const win = useWindowNav();
  // The window keeps its tab in memory; the page keeps it in the URL.
  const [windowFilter, setWindowFilter] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const raw = win ? windowFilter : params?.get("filter");
  const filter = FILTERS.some((f) => f.id === raw) ? (raw as InboxFilter | "threads") : "all";
  const feed = useInfiniteQuery({
    queryKey: queryKeys.chat.inbox(filter),
    enabled: filter !== "threads",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listInbox({ filter: filter as InboxFilter, before: pageParam });
      if (!result.success) throw new Error(result.error);
      return result.items;
    },
    getNextPageParam: (page) => (page.length === CHAT_LIST_PAGE ? page.at(-1)?.created_at : undefined),
  });
  const threadPages = useInfiniteQuery({
    queryKey: queryKeys.chat.threads(),
    enabled: filter === "threads",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listThreads({ before: pageParam });
      if (!result.success) throw new Error(result.error);
      return result.threads;
    },
    getNextPageParam: (page) => (page.length === CHAT_LIST_PAGE ? page.at(-1)?.last_reply_at ?? undefined : undefined),
  });
  const allThreads = threadPages.data?.pages.flat();
  const threads = (allThreads ?? []).filter((t) => !unreadOnly || t.unread);
  const items = (feed.data?.pages.flat() ?? []).filter((item) => !unreadOnly || !item.read);
  const groups = groupByConversation(items);
  // Every tab has its count: the badge (All), mentions alone, followed threads with new replies.
  const counts: Record<"all" | "mentions" | "threads" | "reactions", number> = {
    all: shell.data?.inbox_unread ?? 0,
    mentions: shell.data?.inbox_mentions ?? 0,
    threads: shell.data?.threads_unread ?? 0,
    reactions: 0,
  };

  // The server publishes membership.changed, which refreshes the shell (badge) once; only the lists reload here.
  const refreshInbox = () => {
    void queryClient.invalidateQueries({ queryKey: ["chat-v3", "inbox"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
  };
  const open = (item: InboxItem) => {
    if (item.read || item.kind === "reaction") return;
    void markInboxRead({ items: [{ channelId: item.channel_id, seq: item.seq }] }).then(refreshInbox);
  };
  const toggleRead = async (item: InboxItem) => {
    const result = item.read
      ? await markInboxUnread({ channelId: item.channel_id, seq: item.seq })
      : await markInboxRead({ items: [{ channelId: item.channel_id, seq: item.seq }] });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshInbox();
  };
  const markGroupRead = async (list: InboxItem[]) => {
    const result = await markInboxRead({ items: list.map((item) => ({ channelId: item.channel_id, seq: item.seq })) });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshInbox();
  };
  const selectFilter = (id: string) => {
    if (win) setWindowFilter(id);
    else router.replace(id === "all" ? "/messages/inbox" : `/messages/inbox?filter=${id}`);
  };
  // Tabs: ←/→/Home/End move between them (roving tabindex), like any tablist.
  const tabKeys = (event: React.KeyboardEvent, index: number) => {
    const next = rovingTabKey(event, index, FILTERS.length);
    if (next === null) return;
    const target = FILTERS[next]!;
    selectFilter(target.id);
    document.getElementById(`inbox-tab-${target.id}`)?.focus();
  };
  const scope = filter === "mentions" ? "mentions" : filter === "threads" ? "threads" : "all";
  // Each button says what it clears.
  const markLabel = scope === "threads" ? "Mark threads read" : scope === "mentions" ? "Mark mentions read" : "Mark Inbox read";
  const markAllRead = useMarkAllRead();
  const markAll = async () => {
    const result = await markInboxRead({ all: true, scope });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshInbox();
    toast.success(scope === "threads" ? "Threads marked as read" : scope === "mentions" ? "Mentions marked as read" : "Inbox marked as read");
  };
  // What the button clears on this tab (Mentions excludes thread replies; inbox_unread counts both).
  const markable = filter === "threads" ? (allThreads ?? []).filter((t) => t.unread).length
    : filter === "mentions" ? counts.mentions
    : filter === "all" ? counts.all : 0;

  return (
    <ViewScreen
      title="Inbox"
      action={markable > 0 ? (
        <button type="button" onClick={() => markAllRead.request(markable, markAll, filter === "threads" ? "thread" : "item", markLabel)} className="inline-flex min-h-11 items-center gap-1.5 rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted sm:min-h-[var(--ui-control-height)]">
          <CheckCheck size={14} /> {markLabel}
        </button>
      ) : null}
    >
      <div className="flex flex-none items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
        <div className="flex gap-1" role="tablist" aria-label="Inbox filters">
          {FILTERS.map((f, index) => (
            <button
              key={f.id}
              id={`inbox-tab-${f.id}`}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              aria-controls="inbox-panel"
              tabIndex={filter === f.id ? 0 : -1}
              onKeyDown={(event) => tabKeys(event, index)}
              onClick={() => selectFilter(f.id)}
              className={`h-8 flex-none rounded-full px-3 text-[13px] font-medium pointer-coarse:h-11 ${filter === f.id ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}{counts[f.id] ? <> · {counts[f.id]}<span className="sr-only"> unread</span></> : null}
            </button>
          ))}
        </div>
        {filter !== "reactions" ? (
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)} className={`ml-auto inline-flex h-8 flex-none items-center gap-1 rounded-full px-3 text-[13px] font-medium pointer-coarse:h-11 ${unreadOnly ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <ListFilter size={13} aria-hidden="true" /> Unread only
          </button>
        ) : null}
      </div>
      <div id="inbox-panel" role="tabpanel" aria-labelledby={`inbox-tab-${filter}`}>
      {filter === "threads" ? (
        <>
          {threadPages.isLoading ? <ListSkeleton header={false} label="Loading threads" rows={4} /> : null}
          {threadPages.isError && !allThreads ? <ListError what="Threads" query={threadPages} /> : null}
          {allThreads && !threads.length ? <Empty>{unreadOnly ? "No unread threads." : "Threads you start, reply to or follow show up here."}</Empty> : null}
          <ul aria-label="Threads">{threads.map((t) => <ThreadRow key={`${t.channel_id}:${t.root_seq}`} thread={t} />)}</ul>
          {threadPages.isError && allThreads ? <MoreError onRetry={() => void threadPages.fetchNextPage()} /> : null}
          <LoadMore hasMore={Boolean(threadPages.hasNextPage) && !threadPages.isError} loading={threadPages.isFetchingNextPage} onLoad={() => void threadPages.fetchNextPage()} />
        </>
      ) : (
        <>
          {feed.isLoading ? <ListSkeleton header={false} label="Loading your Inbox" rows={5} /> : null}
          {feed.isError && !feed.data ? <ListError what="Your Inbox" query={feed} /> : null}
          {feed.data && !items.length ? <Empty>{unreadOnly ? "Nothing unread here." : EMPTY_TEXT[filter]}</Empty> : null}
          {/* Keyed by conversation and oldest item: a new item at the top doesn't snap a group open or shut. */}
          <ul aria-label="Inbox">{groups.map((group) => <InboxGroup key={`${group[0]!.channel_id}:${group.at(-1)!.seq}:${group.at(-1)!.kind}`} items={group} onOpen={open} onToggleRead={(item) => void toggleRead(item)} onMarkRead={(list) => void markGroupRead(list)} />)}</ul>
          {feed.isError && feed.data ? <MoreError onRetry={() => void feed.fetchNextPage()} /> : null}
          <LoadMore hasMore={Boolean(feed.hasNextPage) && !feed.isError} loading={feed.isFetchingNextPage} onLoad={() => void feed.fetchNextPage()} />
        </>
      )}
      </div>
      {markAllRead.dialog}
    </ViewScreen>
  );
}

/** Saved messages, with reminders; due ones first. */
export function SavedView() {
  const queryClient = useQueryClient();
  // "Due now" must turn on while the page is open, not only at mount.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const savedPages = useInfiniteQuery({
    queryKey: queryKeys.chat.saved(),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const result = await listSaved({ offset: pageParam });
      if (!result.success) throw new Error(result.error);
      return result.items;
    },
    getNextPageParam: (page, pages) => (page.length === CHAT_LIST_PAGE ? pages.length * CHAT_LIST_PAGE : undefined),
  });
  const saved = savedPages.data?.pages.flat();
  const [customFor, setCustomFor] = useState<{ item: SavedItem; at: Date } | null>(null);
  const act = async (item: SavedItem, on: boolean, remindAt: Date | null = null, clearReminder = false) => {
    const result = await saveMessage({ channelId: item.channel_id, seq: item.seq, on, remindAt: remindAt?.toISOString() ?? null, clearReminder });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.saved() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.savedSeqs(item.channel_id) });
    const label = remindAt ? formatChatTime(remindAt, "at") : null;
    if (clearReminder) return void toast("Reminder cleared");
    toast(on ? (label ? `Reminder set for ${label}` : "Saved") : "Removed from Saved", on ? undefined : {
      // Undo puts it back as it was, reminder included.
      action: { label: "Undo", onClick: () => void act(item, true, item.remind_at && !item.reminded_at ? new Date(item.remind_at) : null) },
    });
  };
  return (
    <ViewScreen title="Saved">
      {savedPages.isLoading ? <ListSkeleton header={false} label="Loading saved messages" rows={4} /> : null}
      {savedPages.isError && !saved ? <ListError what="Saved messages" query={savedPages} /> : null}
      {saved && !saved.length ? <Empty>Save messages to come back to them: open a message&apos;s menu (long-press on a phone) and choose Save, or press S on a selected message.</Empty> : null}
      <ul aria-label="Saved messages">
        {(saved ?? []).map((item) => {
          const due = item.remind_at && !item.reminded_at && Date.parse(item.remind_at) <= now + 60_000;
          const href = item.thread_root_seq ? threadHref(item.channel_id, item.thread_root_seq) : conversationHref(item.channel_id, { m: item.seq });
          return (
            <li key={`${item.channel_id}:${item.seq}`} className="border-b border-border">
              <SnippetRow
                href={href}
                author={item.author}
                time={item.created_at}
                body={tokensToPlainText(item.body) || "Attachment"}
                head={<>
                  <span className="font-medium">{personName(item.author)}</span>
                  <span className="truncate text-muted-foreground">in <Place item={item} /></span>
                </>}
                extra={item.remind_at ? (
                  <span className={`mt-1 inline-flex items-center gap-1 text-[12px] ${due || item.reminded_at ? "font-medium text-[var(--status-warning)]" : "text-muted-foreground"}`}>
                    <AlarmClock size={12} aria-hidden="true" />
                    {item.reminded_at ? "Reminded" : due ? "Due now" : "Reminder"} · {formatChatTime(item.remind_at, "at")}
                  </span>
                ) : null}
                aside={
                  <div className="flex flex-none items-start gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label="Remind me" title="Remind me">
                        <AlarmClock size={15} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {laterTimes("remind").map((option) => <DropdownMenuItem key={option.label} onSelect={() => void act(item, true, option.at())}>{option.label}</DropdownMenuItem>)}
                        <DropdownMenuItem onSelect={() => setCustomFor({ item, at: new Date(Date.now() + 2 * 60 * 60_000) })}>Custom time…</DropdownMenuItem>
                        {item.remind_at ? <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void act(item, true, null, true)}>Clear reminder</DropdownMenuItem></> : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button type="button" onClick={() => void act(item, false)} className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label="Done (remove from Saved)" title="Done">
                      <Check size={15} />
                    </button>
                  </div>
                }
              />
            </li>
          );
        })}
      </ul>
      {savedPages.isError && saved ? <MoreError onRetry={() => void savedPages.fetchNextPage()} /> : null}
      <LoadMore hasMore={Boolean(savedPages.hasNextPage) && !savedPages.isError} loading={savedPages.isFetchingNextPage} onLoad={() => void savedPages.fetchNextPage()} />
      <TimePickerDialog
        initial={customFor?.at ?? null}
        title="Remind me"
        label="Remind me at"
        confirmLabel="Set reminder"
        onPick={(at) => customFor && void act(customFor.item, true, at)}
        onClose={() => setCustomFor(null)}
      />
    </ViewScreen>
  );
}

/** Unsent drafts on this device first, then messages scheduled to send later. */
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
      if (!result.success) throw new Error(result.error);
      return result.items;
    },
  });
  const [rescheduling, setRescheduling] = useState<{ id: string; at: Date } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Loaded conversations that no longer list this one: you left it (or it was removed).
  // ponytail: bootstrap lists the newest 100 DMs, so a draft in an older DM also reads "Left". Upgrade: look it up by id.
  const left = (channelId: string) => channelId !== "new" && Boolean(data) && !data?.channels.some((c) => c.id === channelId);
  const titleOf = (channelId: string) => {
    if (channelId === "new") return "New message";
    const channel = data?.channels.find((c) => c.id === channelId);
    if (!channel) return "a conversation";
    const title = channelTitle(channel, meId);
    return isDirectLike(channel) ? title : `#${title}`;
  };
  // A stable order: by conversation, then thread drafts after the conversation's own.
  const sortedDrafts = [...drafts].sort((a, b) => titleOf(a.channelId).localeCompare(titleOf(b.channelId)) || Number(Boolean(a.threadRootSeq)) - Number(Boolean(b.threadRootSeq)));
  const keepAsDraft = (target: { channelId: string; threadRootSeq: number | null; body: string }) => {
    const key = target.threadRootSeq ? `${target.channelId}:${target.threadRootSeq}` : target.channelId;
    // Never overwrite a draft already there: add the text below it.
    const existing = readDraft(key).trim();
    writeDraft(key, existing ? `${existing}\n\n${target.body}` : target.body);
    return Boolean(existing);
  };
  const cancel = async (id: string, keep?: { channelId: string; threadRootSeq: number | null; body: string }, undoable?: { channel_id: string; thread_root_seq: number | null; body: string }) => {
    const result = await cancelScheduled({ id });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.scheduled() });
    if (keep) {
      if (keepAsDraft(keep)) toast("Added below your existing draft");
      router.push(keep.threadRootSeq ? threadHref(keep.channelId, keep.threadRootSeq) : conversationHref(keep.channelId));
    } else if (undoable) {
      // Cancelling must not lose the text: Undo keeps it as a draft.
      toast("Scheduled message cancelled", {
        action: {
          label: "Undo",
          onClick: () => {
            keepAsDraft({ channelId: undoable.channel_id, threadRootSeq: undoable.thread_root_seq, body: undoable.body });
            toast("Kept as a draft");
          },
        },
      });
    }
  };
  const discard = (draft: { key: string; body: string }) => {
    writeDraft(draft.key, "");
    toast("Draft discarded", { action: { label: "Undo", onClick: () => writeDraft(draft.key, draft.body) } });
  };
  const refreshScheduled = () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.scheduled() });
  const sendNow = async (id: string) => {
    setBusy(id);
    const result = await sendScheduledNow({ id });
    setBusy(null);
    refreshScheduled();
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success("Sent");
  };
  const reschedule = async (id: string, at: Date) => {
    const result = await rescheduleScheduled({ id, sendAt: at.toISOString() });
    refreshScheduled();
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success(`Rescheduled for ${formatChatTime(at, "at")}`);
  };
  const nothingScheduled = scheduled.data && !scheduled.data.length;
  return (
    <ViewScreen title="Drafts & scheduled">
      <section aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] font-semibold text-muted-foreground"><Pencil size={13} aria-hidden="true" /> Drafts on this device</h2>
        {!drafts.length ? <p className="border-b border-border px-4 py-4 text-[13px] text-muted-foreground">No drafts. Anything you start typing and leave is kept here.</p> : null}
        <ul>
          {sortedDrafts.map((draft) => (
            <li key={draft.key} className="flex gap-3 border-b border-border px-4 py-3">
              {left(draft.channelId) ? (
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-muted-foreground">Left conversation</p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] text-muted-foreground">{tokensToPlainText(draft.body)}</p>
                </div>
              ) : (
                <Link href={draft.threadRootSeq ? threadHref(draft.channelId, draft.threadRootSeq) : conversationHref(draft.channelId)} className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{draft.threadRootSeq ? "Thread in " : ""}{titleOf(draft.channelId)}</p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] text-muted-foreground">{tokensToPlainText(draft.body)}</p>
                </Link>
              )}
              <button type="button" onClick={() => discard(draft)} className="grid size-8 flex-none place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-destructive pointer-coarse:size-11" aria-label="Discard draft" title="Discard"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      </section>
      {/* With drafts on screen, an empty Scheduled section is just noise. */}
      {nothingScheduled && drafts.length ? null : (
        <section aria-labelledby="scheduled-heading">
          <h2 id="scheduled-heading" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] font-semibold text-muted-foreground"><Clock size={13} aria-hidden="true" /> Scheduled</h2>
          {scheduled.isLoading ? <ListSkeleton header={false} label="Loading scheduled messages" rows={2} /> : null}
          {scheduled.isError ? <ListError what="Scheduled messages" query={scheduled} /> : null}
          {nothingScheduled ? <p className="border-b border-border px-4 py-4 text-[13px] text-muted-foreground">Nothing scheduled. Use the arrow next to Send to send a message later.</p> : null}
          <ul>
            {(scheduled.data ?? []).map((item) => (
              <li key={item.id} className="flex gap-3 border-b border-border px-4 py-3">
                <Link href={item.thread_root_seq ? threadHref(item.channel_id, item.thread_root_seq) : conversationHref(item.channel_id)} className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-medium">To {item.channel_name ? `#${item.channel_name}` : titleOf(item.channel_id)}</span>
                    <span className={item.failed_reason ? "text-destructive" : "text-muted-foreground"}>
                      {item.failed_reason ? `Couldn't send: ${chatErrorMessage(item.failed_reason)}` : formatChatTime(item.send_at, "at")}
                    </span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[15px]">{tokensToPlainText(item.body)}</p>
                </Link>
                <div className="flex flex-none items-start gap-1">
                  <button type="button" disabled={busy === item.id} onClick={() => void sendNow(item.id)} className="h-8 rounded-[5px] border border-border px-2.5 text-[13px] font-medium hover:bg-muted disabled:opacity-60 pointer-coarse:h-11">
                    {busy === item.id ? "Sending…" : item.failed_reason ? "Retry" : "Send now"}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label="More for this scheduled message">
                      <MoreHorizontal size={15} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onSelect={() => setRescheduling({ id: item.id, at: new Date(Math.max(Date.parse(item.send_at), Date.now() + 60 * 60_000)) })}><CalendarClock size={14} /> Reschedule…</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void cancel(item.id, { channelId: item.channel_id, threadRootSeq: item.thread_root_seq, body: item.body })}><Pencil size={14} /> Edit as draft</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void cancel(item.id, undefined, item)}><Trash2 size={14} /> Cancel scheduled message</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <TimePickerDialog
        initial={rescheduling?.at ?? null}
        title="Reschedule message"
        label="Send at"
        confirmLabel="Reschedule"
        onPick={(at) => rescheduling && void reschedule(rescheduling.id, at)}
        onClose={() => setRescheduling(null)}
      />
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

/** From: anyone you could message, searched by name (not only people in your DM list). */
function FromPicker({ value, label, meId, onPick }: { value: string; label: string | null; meId: string | null; onPick: (person: { id: string; name: string } | null) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const people = usePeopleSearch(query, open);
  if (value) {
    return (
      <span className="inline-flex h-8 items-center gap-1 rounded-[5px] border border-primary bg-accent pl-2 text-[13px] text-accent-foreground pointer-coarse:h-11">
        From: {label ?? "someone"}
        <button type="button" onClick={() => onPick(null)} className="grid size-7 place-items-center pointer-coarse:size-11" aria-label="Clear From"><X size={12} /></button>
      </span>
    );
  }
  const options = [...(meId && (!query || "me".startsWith(query.toLowerCase())) ? [{ id: meId, name: "me" }] : []), ...(people.data ?? []).filter((p) => p.id !== meId).map((p) => ({ id: p.id, name: personName(p) }))];
  return (
    <span className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && options[0]) { e.preventDefault(); onPick(options[0]); } }}
        placeholder="From: anyone"
        aria-label="From"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls="search-from-options"
        aria-autocomplete="list"
        className="h-8 w-36 rounded-[5px] border border-input bg-card px-2 text-[13px] pointer-coarse:h-11"
      />
      {open && options.length ? (
        <ul id="search-from-options" role="listbox" className="absolute left-0 top-full z-20 mt-1 max-h-60 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {options.slice(0, 8).map((option) => (
            <li key={option.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); onPick(option); }} className="cursor-pointer rounded-[4px] px-2 py-1.5 text-[13px] hover:bg-muted">{option.name}</li>
          ))}
        </ul>
      ) : null}
    </span>
  );
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
  const fromName = params?.get("fromName") ?? null;
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
  // In: recent conversations first (the ones you're likely to mean), then the rest A–Z.
  const conversations = useMemo(() => {
    const list = (data?.channels ?? []).filter((c) => !c.archived_at).map((c) => ({ id: c.id, title: isDirectLike(c) ? channelTitle(c, meId) : `#${channelTitle(c, meId)}`, at: c.last_message_at ?? "" }));
    const recent = [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    const recentIds = new Set(recent.map((c) => c.id));
    return { recent, rest: list.filter((c) => !recentIds.has(c.id)).sort((a, b) => a.title.localeCompare(b.title)) };
  }, [data?.channels, meId]);
  const titleOf = (id: string) => [...conversations.recent, ...conversations.rest].find((c) => c.id === id)?.title;
  const people = useMemo(() => {
    const map = new Map<string, ChatPerson>();
    for (const c of data?.channels ?? []) {
      if (c.dm_user) map.set(c.dm_user.id, c.dm_user);
      for (const p of c.members_preview ?? []) map.set(p.id, p);
    }
    return map;
  }, [data?.channels]);
  const fromLabel = from === meId ? "me" : fromName ?? (people.get(from) ? personName(people.get(from)) : null);

  const tooShort = q.trim().length === 1;
  const active = q.trim().length >= 2 || Boolean(from || inChannel || after || before) || hasFile;
  const resultPages = useInfiniteQuery({
    queryKey: queryKeys.chat.search(params?.toString() ?? ""),
    enabled: active,
    initialPageParam: null as string | null,
    getNextPageParam: (page: SearchHit[]) => (page.length === CHAT_LIST_PAGE ? page.at(-1)?.created_at : undefined),
    queryFn: async ({ pageParam }) => {
      const result = await searchMessages({
        cursor: pageParam,
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
  const results = resultPages.data?.pages.flat();
  const select = "h-8 rounded-[5px] border border-input bg-card px-2 text-[13px] pointer-coarse:h-11";
  return (
    <ViewScreen title="Search" closable>
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
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search messages" className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none pointer-coarse:h-11" />
          <button type="submit" className="text-[13px] font-medium text-primary pointer-coarse:min-h-11">Search</button>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="In" value={inChannel} onChange={(e) => set({ in: e.target.value || null })} className={select}>
            <option value="">In: everywhere</option>
            <optgroup label="Recent">
              {conversations.recent.map((c) => <option key={c.id} value={c.id}>In: {c.title}</option>)}
            </optgroup>
            {conversations.rest.length ? (
              <optgroup label="All conversations">
                {conversations.rest.map((c) => <option key={c.id} value={c.id}>In: {c.title}</option>)}
              </optgroup>
            ) : null}
          </select>
          <FromPicker value={from} label={fromLabel} meId={meId} onPick={(person) => set({ from: person?.id ?? null, fromName: person && person.id !== meId ? person.name : null })} />
          <button type="button" aria-pressed={hasFile} onClick={() => set({ has: hasFile ? null : "file" })} className={`inline-flex h-8 items-center gap-1.5 rounded-[5px] border px-2 text-[13px] pointer-coarse:h-11 ${hasFile ? "border-primary bg-accent text-accent-foreground" : "border-input text-muted-foreground"}`}>
            <Paperclip size={13} /> Has file
          </button>
          <label className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">After <input type="date" value={after} onChange={(e) => set({ after: e.target.value || null })} className={select} /></label>
          <label className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">Before <input type="date" value={before} onChange={(e) => set({ before: e.target.value || null })} className={select} /></label>
        </div>
      </form>
      {tooShort && !active ? <Empty>Type at least 2 characters.</Empty> : !active ? <Empty>Search words in every conversation you&apos;re in. Narrow it down with In, From, Has file and dates.</Empty> : null}
      {resultPages.isLoading ? <ListSkeleton header={false} label="Searching" rows={4} /> : null}
      {resultPages.isError && !results ? <ListError what="Search results" detail={chatErrorMessage(resultPages.error.message)} query={resultPages} /> : null}
      {results && !results.length ? <Empty>No messages match.</Empty> : null}
      {results?.length ? <p className="px-4 pt-3 text-[12px] text-muted-foreground">{resultPages.hasNextPage ? `Newest ${results.length} results` : `${results.length} result${results.length === 1 ? "" : "s"}`}</p> : null}
      <ul aria-label="Search results">
        {(results ?? []).map((hit: SearchHit) => (
          <li key={`${hit.channel_id}:${hit.seq}`} className="border-b border-border">
            <SnippetRow
              href={hit.thread_root_seq ? threadHref(hit.channel_id, hit.thread_root_seq) : conversationHref(hit.channel_id, { m: hit.seq })}
              author={hit.author}
              time={hit.created_at}
              body={<Highlighted text={tokensToPlainText(hit.body)} query={q} />}
              head={<>
                <span className="font-medium">{personName(hit.author)}</span>
                <span className="truncate text-muted-foreground">in <Place item={{ ...hit, channel_title: titleOf(hit.channel_id) }} />{hit.thread_root_seq ? " · thread" : ""}</span>
                {hit.has_file ? <Paperclip size={12} aria-label="Has a file" className="text-muted-foreground" /> : null}
              </>}
            />
          </li>
        ))}
      </ul>
      {resultPages.isError && results ? <MoreError onRetry={() => void resultPages.fetchNextPage()} /> : null}
      <LoadMore hasMore={Boolean(resultPages.hasNextPage) && !resultPages.isError} loading={resultPages.isFetchingNextPage} onLoad={() => void resultPages.fetchNextPage()} />
    </ViewScreen>
  );
}
