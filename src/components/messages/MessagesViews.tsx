"use client";
import { TabMarker } from "@/components/ui/TabMarker";
import { padCount } from "@/lib/ui/tab-marker";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useDocumentTitlePrefix } from "@/hooks/useDocumentTitlePrefix";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, AtSign, BellOff, Bookmark, CalendarClock, Check, CheckCheck, ChevronDown, Clock, Hash, Inbox, MailOpen, MoreHorizontal, MessageSquareText, Paperclip, Pencil, Plus, Search, SmilePlus, Trash2, X, type LucideIcon } from "lucide-react";
import { toast, feedbackDate } from "@/lib/feedback";

import { listInbox, listThreads, markInboxRead, markInboxUnread, type InboxFilter, type InboxItem, type ThreadItem } from "@/app/actions/chat/activity";
import { listThread, setThreadFollow } from "@/app/actions/chat/messages";
import { markThreadRead } from "@/app/actions/chat/read";
import { browseChannels, joinChannel } from "@/app/actions/chat/channels";
import { cancelScheduled, listSaved, listScheduled, rescheduleScheduled, saveMessage, sendScheduledNow, type SavedItem } from "@/app/actions/chat/later";
import { searchMessages, type SearchHit } from "@/app/actions/chat/search";
import { useChatUi, useDrafts, writeDraft, readDraft } from "@/components/messages/chat-ui-store";
import { useBlockedIds, useChatShell } from "@/components/messages/ChatShellProvider";
import { ListOrHome } from "@/components/messages/HomePane";
import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { ViewScreen } from "@/components/messages/ViewScreen";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TimePickerDialog } from "@/components/messages/parts/TimePickerDialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, fullTime, isApplicationThread, isDirectLike, isVisible, personName } from "@/lib/messaging/channel-view";
import { CHAT_LIST_PAGE } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { groupNoun } from "@/lib/messaging/inbox";
import { conversationHref, messageHref, threadHref } from "@/lib/messaging/routes";
import { laterTimes } from "@/lib/messaging/reminders";
import { previewText } from "@/lib/messaging/tokens";
import type { ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { useChannelDetails, useChannelMembers, useTyping } from "@/components/messages/useConversation";
import { postingFooter } from "@/lib/messaging/posting";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { useWindowNav } from "@/components/messages/window-nav";
import { editingWithText, rovingTabKey } from "@/components/messages/keys";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), { ssr: false });

const when = (value: string | null) => (value ? formatChatTime(value) : "");

/** An empty list: the app's empty state (icon, what goes here, and how). */
function Empty({ icon = Inbox, title, children }: { icon?: LucideIcon; title: string; children?: React.ReactNode }) {
  return <EmptyState compact icon={icon} title={title} description={children} className="m-4" />;
}

/** An error is not an empty list: say so, with Retry (a failed later page retries that page). */
function ListError({ what, detail, query }: { what: string; detail?: string; query: { data?: unknown; refetch: () => unknown; fetchNextPage?: () => unknown } }) {
  return (
    <div className="space-y-1 p-4">
      <ErrorNotice what={what} onRetry={() => void (query.data && query.fetchNextPage ? query.fetchNextPage() : query.refetch())} />
      {detail ? <p className="px-1 text-[13px] text-muted-foreground">{detail}</p> : null}
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
  return <div ref={ref} className="p-4 text-center text-[12px] text-muted-foreground">{loading ? <span role="status" className="nb-waiting justify-center"><PixelBeat />Loading…</span> : null}</div>;
}

function where(item: { channel_name: string | null; channel_title?: string | null; channel_kind: string }) {
  if (item.channel_name) return `#${item.channel_name}`;
  return item.channel_title || (item.channel_kind === "dm" ? "a direct message" : "a group conversation");
}

/** "in #design · Acme": the project travels with the place, on every screen size. */
function Place({ item }: { item: { channel_name: string | null; channel_title?: string | null; channel_kind: string; project_title?: string | null } }) {
  return <>{where(item)}{item.project_title ? <span className="text-muted-foreground"> · {item.project_title}</span> : null}</>;
}

/**
 * ↑/↓ move between the rows of a list (one Tab stop per list, like the timeline): put this on the
 * <ul>, and give each row's link `data-row-link`. The row that has focus becomes the Tab stop.
 */
function rowKeys(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-row-link]"));
  const at = links.findIndex((link) => link.closest("li") === (event.target as HTMLElement).closest("li"));
  const next = links[at + (event.key === "ArrowDown" ? 1 : -1)];
  if (at < 0 || !next) return;
  event.preventDefault();
  next.focus();
}
/** Tab lands on one row per list: the focused one (or the first). Pass the row's key and the list's active key. */
function useRowTabStop() {
  const [active, setActive] = useState<string | null>(null);
  return {
    stop: (key: string, index: number) => (active === null ? index === 0 : active === key),
    onFocusRow: (key: string) => setActive(key),
  };
}

/** One row for Inbox, Threads, Saved and Search: avatar, who · where · when, then the message. */
function SnippetRow({ href, target, onOpen, author, head, time, timeLabel, body, dim, unread, extra, aside, tabStop = true, onFocusRow }: {
  href: string; target?: { channelId: string; rootSeq: number | null; m?: number | null }; onOpen?: () => void; author: ChatPerson | null; head: React.ReactNode; time: string | null; body: React.ReactNode;
  /** Words before the time ("3 replies · last reply"). */
  timeLabel?: string;
  dim?: boolean; unread?: boolean; extra?: React.ReactNode; aside?: React.ReactNode;
  /** Roving tabindex: only one row of a list is a Tab stop (↑/↓ move, see rowKeys). */
  tabStop?: boolean; onFocusRow?: () => void;
}) {
  const win = useWindowNav();
  // Search and Saved fold what someone you blocked wrote (Blocking B34); opening it shows it, folded, in place.
  const blockedIds = useBlockedIds();
  const folded = Boolean(author && blockedIds.has(author.id));
  return (
    // Unread rows get the same faint tint as unread notifications.
    <div
      className={`group/snippet flex gap-3 px-4 py-3 hover:bg-muted ${unread ? "bg-primary/[0.04] dark:bg-primary/[0.08]" : ""}`}
      data-unread={unread ? "true" : undefined}
      data-row-tabstop={tabStop ? "" : undefined}
      onFocus={onFocusRow}
    >
      {/* The avatar is part of the link: clicking it opens the message too. */}
      <Link
        href={href}
        data-row-link=""
        tabIndex={tabStop ? 0 : -1}
        onClick={(event) => {
          onOpen?.();
          // In the window, open it there, at the message itself.
          if (win && target && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            win.open(target.channelId, target.rootSeq, target.m ?? null);
          }
        }}
        className="flex min-w-0 flex-1 gap-3 rounded-md"
      >
        <UserAvatar identity={author} size={34} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px]">
            {head}
            <span className="nb-meta ml-auto flex-none" title={time ? fullTime(time) : undefined}>{timeLabel ? `${timeLabel} ` : ""}{when(time)}</span>
          </span>
          <span className={`mt-0.5 line-clamp-2 block text-[15px] ${dim || folded ? "text-muted-foreground" : ""}`}>{folded ? "Message from someone you blocked" : body}</span>
          {unread ? <span className="sr-only">, unread</span> : null}
          {extra}
        </span>
      </Link>
      {aside}
    </div>
  );
}

/**
 * Reply in place (Inbox rows): focused when it opens (on phones too: you tapped Reply), Esc closes it
 * unless you've typed something, and the toast links to the thread. It types and offers "Also send"
 * like the thread's own box; sending reads the item.
 */
function InlineReply({ channelId, rootSeq, label, alsoSendTo, onDone, onSent }: { channelId: string; rootSeq: number; label: string; alsoSendTo?: string | null; onDone: () => void; onSent?: () => void }) {
  const router = useRouter();
  const win = useWindowNav();
  const queryClient = useQueryClient();
  // @mentions in the reply need the conversation's people.
  const members = useChannelMembers(channelId, true);
  const people = members.data ?? [];
  const typing = useTyping(channelId, { rootSeq, people, memberCount: people.length, enabled: true });
  const { user } = useAuth();
  // The same posting rules as the thread drawer: read-only takes the box; admins-only hides "Also send to".
  const details = useChannelDetails(channelId);
  const posting = postingFooter(details.data?.posting);
  // ↑ in the empty box, as in a conversation: the thread opens with your last reply ready to edit
  // (the Inbox has no message list to edit it in place).
  const editLast = async () => {
    const thread = await queryClient.fetchQuery({
      queryKey: queryKeys.chat.thread(channelId, rootSeq),
      queryFn: async () => {
        const result = await listThread({ channelId, rootSeq });
        if (!result.success) throw new Error(result.error);
        return { root: result.root, replies: result.replies, following: result.following, lastReadSeq: result.lastReadSeq, hasOlder: result.hasOlder };
      },
      staleTime: 30_000,
    }).catch(() => null);
    const mine = thread?.replies.findLast((m) => m.author_id === user?.id && m.seq > 0 && !m.deleted_at && !m.card && m.kind === "user");
    if (!mine) return;
    useChatUi.getState().setPendingEdit({ channelId, seq: mine.seq });
    if (win) win.open(channelId, rootSeq, mine.seq);
    else router.push(messageHref(channelId, mine.seq, rootSeq));
  };
  return (
    <div
      onKeyDown={(event) => {
        // Esc with text typed keeps the box (and the draft): only an empty box closes.
        if (event.key === "Escape" && !event.defaultPrevented && !editingWithText(event.target)) {
          event.stopPropagation();
          onDone();
        }
      }}
    >
      {posting?.kind === "blocked" && posting.cause === "read-only" ? (
        <div className="nbm-comp-foot"><div className="nbm-comp-foot-cell">
          <span className="nbm-tag">{posting.tag}</span>
          <span><b>{posting.line}</b>{posting.reason ? ` ${posting.reason}` : null}</span>
        </div></div>
      ) : (
      <Composer
        channelId={channelId}
        threadRootSeq={rootSeq}
        placeholder={`Reply in ${label}…`}
        people={people}
        allowBroadcast={false}
        canCreateTask={false}
        autoFocus="always"
        onTyping={typing.notify}
        typingNames={typing.names}
        alsoSendTo={posting?.kind === "blocked" ? null : alsoSendTo}
        onEditLast={() => void editLast()}
        onSent={() => {
          onDone();
          onSent?.();
          // In the floating window, the thread opens in the window, not as a new page.
          const view = () => (win ? win.open(channelId, rootSeq, null) : router.push(threadHref(channelId, rootSeq)));
          toast.success("Reply sent", { action: { label: "View thread", onClick: view } });
          void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
        }}
      />
      )}
    </div>
  );
}

/** /messages/w/[workspaceId]: select the project; displays channels in sidebar while main pane shows placeholder. */
export function WorkspaceLanding({ projectId }: { projectId: string }) {
  const setProject = useChatUi((state) => state.setProject);
  const { data } = useChatShell();
  const router = useRouter();
  useDocumentTitlePrefix(data?.projects?.find((p) => p.id === projectId)?.title ?? null);
  // A project you left (old link, Back): go to All instead of keeping a stale pick.
  const known = !data?.projects || data.projects.some((p) => p.id === projectId);
  useEffect(() => {
    if (known) return void setProject(projectId);
    // Say why you landed on All instead of the link's project.
    toast("You’re no longer in that workspace");
    router.replace("/messages");
  }, [known, projectId, router, setProject]);
  return <ListOrHome />;
}

type BrowseSort = "name" | "members";
type BrowseShow = "all" | "joined" | "open" | "archived";
const FILTER_CONTROL = "w-auto text-[13px] pointer-coarse:h-11";
const membersLabel = (count: number) => `${count} member${count === 1 ? "" : "s"}`;

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
  useDocumentTitlePrefix(channels.isError ? null : title ?? null);
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
      back={`/messages/w/${projectId}`}
      title={title ? `Browse channels in ${title}` : "Browse channels"}
      action={<Button type="button" size="sm" onClick={() => setCreateFor(projectId)} className="pointer-coarse:h-11"><Plus size={16} /> Create channel</Button>}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-4">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Filter channels</span>
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels" className="max-w-md pl-9 pointer-coarse:h-11 pointer-coarse:text-[17px]" />
        </label>
        <Select value={show} onValueChange={(value) => setShow(value as BrowseShow)}>
          <SelectTrigger aria-label="Show" className={FILTER_CONTROL}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="joined">Joined</SelectItem>
            <SelectItem value="open">Not joined</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as BrowseSort)}>
          <SelectTrigger aria-label="Sort" className={FILTER_CONTROL}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name</SelectItem>
            <SelectItem value="members">Sort: Most members</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="border-b border-border px-4 py-2 text-[13px] text-muted-foreground">Private channels aren’t listed. Ask a member to add you.</p>
      {channels.isLoading ? <ListSkeleton header={false} label="Loading channels" rows={4} /> : null}
      {channels.isError ? <ListError what="Channels" detail={chatErrorMessage(channels.error.message)} query={channels} /> : null}
      <ul aria-label="Channels">
        {visible.map((channel) => (
          <li key={channel.id} className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-2">
            <Hash size={16} aria-hidden="true" className="flex-none text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <Link href={conversationHref(channel.id)} className="block truncate text-[15px] font-medium hover:underline">{channel.name}</Link>
              <p className="truncate text-[13px] text-muted-foreground">{channel.description || channel.topic || "No description"} · <span className="nb-meta">{membersLabel(channel.member_count)}</span></p>
            </div>
            {channel.archived ? (
              <Button asChild variant="outline" size="sm" className="pointer-coarse:h-11"><Link href={conversationHref(channel.id)}>View</Link></Button>
            ) : channel.joined ? (
              <>
                <span className="nb-tag flex-none"><Check size={14} aria-hidden="true" /> Joined</span>
                <Button asChild variant="outline" size="sm" className="pointer-coarse:h-11"><Link href={conversationHref(channel.id)}>Open</Link></Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="text-muted-foreground pointer-coarse:h-11"><Link href={conversationHref(channel.id)}>Preview</Link></Button>
                {/* Join is the primary action, the same as in a thread and in Details. */}
                <Button type="button" size="sm" onClick={() => void join(channel.id)} disabled={joining !== null} aria-busy={joining === channel.id} className="pointer-coarse:h-11">{joining === channel.id ? "Joining…" : "Join"}</Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {nothingYet ? (
        <EmptyState compact icon={Hash} title="No public channels yet" description="Start one for a topic your workspace talks about." action={<Button type="button" size="sm" onClick={() => setCreateFor(projectId)}><Plus size={16} /> Create channel</Button>} className="m-4" />
      ) : channels.data && !visible.length ? <Empty icon={Hash} title={show === "archived" ? "No archived channels" : "No channels match"} /> : null}
    </ViewScreen>
  );
}

// "Unread" is a tab of its own, like the Notifications tray (not a separate toggle).
type InboxTab = InboxFilter | "unread" | "threads";
const FILTERS: Array<{ id: InboxTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mentions", label: "Mentions" },
  { id: "threads", label: "Threads" },
  { id: "reactions", label: "Reactions" },
];

/** Each tab says what belongs there (#132). */
const EMPTY_TEXT: Record<InboxFilter | "unread", { title: string; text: string }> = {
  all: { title: "Nothing in your Inbox yet", text: "Mentions, thread replies and reactions show up here." },
  unread: { title: "You’re all caught up", text: "New mentions and thread replies show up here." },
  mentions: { title: "No mentions yet", text: "When someone @mentions you, it shows up here." },
  reactions: { title: "No reactions yet", text: "Reactions to your messages show up here." },
};

function InboxIcon({ kind }: { kind: InboxItem["kind"] }) {
  const Icon = kind === "thread_reply" ? MessageSquareText : kind === "reaction" ? SmilePlus : AtSign;
  return <Icon size={14} aria-hidden="true" className="flex-none" />;
}

function describe(item: InboxItem) {
  if (item.kind === "reaction") return `reacted ${item.emoji} to your message`;
  if (item.kind === "thread_reply") return "replied in a thread";
  if (item.kind === "channel" || item.kind === "here") return `mentioned @${item.kind}`;
  return "mentioned you";
}

/** An unread mark: the same dot as unread notifications. */
function UnreadDot() {
  return <span className="mt-2 size-2 flex-none rounded-full bg-primary ring-2 ring-card" aria-hidden="true" />;
}

type RowNav = { tabStop: boolean; onFocusRow: () => void };

/**
 * One Inbox row: who, what, where, when; unread ones are bold with a dot. Mentions and replies can be
 * answered in place; Reply and ⋯ (read state) on every screen size, so a row stays one line of buttons.
 */
function InboxRow({ item, nav, onOpen, onToggleRead, onReplied }: { item: InboxItem; nav: RowNav; onOpen: (item: InboxItem) => void; onToggleRead: (item: InboxItem) => void; onReplied: (item: InboxItem) => void }) {
  // A thread reply opens its thread at that reply, not just the thread.
  const href = messageHref(item.channel_id, item.seq, item.thread_root_seq);
  const [replying, setReplying] = useState(false);
  const reaction = item.kind === "reaction";
  const text = previewText(item.body) || "Attachment";
  const who = personName(item.author);
  const place = where(item);
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
          <span className={item.read ? "font-medium" : "font-semibold"}>{who}</span>
          <span className="min-w-0 truncate text-muted-foreground">{describe(item)} in <Place item={item} /></span>
        </>}
        {...nav}
        aside={
          <div className="flex flex-none items-start gap-1">
            {!item.read ? <UnreadDot /> : null}
            {!reaction ? (
              <>
                <Button type="button" variant="outline" size="sm" tabIndex={nav.tabStop ? 0 : -1} onClick={() => setReplying(!replying)} aria-expanded={replying} aria-label={`Reply to ${who} in ${place}`} className="h-7 px-2 text-[12px] pointer-coarse:h-11">Reply</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger tabIndex={nav.tabStop ? 0 : -1} className="nb-icon-button size-7 pointer-coarse:size-11" aria-label={`More for ${who}'s message in ${place}`}>
                    <MoreHorizontal size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={() => onToggleRead(item)}>{item.read ? <><MailOpen /> Mark unread</> : <><CheckCheck /> Mark as read</>}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
          </div>
        }
      />
      {replying ? (
        <InlineReply
          channelId={item.channel_id}
          rootSeq={item.thread_root_seq ?? item.seq}
          label={place}
          alsoSendTo={item.thread_root_seq && item.channel_name ? `#${item.channel_name}` : null}
          onDone={() => setReplying(false)}
          onSent={() => onReplied(item)}
        />
      ) : null}
    </>
  );
}

/**
 * Consecutive items from one place collapse under "3 mentions in #design". Thread replies group by
 * their thread (not the whole conversation), so two threads never read as "5 updates".
 */
function groupByPlace(items: InboxItem[]) {
  const place = (item: InboxItem) => `${item.channel_id}:${item.kind === "thread_reply" ? item.thread_root_seq : "c"}`;
  const groups: InboxItem[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && place(last[0]!) === place(item)) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

function InboxGroup({ items, nav, onOpen, onToggleRead, onMarkRead, onReplied }: { items: InboxItem[]; nav: RowNav; onOpen: (item: InboxItem) => void; onToggleRead: (item: InboxItem) => void; onMarkRead: (items: InboxItem[]) => void; onReplied: (item: InboxItem) => void }) {
  const [open, setOpen] = useState(items.some((item) => !item.read));
  if (items.length === 1) return <li className="group/inbox border-b border-border"><InboxRow item={items[0]!} nav={nav} onOpen={onOpen} onToggleRead={onToggleRead} onReplied={onReplied} /></li>;
  const unreadItems = items.filter((item) => !item.read && item.kind !== "reaction");
  const unread = items.filter((item) => !item.read).length;
  const noun = groupNoun(items.map((item) => item.kind));
  const inThread = items[0]!.kind === "thread_reply";
  return (
    <li className="border-b border-border">
      <div className="flex min-h-11 items-center gap-2 px-4 hover:bg-muted">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-[13px]">
          <ChevronDown size={14} aria-hidden="true" className={open ? "" : "-rotate-90"} />
          <span className={`min-w-0 truncate ${unread ? "font-semibold" : "font-medium"}`}>{items.length} {noun} {inThread ? "in a thread in" : "in"} <Place item={items[0]!} /></span>
          {unread ? <span className="nb-chat-count">{unread > 99 ? "99+" : unread}<span className="sr-only"> unread</span></span> : null}
          <span className="nb-meta ml-auto flex-none" title={fullTime(items[0]!.created_at)}>{when(items[0]!.created_at)}</span>
        </button>
        {unreadItems.length ? <Button type="button" variant="ghost" size="sm" onClick={() => onMarkRead(unreadItems)} className="h-7 px-2 text-[12px] pointer-coarse:h-11"><CheckCheck size={14} /> Mark as read</Button> : null}
      </div>
      {open ? <ul className="border-l-2 border-border pl-2">{items.map((item) => <li key={`${item.seq}:${item.kind}:${item.emoji ?? ""}`} className="group/inbox"><InboxRow item={item} nav={nav} onOpen={onOpen} onToggleRead={onToggleRead} onReplied={onReplied} /></li>)}</ul> : null}
    </li>
  );
}

function ThreadRow({ thread, nav }: { thread: ThreadItem; nav: RowNav }) {
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
    toast.success("Unfollowed", { action: { label: "Undo", onClick: () => void setThreadFollow({ channelId: thread.channel_id, rootSeq: thread.root_seq, on: true }).then(refresh) } });
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
        // The count sits by the time it describes: "3 replies · last reply 5m ago".
        timeLabel={`${thread.reply_count} ${thread.reply_count === 1 ? "reply" : "replies"} · last reply`}
        body={thread.root_deleted ? <span className="italic">Original message deleted</span> : previewText(thread.body) || "Attachment"}
        dim={thread.root_deleted}
        // Who started it and where.
        head={<>
          <MessageSquareText size={14} aria-hidden="true" className="flex-none" />
          <span className={`flex-none ${thread.unread ? "font-semibold" : "font-medium"}`}>{personName(thread.author)}</span>
          <span className="min-w-0 truncate text-muted-foreground">in <Place item={thread} /></span>
        </>}
        extra={shown.length ? (
          <span className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="inline-flex -space-x-1">{shown.map((p: ChatPerson) => <span key={p.id} className="inline-block rounded-sm ring-2 ring-card"><UserAvatar identity={p} size={20} /></span>)}</span>
            {shown.map((p) => personName(p).split(" ")[0]).join(", ")}{more ? ` +${more}` : ""}
          </span>
        ) : null}
        {...nav}
        aside={
          <div className="flex flex-none items-start gap-1">
            {thread.unread ? <UnreadDot /> : null}
            <Button type="button" variant="outline" size="sm" tabIndex={nav.tabStop ? 0 : -1} onClick={() => setReplying(!replying)} aria-expanded={replying} aria-label={`Reply in the thread in ${label}`} className="h-7 px-2 text-[12px] pointer-coarse:h-11">Reply</Button>
            {/* Everything else in one menu, so a row stays one line tall on phones. */}
            <DropdownMenu>
              <DropdownMenuTrigger tabIndex={nav.tabStop ? 0 : -1} className="nb-icon-button size-7 pointer-coarse:size-11" aria-label={`More for the thread in ${label}`}>
                <MoreHorizontal size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {thread.unread ? <DropdownMenuItem onSelect={() => void markRead()}><CheckCheck /> Mark as read</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={() => void unfollow()}><BellOff /> Unfollow</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {replying ? <InlineReply channelId={thread.channel_id} rootSeq={thread.root_seq} label={label} alsoSendTo={thread.channel_name ? `#${thread.channel_name}` : null} onDone={() => setReplying(false)} onSent={() => void markRead()} /> : null}
    </li>
  );
}

/** A failed next page: say so where it happened (the bottom), not as if the whole list failed. */
function MoreError({ onRetry }: { onRetry: () => void }) {
  return <ErrorNotice what="More" onRetry={onRetry} className="m-4" />;
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
  const raw = win ? windowFilter : params?.get("filter");
  const filter = FILTERS.some((f) => f.id === raw) ? (raw as InboxTab) : "all";
  // Unread is the All feed, unread items only (reactions are never unread).
  const feedFilter: InboxFilter = filter === "unread" || filter === "threads" ? "all" : filter;
  const feed = useInfiniteQuery({
    queryKey: queryKeys.chat.inbox(feedFilter),
    enabled: filter !== "threads",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listInbox({ filter: feedFilter, cursor: pageParam });
      if (!result.success) throw new Error(result.error);
      return result.items;
    },
    getNextPageParam: (page) => (page.length === CHAT_LIST_PAGE ? page.at(-1)?.cursor : undefined),
  });
  const threadPages = useInfiniteQuery({
    queryKey: queryKeys.chat.threads(),
    enabled: filter === "threads",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listThreads({ cursor: pageParam });
      if (!result.success) throw new Error(result.error);
      return result.threads;
    },
    getNextPageParam: (page) => (page.length === CHAT_LIST_PAGE ? page.at(-1)?.cursor : undefined),
  });
  const threads = threadPages.data?.pages.flat();
  const items = (feed.data?.pages.flat() ?? []).filter((item) => filter !== "unread" || (!item.read && item.kind !== "reaction"));
  const groups = groupByPlace(items);
  const rows = useRowTabStop();
  // Every tab with something new says how much: unread (the badge), mentions alone, followed threads with new replies.
  const counts: Record<InboxTab, number> = {
    all: 0,
    unread: shell.data?.inbox_unread ?? 0,
    mentions: shell.data?.inbox_mentions ?? 0,
    threads: shell.data?.threads_unread ?? 0,
    reactions: 0,
  };

  // The server publishes membership.changed, which refreshes the shell (badge) once; only the lists reload here.
  const refreshInbox = () => {
    void queryClient.invalidateQueries({ queryKey: ["chat-v3", "inbox"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
  };
  const readItems = (list: InboxItem[]) => markInboxRead({ items: list.map((item) => ({ channelId: item.channel_id, seq: item.seq })) });
  const open = (item: InboxItem) => {
    if (item.read || item.kind === "reaction") return;
    void readItems([item]).then(refreshInbox);
  };
  // Answering in place reads what you answered (the badge drops with it).
  const replied = (item: InboxItem) => {
    if (!item.read) void readItems([item]).then(refreshInbox);
  };
  const toggleRead = async (item: InboxItem) => {
    const result = item.read ? await markInboxUnread({ channelId: item.channel_id, seq: item.seq }) : await readItems([item]);
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshInbox();
  };
  const markGroupRead = async (list: InboxItem[]) => {
    const result = await readItems(list);
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
  const markLabel = "Mark all as read";
  const markAllRead = useMarkAllRead();
  const markAll = async () => {
    const result = await markInboxRead({ all: true, scope });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshInbox();
    toast.success(scope === "threads" ? "Threads marked as read" : scope === "mentions" ? "Mentions marked as read" : "Inbox marked as read");
  };
  // What the button clears on this tab, from the server's counts (not just the loaded rows).
  const markable = filter === "threads" ? counts.threads : filter === "mentions" ? counts.mentions : filter === "reactions" ? 0 : counts.unread;

  return (
    <ViewScreen
      title="Inbox"
      action={markable > 0 ? (
        // The floating window has little room: the button is its icon there (the name stays for screen readers).
        <Button type="button" variant="outline" size={win ? "icon-sm" : "sm"} onClick={() => markAllRead.request(markable, markAll, filter === "threads" ? "thread" : "item", markLabel)} aria-label={markLabel} title={markLabel} className="pointer-coarse:h-11 pointer-coarse:min-w-11">
          <CheckCheck size={16} />{win ? null : markLabel}
        </Button>
      ) : null}
    >
      <div className="flex flex-none items-end gap-4 overflow-x-auto border-b border-border px-4" role="tablist" aria-label="Inbox filters">
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
            className={`nb-tab -mb-px inline-flex min-h-10 flex-none items-center gap-1.5 border-b-2 text-[13px] font-medium pointer-coarse:min-h-11 ${filter === f.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}{counts[f.id] ? <span className="nb-tab-count">{counts[f.id] > 99 ? "99+" : <><span aria-hidden="true">{padCount(counts[f.id])}</span><span className="sr-only">{counts[f.id]}</span></>}<span className="sr-only"> unread</span></span> : null}
          </button>
        ))}
          <TabMarker overlap />
      </div>
      <div id="inbox-panel" role="tabpanel" aria-labelledby={`inbox-tab-${filter}`}>
      {filter === "threads" ? (
        <>
          {threadPages.isLoading ? <ListSkeleton header={false} label="Loading threads" rows={4} /> : null}
          {threadPages.isError && !threads ? <ListError what="Threads" query={threadPages} /> : null}
          {threads && !threads.length ? <Empty icon={MessageSquareText} title="No threads yet">Threads you start, reply to or follow show up here.</Empty> : null}
          <ul aria-label="Threads" onKeyDown={rowKeys}>
            {(threads ?? []).map((t, index) => {
              const key = `${t.channel_id}:${t.root_seq}`;
              return <ThreadRow key={key} thread={t} nav={{ tabStop: rows.stop(key, index), onFocusRow: () => rows.onFocusRow(key) }} />;
            })}
          </ul>
          {threadPages.isError && threads ? <MoreError onRetry={() => void threadPages.fetchNextPage()} /> : null}
          <LoadMore hasMore={Boolean(threadPages.hasNextPage) && !threadPages.isError} loading={threadPages.isFetchingNextPage} onLoad={() => void threadPages.fetchNextPage()} />
        </>
      ) : (
        <>
          {feed.isLoading ? <ListSkeleton header={false} label="Loading your Inbox" rows={5} /> : null}
          {feed.isError && !feed.data ? <ListError what="Inbox" query={feed} /> : null}
          {feed.data && !items.length ? <Empty icon={filter === "reactions" ? SmilePlus : filter === "mentions" ? AtSign : Inbox} title={EMPTY_TEXT[filter].title}>{EMPTY_TEXT[filter].text}</Empty> : null}
          {/* Keyed by place and oldest item: a new item at the top doesn't snap a group open or shut. */}
          <ul aria-label="Inbox" onKeyDown={rowKeys}>
            {groups.map((group, index) => {
              const key = `${group[0]!.channel_id}:${group.at(-1)!.seq}:${group.at(-1)!.kind}`;
              return <InboxGroup key={key} items={group} nav={{ tabStop: rows.stop(key, index), onFocusRow: () => rows.onFocusRow(key) }} onOpen={open} onToggleRead={(item) => void toggleRead(item)} onMarkRead={(list) => void markGroupRead(list)} onReplied={replied} />;
            })}
          </ul>
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
  // "Reminder due" must turn on while the page is open, not only at mount.
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
    if (clearReminder) return void toast.success("Reminder cleared");
    // The same toasts as saving from a message (useSavedSeqs): success, with Undo on removal.
    toast.success(on ? (label ? "Reminder set" : "Saved") : "Removed from Saved", on ? (remindAt ? { description: feedbackDate(remindAt) } : undefined) : {
      // Undo puts it back as it was, reminder included.
      action: { label: "Undo", onClick: () => void act(item, true, item.remind_at && !item.reminded_at ? new Date(item.remind_at) : null) },
    });
  };
  const rows = useRowTabStop();
  return (
    <ViewScreen title="Saved">
      {savedPages.isLoading ? <ListSkeleton header={false} label="Loading saved messages" rows={4} /> : null}
      {savedPages.isError && !saved ? <ListError what="Saved messages" query={savedPages} /> : null}
      {saved && !saved.length ? <Empty icon={Bookmark} title="Nothing saved yet">Save messages to come back to them: open a message’s menu (long-press on a phone) and choose Save, or press S on a selected message.</Empty> : null}
      <ul aria-label="Saved messages" onKeyDown={rowKeys}>
        {(saved ?? []).map((item, index) => {
          const due = item.remind_at && !item.reminded_at && Date.parse(item.remind_at) <= now + 60_000;
          // A saved thread reply opens its thread at that reply.
          const href = messageHref(item.channel_id, item.seq, item.thread_root_seq);
          const key = `${item.channel_id}:${item.seq}`;
          const who = personName(item.author);
          return (
            <li key={key} className="border-b border-border">
              <SnippetRow
                href={href}
                target={{ channelId: item.channel_id, rootSeq: item.thread_root_seq, m: item.seq }}
                author={item.author}
                time={item.created_at}
                body={previewText(item.body) || "Attachment"}
                head={<>
                  <span className="font-medium">{who}</span>
                  <span className="truncate text-muted-foreground">in <Place item={item} /></span>
                </>}
                // Orange only while it's due; once it has reminded you, it's a plain note.
                extra={item.remind_at ? (
                  <span className={`mt-1 inline-flex items-center gap-1 text-[12px] ${due ? "font-medium text-[var(--status-warning)]" : "text-muted-foreground"}`}>
                    <AlarmClock size={14} aria-hidden="true" />
                    {item.reminded_at ? "Reminder sent" : due ? "Reminder due" : "Reminder"} · {formatChatTime(item.remind_at, "at")}
                  </span>
                ) : null}
                tabStop={rows.stop(key, index)}
                onFocusRow={() => rows.onFocusRow(key)}
                aside={
                  <div className="flex flex-none items-start gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger tabIndex={rows.stop(key, index) ? 0 : -1} className="nb-icon-button size-8 pointer-coarse:size-11" aria-label={`Remind me about ${who}'s message`} title="Remind me">
                        <AlarmClock size={16} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {laterTimes("remind").map((option) => <DropdownMenuItem key={option.label} onSelect={() => void act(item, true, option.at())}><Clock /> {option.label}</DropdownMenuItem>)}
                        <DropdownMenuItem onSelect={() => setCustomFor({ item, at: new Date(Date.now() + 2 * 60 * 60_000) })}><CalendarClock /> Custom time…</DropdownMenuItem>
                        {item.remind_at ? <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void act(item, true, null, true)}><X /> Clear reminder</DropdownMenuItem></> : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button type="button" tabIndex={rows.stop(key, index) ? 0 : -1} onClick={() => void act(item, false)} className="nb-icon-button size-8 pointer-coarse:size-11" aria-label={`Done with ${who}'s message (remove from Saved)`} title="Done">
                      <Check size={16} />
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
  // New message drafts are keyed "new" or "new-<people>" (one per set of recipients).
  const isNew = (channelId: string) => channelId === "new" || channelId.startsWith("new-");
  const left = (channelId: string) => !isNew(channelId) && Boolean(data) && !data?.channels.some((c) => c.id === channelId);
  const titleOf = (channelId: string) => {
    if (isNew(channelId)) return "New message";
    const channel = data?.channels.find((c) => c.id === channelId);
    if (!channel) return "a conversation";
    const title = channelTitle(channel, meId);
    return isDirectLike(channel) || isApplicationThread(channel) ? title : `#${title}`;
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
      // Cancelling must not lose the text: the action keeps it as a draft (it says so: it isn't an Undo).
      toast.success("Scheduled message canceled", {
        action: {
          label: "Keep as draft",
          onClick: () => {
            keepAsDraft({ channelId: undoable.channel_id, threadRootSeq: undoable.thread_root_seq, body: undoable.body });
            toast.success("Kept as a draft");
          },
        },
      });
    }
  };
  const discard = (draft: { key: string; body: string }) => {
    writeDraft(draft.key, "");
    toast.success("Draft discarded", { action: { label: "Undo", onClick: () => writeDraft(draft.key, draft.body) } });
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
    toast.success("Message rescheduled", { description: feedbackDate(at) });
  };
  const nothingScheduled = scheduled.data && !scheduled.data.length;
  // Decided from loaded data only, so the section never flashes a skeleton and then disappears.
  const showScheduled = scheduled.isError || Boolean(scheduled.data && (scheduled.data.length || !drafts.length));
  return (
    <ViewScreen title="Drafts and scheduled">
      <section aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className="nb-micro flex items-center gap-2 border-b border-border px-4 py-2"><Pencil size={14} aria-hidden="true" /> Drafts on this device</h2>
        {!drafts.length ? <p className="border-b border-border px-4 py-4 text-[13px] text-muted-foreground">No drafts. Anything you start typing and leave is kept here.</p> : null}
        <ul>
          {sortedDrafts.map((draft) => (
            <li key={draft.key} className="flex gap-3 border-b border-border px-4 py-3">
              {left(draft.channelId) ? (
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-muted-foreground">Left conversation</p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] text-muted-foreground">{previewText(draft.body)}</p>
                </div>
              ) : (
                <Link href={isNew(draft.channelId) ? "/messages/new" : draft.threadRootSeq ? threadHref(draft.channelId, draft.threadRootSeq) : conversationHref(draft.channelId)} className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{draft.threadRootSeq ? "Thread in " : ""}{titleOf(draft.channelId)}</p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] text-muted-foreground">{previewText(draft.body)}</p>
                </Link>
              )}
              <button type="button" onClick={() => discard(draft)} className="nb-icon-button size-8 flex-none hover:text-destructive pointer-coarse:size-11" aria-label={`Discard draft in ${titleOf(draft.channelId)}`} title="Discard"><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      </section>
      {/* With drafts on screen, an empty Scheduled section is just noise. */}
      {!showScheduled ? null : (
        <section aria-labelledby="scheduled-heading">
          <h2 id="scheduled-heading" className="nb-micro flex items-center gap-2 border-b border-border px-4 py-2"><Clock size={14} aria-hidden="true" /> Scheduled</h2>
          {scheduled.isError ? <ListError what="Scheduled messages" query={scheduled} /> : null}
          {nothingScheduled ? <p className="border-b border-border px-4 py-4 text-[13px] text-muted-foreground">Nothing scheduled. Use the arrow next to Send to send a message later.</p> : null}
          <ul>
            {(scheduled.data ?? []).map((item) => (
              <li key={item.id} className="flex gap-3 border-b border-border px-4 py-3">
                <Link href={item.thread_root_seq ? threadHref(item.channel_id, item.thread_root_seq) : conversationHref(item.channel_id)} className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-[13px]">
                    <span className="font-medium">To {item.channel_name ? `#${item.channel_name}` : titleOf(item.channel_id)}</span>
                    <span className={item.failed_reason ? "text-destructive" : "text-muted-foreground"}>
                      {/* Yours to someone you blocked were cancelled by the block (Blocking B16); only you ever see this. */}
                      {item.failed_reason === "cancelled_by_block" ? `Canceled because you blocked ${titleOf(item.channel_id)}`
                        : item.failed_reason ? `Couldn’t send: ${chatErrorMessage(item.failed_reason)}` : formatChatTime(item.send_at, "at")}
                    </span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[15px]">{previewText(item.body)}</p>
                </Link>
                <div className="flex flex-none items-start gap-1">
                  <Button type="button" variant="outline" size="sm" disabled={busy === item.id} onClick={() => void sendNow(item.id)} className="pointer-coarse:h-11">
                    {busy === item.id ? "Sending…" : item.failed_reason ? "Retry" : "Send now"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="nb-icon-button size-8 pointer-coarse:size-11" aria-label="More for this scheduled message">
                      <MoreHorizontal size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onSelect={() => setRescheduling({ id: item.id, at: new Date(Math.max(Date.parse(item.send_at), Date.now() + 60 * 60_000)) })}><CalendarClock /> Reschedule…</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void cancel(item.id, { channelId: item.channel_id, threadRootSeq: item.thread_root_seq, body: item.body })}><Pencil /> Edit as draft</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void cancel(item.id, undefined, item)}><Trash2 /> Cancel scheduled message</DropdownMenuItem>
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
  return <>{text.split(pattern).map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-accent px-0.5 font-medium text-foreground">{part}</mark> : part))}</>;
}

/** From: anyone you could message, searched by name (not only people in your DM list). */
function FromPicker({ value, label, meId, onPick }: { value: string; label: string | null; meId: string | null; onPick: (person: { id: string; name: string } | null) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const people = usePeopleSearch(query, open);
  if (value) {
    return (
      // A filter that's on: the selected-filter look (ink fill), like Has file and the Inbox tabs.
      <span className="inline-flex h-[var(--ui-control-height)] items-center gap-1 rounded-md bg-foreground pl-3 text-[13px] text-background pointer-coarse:h-11">
        From: {label ?? "someone"}
        <button type="button" onClick={() => onPick(null)} className="grid size-7 place-items-center rounded-sm hover:bg-background/20 pointer-coarse:size-11" aria-label="Clear from"><X size={14} /></button>
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
        className="h-[var(--ui-control-height)] w-40 rounded-md border border-input bg-card px-3 text-[13px] outline-none focus:border-ring pointer-coarse:h-11"
      />
      {open && options.length ? (
        <ul id="search-from-options" role="listbox" className="absolute left-0 top-full z-30 mt-1 max-h-60 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
          {options.slice(0, 8).map((option) => (
            <li key={option.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); onPick(option); }} className="flex min-h-[34px] cursor-pointer items-center rounded-md px-2 text-[13px] hover:bg-muted pointer-coarse:min-h-11">{option.name}</li>
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
    const list = (data?.channels ?? []).filter(isVisible).map((c) => ({ id: c.id, title: isDirectLike(c) || isApplicationThread(c) ? channelTitle(c, meId) : `#${channelTitle(c, meId)}`, at: c.last_message_at ?? "" }));
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
  const control = "h-[var(--ui-control-height)] rounded-md border border-input bg-card px-2 text-[13px] pointer-coarse:h-11";
  const filtered = Boolean(inChannel || from || hasFile || after || before);
  const rows = useRowTabStop();
  return (
    <ViewScreen title="Search" closable>
      <form
        className="space-y-2 border-b border-border p-3 sm:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft.trim() || null });
        }}
      >
        {/* The app's search field (as on Network): icon, a tall field, and a clear ×. Enter searches. */}
        <label className="relative block">
          <span className="sr-only">Search messages</span>
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus type="search" enterKeyHint="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search messages" className="h-[var(--ui-control-height-lg)] pl-9 pr-10" />
          {draft ? (
            <button type="button" onClick={() => { setDraft(""); set({ q: null }); }} aria-label="Clear search" className="nb-icon-button absolute right-1.5 top-1/2 size-8 -translate-y-1/2 pointer-coarse:size-11"><X size={16} /></button>
          ) : null}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={inChannel || "everywhere"} onValueChange={(value) => set({ in: value === "everywhere" ? null : value })}>
            <SelectTrigger aria-label="In" className={`w-auto max-w-[240px] text-[13px] pointer-coarse:h-11 ${inChannel ? "border-foreground bg-foreground text-background" : ""}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="everywhere">In: everywhere</SelectItem>
              <SelectGroup>
                <SelectLabel>Recent</SelectLabel>
                {conversations.recent.map((c) => <SelectItem key={c.id} value={c.id}>In: {c.title}</SelectItem>)}
              </SelectGroup>
              {conversations.rest.length ? (
                <SelectGroup>
                  <SelectLabel>All conversations</SelectLabel>
                  {conversations.rest.map((c) => <SelectItem key={c.id} value={c.id}>In: {c.title}</SelectItem>)}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
          <FromPicker value={from} label={fromLabel} meId={meId} onPick={(person) => set({ from: person?.id ?? null, fromName: person && person.id !== meId ? person.name : null })} />
          {/* Selected filter = ink fill (spec), the same look everywhere. */}
          <button type="button" aria-pressed={hasFile} onClick={() => set({ has: hasFile ? null : "file" })} className={`inline-flex items-center gap-1.5 ${control} px-3 ${hasFile ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
            <Paperclip size={14} /> Has file
          </button>
          <label className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">After <input type="date" value={after} onChange={(e) => set({ after: e.target.value || null })} className={control} /></label>
          <label className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">Before <input type="date" value={before} onChange={(e) => set({ before: e.target.value || null })} className={control} /></label>
          {filtered ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ in: null, from: null, fromName: null, has: null, after: null, before: null })} className="pointer-coarse:h-11">Clear filters</Button>
          ) : null}
        </div>
      </form>
      {tooShort && !active ? <Empty icon={Search} title="Type at least 2 characters" /> : !active ? <Empty icon={Search} title="Search your messages">Words in every conversation you’re in. Narrow it down with In, From, Has file and dates.</Empty> : null}
      {resultPages.isLoading ? <ListSkeleton header={false} label="Searching" rows={4} /> : null}
      {resultPages.isError && !results ? <ListError what="Search results" detail={chatErrorMessage(resultPages.error.message)} query={resultPages} /> : null}
      {results && !results.length ? <Empty icon={Search} title="No messages match">{filtered ? "Try fewer filters." : "Try other words."}</Empty> : null}
      {results?.length ? <p className="nb-meta px-4 pt-3">{resultPages.hasNextPage ? `Newest ${results.length} results` : `${results.length} result${results.length === 1 ? "" : "s"}`}</p> : null}
      <ul aria-label="Search results" onKeyDown={rowKeys}>
        {(results ?? []).map((hit: SearchHit, index) => {
          const key = `${hit.channel_id}:${hit.seq}`;
          return (
            <li key={key} className="border-b border-border">
              <SnippetRow
                href={messageHref(hit.channel_id, hit.seq, hit.thread_root_seq)}
                target={{ channelId: hit.channel_id, rootSeq: hit.thread_root_seq, m: hit.seq }}
                author={hit.author}
                time={hit.created_at}
                body={<Highlighted text={previewText(hit.body)} query={q} />}
                tabStop={rows.stop(key, index)}
                onFocusRow={() => rows.onFocusRow(key)}
                head={<>
                  <span className="font-medium">{personName(hit.author)}</span>
                  <span className="truncate text-muted-foreground">in <Place item={{ ...hit, channel_title: titleOf(hit.channel_id) }} />{hit.thread_root_seq ? " · thread" : ""}</span>
                  {hit.has_file ? <Paperclip size={14} aria-label="Has a file" className="text-muted-foreground" /> : null}
                </>}
              />
            </li>
          );
        })}
      </ul>
      {resultPages.isError && results ? <MoreError onRetry={() => void resultPages.fetchNextPage()} /> : null}
      <LoadMore hasMore={Boolean(resultPages.hasNextPage) && !resultPages.isError} loading={resultPages.isFetchingNextPage} onLoad={() => void resultPages.fetchNextPage()} />
    </ViewScreen>
  );
}
