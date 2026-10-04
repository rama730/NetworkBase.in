"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bookmark, Check, CheckCheck, ChevronDown, FileText, Hash, House, Inbox, LayoutGrid, ListFilter, MoreHorizontal, Pencil, Plus, Search, Settings, SquarePen, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { getOrCreateDm, setMemberState } from "@/app/actions/chat/members";
import { listScheduled } from "@/app/actions/chat/later";
import { markRead } from "@/app/actions/chat/read";
import { readChatUi, saveAccountUi, useChatUi, useDrafts } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { ProjectBadge } from "@/components/projects/ProjectBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonPresenceBadge, ProjectPresenceBadge } from "@/components/presence/PersonPresence";
import { usePersonPresence } from "@/components/presence/usePresence";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/hooks/useOnlineUsers";
import {
  DM_SIDEBAR_LIMIT, channelTitle, channelsByProject, formatChatTime, isDirectLike, isSelfDm, isUnread, needsAttention,
  projectBadges, projectsByActivity, rowCount, sectionsFor, swipeButtons,
} from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatChannelSummary, ChatNotify } from "@/lib/messaging/types";
import { copyWithToast } from "@/lib/clipboard";
import { conversationHref } from "@/lib/messaging/routes";
import { ConversationIcon } from "@/components/messages/ConversationIcon";
import { useConversationExit } from "@/components/messages/useConversationExit";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { MARK_ALL_LABEL } from "@/lib/messaging/channel-view";
import { queryKeys } from "@/lib/query-keys";

export type ChatSectionsVariant = "sidebar" | "list";

type Props = {
  variant: ChatSectionsVariant;
  /** Launcher: open in the window instead of navigating. */
  onSelect?: (channelId: string) => void;
  onNewMessage?: () => void;
  /** Launcher: open the Inbox in the window. */
  onInbox?: () => void;
};

function ChannelIcon({ channel, meId, online }: { channel: ChatChannelSummary; meId: string | null; online?: boolean }) {
  if (channel.kind === "dm") {
    return (
      <span className="relative inline-flex flex-none">
        <UserAvatar identity={channel.dm_user} size={20} roundedClassName="rounded-[3px]" />
        {channel.dm_user ? (
          // Chat's realtime presence marks the first few Active now at once; the rest come from the batch.
          <PersonPresenceBadge userId={channel.dm_user.id} live={channel.dm_user.id === meId || online} size={10} className="absolute" style={{ right: -3, bottom: -3 }} />
        ) : null}
      </span>
    );
  }
  return <ConversationIcon channel={channel} size={16} aria-hidden="true" className="flex-none" />;
}

/** Like Slack: the status emoji after a DM's name (text in the tooltip); text only if there's no emoji. */
function DmStatus({ userId }: { userId: string }) {
  const { status, statusText } = usePersonPresence(userId);
  if (!status) return null;
  if (status.emoji) return <span title={statusText || undefined} aria-label={statusText || undefined} className="flex-none font-[system-ui] text-[13px] leading-none">{status.emoji}</span>;
  return <span className="min-w-0 shrink-[999] truncate text-[13px] font-normal text-muted-foreground">· {statusText}</span>;
}

/** The count pill; screen readers hear "3 unread" (or what `noun` says) as part of the row's own text. */
function Count({ value, noun = "unread" }: { value: number; noun?: string }) {
  return value ? <span className="nb-chat-count">{value > 99 ? "99+" : value}<span className="sr-only"> {noun}</span></span> : null;
}

function Row({ channel, meId, variant, onSelect, online, draft }: { channel: ChatChannelSummary; meId: string | null; variant: ChatSectionsVariant; onSelect?: Props["onSelect"]; online?: boolean; draft: boolean }) {
  const pathname = usePathname();
  const href = conversationHref(channel.id);
  const current = pathname === href || pathname?.startsWith(`${href}/`);
  const count = rowCount(channel);
  const title = channelTitle(channel, meId);
  const preview = variant === "list" && isDirectLike(channel);
  // No aria-label: the row reads as what it shows (name, preview, time, count), plus these sr-only notes.
  const draftMark = draft && !current ? <Pencil size={12} aria-hidden="true" className="flex-none text-muted-foreground" /> : null;
  const srNotes = <>{draft && !preview ? <span className="sr-only">, draft</span> : null}{channel.notify === "mute" ? <span className="sr-only">, muted</span> : null}</>;
  const body: ReactNode = preview ? (
    <>
      <span className="mt-0.5"><ChannelIcon channel={channel} meId={meId} online={online} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{title}</span>
          {channel.last_message_at ? (
            <span className="ml-auto flex-none font-mono text-[12px] font-normal text-muted-foreground">{formatChatTime(channel.last_message_at)}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-1 truncate text-[13px] font-normal text-muted-foreground">
          {draftMark}
          <span className="truncate">{draft && !current ? "Draft" : channel.last_preview ? `${channel.last_author_id === meId ? "You: " : ""}${channel.last_preview}` : "No messages yet"}</span>
        </span>
      </span>
      {srNotes}
      <Count value={count} />
    </>
  ) : (
    <>
      <ChannelIcon channel={channel} meId={meId} online={online} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate">{title}</span>
        {channel.kind === "dm" && channel.dm_user ? <DmStatus userId={channel.dm_user.id} /> : null}
      </span>
      {draftMark}
      {srNotes}
      <Count value={count} />
    </>
  );
  const shared = {
    className: `nb-chat-row${preview ? " nb-chat-row-preview" : ""}`,
    "data-unread": isUnread(channel) && channel.notify !== "mute" ? "true" : undefined,
    "data-muted": channel.notify === "mute" ? "true" : undefined,
    "data-testid": `chat-row-${channel.id}`,
  } as const;
  if (onSelect) return <button type="button" {...shared} onClick={() => onSelect(channel.id)}>{body}</button>;
  return <Link href={href} {...shared} aria-current={current ? "page" : undefined}>{body}</Link>;
}

/** Mute, star, mark read, close/leave and copy link: one list for the hover menu, the touch menu and swipe. */
function useRowActions(channel: ChatChannelSummary) {
  const { refresh, applyRead } = useChatShell();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const direct = isDirectLike(channel);
  const muted = channel.notify === "mute";
  const state = async (patch: { notify?: ChatNotify; starred?: boolean; archived?: boolean }) => {
    const result = await setMemberState({ channelId: channel.id, ...patch });
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      return false;
    }
    refresh();
    return true;
  };
  const mute = () => void state({ notify: muted ? "all" : "mute" });
  const star = () => void state({ starred: !channel.starred });
  const read = () => {
    applyRead(channel.id, channel.last_seq);
    void markRead({ channelId: channel.id, seq: channel.last_seq }).then((result) => {
      // Same words for channels, DMs and groups (Esc in a conversation says it too).
      if (result.success) return void toast.success("Conversation marked as read");
      refresh();
      toast.error(chatErrorMessage(result.error));
    });
  };
  const copy = () => {
    void copyWithToast(`${window.location.origin}${conversationHref(channel.id)}`, "Link copied");
  };
  const exit = useConversationExit(channel);
  const close = () => void exit.close();
  const leave = async () => {
    setConfirmLeave(false);
    await exit.leave();
  };
  const leaveDialog = (
    <ConfirmDialog
      open={confirmLeave}
      onOpenChange={setConfirmLeave}
      title={`Leave #${channel.name}?`}
      description={channel.kind === "private" ? "You'll need an invite to come back." : "You can rejoin a public channel at any time."}
      confirmLabel="Leave"
      variant="destructive"
      onConfirm={() => void leave()}
    />
  );
  return {
    direct, muted, mute, star, read, copy, leaveDialog,
    close: () => void close(),
    leave: () => setConfirmLeave(true),
    canLeave: !direct && !channel.is_default && !channel.application_id,
    unread: needsAttention(channel),
  };
}

function RowMenuItems({ channel, actions }: { channel: ChatChannelSummary; actions: ReturnType<typeof useRowActions> }) {
  return (
    <>
      {actions.unread ? <DropdownMenuItem onSelect={actions.read}><CheckCheck size={14} /> Mark as read</DropdownMenuItem> : null}
      <DropdownMenuItem onSelect={actions.mute}>{actions.muted ? "Unmute" : "Mute"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={actions.star}>{channel.starred ? "Unstar" : "Star"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={actions.copy}>Copy link</DropdownMenuItem>
      {actions.direct ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={actions.close}>Close conversation</DropdownMenuItem>
        </>
      ) : actions.canLeave ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={actions.leave}>Leave channel</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/** Desktop rows: a ⋯ menu appears on hover or keyboard focus, beside the count (nb-chat-hover makes room). */
function HoverMenu({ channel, children }: { channel: ChatChannelSummary; children: ReactNode }) {
  const actions = useRowActions(channel);
  const title = channel.name ?? "conversation";
  return (
    <div className="nb-chat-hover group/row relative">
      {children}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[4px] bg-card text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
          aria-label={`Options for ${title}`}
        >
          <MoreHorizontal size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <RowMenuItems channel={channel} actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
      {actions.leaveDialog}
    </div>
  );
}

const SWIPE_BUTTON = 72;
const LONG_PRESS_MS = 500;

/**
 * List rows on touch (B12): swipe left for Read, Mute and Close (DMs) or Star (channels);
 * long-press opens the full menu. The ⋯ stays for keyboards and screen readers (shown on focus).
 */
function SwipeActions({ channel, children }: { channel: ChatChannelSummary; children: ReactNode }) {
  const actions = useRowActions(channel);
  const [offset, setOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const run = (action: () => void) => () => {
    setOffset(0);
    action();
  };
  const labels = swipeButtons({ unread: actions.unread, muted: actions.muted, direct: actions.direct, starred: channel.starred });
  const handlers: Record<string, () => void> = {
    Read: actions.read, Mute: actions.mute, Unmute: actions.mute, Close: actions.close, Star: actions.star, Unstar: actions.star,
  };
  const tones: Record<string, string> = {
    Read: "bg-accent text-accent-foreground", Mute: "bg-secondary text-foreground", Unmute: "bg-secondary text-foreground",
  };
  const width = labels.length * SWIPE_BUTTON;
  return (
    <div className="nb-chat-swipe group/row flex items-center">
      <div className="nb-chat-swipe-actions" aria-hidden={offset === 0}>
        {labels.map((label) => (
          <button key={label} type="button" tabIndex={offset ? 0 : -1} className={tones[label] ?? "bg-[var(--status-warning-soft)] text-[var(--status-warning)]"} onClick={run(handlers[label]!)}>{label}</button>
        ))}
      </div>
      <div
        className="nb-chat-swipe-row min-w-0 flex-1 [-webkit-touch-callout:none]"
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (!touch) return;
          start.current = { x: touch.clientX, y: touch.clientY, base: offset };
          moved.current = false;
          pressed.current = false;
          cancelPress();
          pressTimer.current = setTimeout(() => {
            pressed.current = true;
            setOffset(0);
            setMenuOpen(true);
          }, LONG_PRESS_MS);
        }}
        onTouchMove={(e) => {
          const touch = e.touches[0];
          if (!start.current || !touch) return;
          const dx = touch.clientX - start.current.x;
          if (Math.abs(dx) > 8 || Math.abs(touch.clientY - start.current.y) > 8) cancelPress();
          if (!moved.current && Math.abs(dx) < Math.abs(touch.clientY - start.current.y)) return;
          moved.current = moved.current || Math.abs(dx) > 8;
          setOffset(Math.max(-width, Math.min(0, start.current.base + dx)));
        }}
        onTouchEnd={() => {
          cancelPress();
          start.current = null;
          setOffset((current) => (current < -width / 2 ? -width : 0));
        }}
        onClickCapture={(e) => {
          if (moved.current || offset || pressed.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
            pressed.current = false;
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger className="sr-only grid size-11 flex-none place-items-center rounded-[5px] text-muted-foreground focus:not-sr-only" aria-label={`Actions for ${channel.name ?? "conversation"}`}>
          <MoreHorizontal size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <RowMenuItems channel={channel} actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
      {actions.leaveDialog}
    </div>
  );
}

function Section({ id, title, count, collapsed, onToggle, action, children }: {
  id: string; title: ReactNode; count?: number; collapsed: boolean; onToggle: (id: string) => void; action?: ReactNode; children: ReactNode;
}) {
  const headingId = `chat-section-${id}`;
  return (
    <section aria-labelledby={headingId} className="group/section">
      <div className="nb-chat-section-title">
        <h2 className="flex min-w-0 flex-1">
          <button type="button" id={headingId} className="flex min-h-7 min-w-0 flex-1 items-center gap-1 text-left" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
            <ChevronDown size={12} aria-hidden="true" className={`flex-none ${collapsed ? "-rotate-90" : ""}`} />
            <span className="truncate">{title}</span>
            {count ? <span className="sr-only">, {count} unread</span> : null}
          </button>
        </h2>
        {count ? <span className="nb-chat-count" aria-hidden="true">{count}</span> : null}
        {action}
      </div>
      {collapsed ? null : <div className="space-y-px">{children}</div>}
    </section>
  );
}

/** Small icon button in a section header (+, mark read). Always visible on touch, on hover with a mouse. */
function HeaderButton({ label, onClick, children, href }: { label: string; onClick?: () => void; children: ReactNode; href?: string }) {
  const className = "grid size-6 flex-none place-items-center rounded-[4px] pointer-coarse:size-11 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/section:opacity-100 pointer-fine:group-focus-within/section:opacity-100";
  if (href) return <Link href={href} prefetch={true} className={className} aria-label={label} title={label}>{children}</Link>;
  return <button type="button" onClick={onClick} className={className} aria-label={label} title={label}>{children}</button>;
}

const noSubscribe = () => () => undefined;
const modKeyHint = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");

/**
 * The project switcher, always at the top (Slack's workspace header): the
 * open project, or All projects, with its options beside it.
 */
function ProjectSwitcher({ inPage, unreadsOnly, onToggleUnreads }: { inPage: boolean; unreadsOnly: boolean; onToggleUnreads: () => void }) {
  const shortcutHint = useSyncExternalStore(noSubscribe, () => modKeyHint().replace("K", "/"), () => "⌘/");
  const { data } = useChatShell();
  const projectId = useSelectedProject();
  const setProject = useChatUi((state) => state.setProject);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const router = useRouter();
  // On the Messages page the project lives in the URL (reload keeps it); the floating window has no URL.
  const pick = (id: string | null) => (inPage ? router.push(id ? `/messages/p/${id}` : "/messages") : setProject(id));
  const projects = projectsByActivity(data);
  const badges = projectBadges(data);
  const open = projects.find((project) => project.id === projectId) ?? null;
  const canManage = open?.role === "owner" || open?.role === "admin";
  const otherUnread = projects.reduce((sum, project) => sum + (project.id === open?.id ? 0 : badges.get(project.id) ?? 0), 0);

  return (
    <div className="flex items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="nb-chat-row min-w-0 flex-1 font-semibold text-foreground" aria-label={`${open ? open.title : "All projects"}, switch project`} data-testid="chat-project-switcher">
          {open ? (
            <span className="relative inline-flex flex-none"><ProjectBadge project={open} size="sm" /><ProjectPresenceBadge projectId={open.id} size={10} className="absolute" style={{ right: -3, bottom: -3 }} /></span>
          ) : (
            <LayoutGrid size={16} aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{open ? open.title : "All projects"}</span>
          {otherUnread ? <span className="size-2 flex-none rounded-full bg-[var(--chat-accent)]" aria-label="Unread in other projects" /> : null}
          <ChevronDown size={14} aria-hidden="true" className="flex-none text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch project</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => pick(null)}>
            <LayoutGrid size={14} className="mr-1" /> <span className="flex-1">All projects</span>
            {!open ? <Check size={14} aria-label="Open" className="text-primary" /> : null}
          </DropdownMenuItem>
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => pick(project.id)} data-testid={`chat-project-${project.id}`}>
              <span className="relative inline-flex flex-none"><ProjectBadge project={project} size="sm" /><ProjectPresenceBadge projectId={project.id} size={10} className="absolute" style={{ right: -3, bottom: -3 }} /></span>
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
              <Count value={badges.get(project.id) ?? 0} />
              {project.id === open?.id ? <Check size={14} aria-label="Open" className="ml-auto text-primary" /> : null}
            </DropdownMenuItem>
          ))}
          {!projects.length ? <p className="px-2 py-1.5 text-[13px] text-muted-foreground">No projects yet.</p> : null}
          {inPage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/projects/new">Create new project</Link></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => useChatUi.getState().setShortcutsOpen(true)}>
                Keyboard shortcuts <kbd className="ml-auto font-mono text-[11px] text-muted-foreground">{shortcutHint}</kbd>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={onToggleUnreads}
        aria-pressed={unreadsOnly}
        className={`grid size-7 flex-none place-items-center rounded-[5px] hover:bg-muted hover:text-foreground pointer-coarse:size-11 ${unreadsOnly ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
        aria-label="Unreads only"
        title={unreadsOnly ? "Showing unreads only" : "Show unreads only"}
      >
        <ListFilter size={14} />
      </button>
      {open ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="grid size-7 flex-none place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label={`Options for ${open.title}`}>
            <MoreHorizontal size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {inPage && canManage ? (
              <DropdownMenuItem onSelect={() => setInviteFor(open.id)}><UserPlus size={14} /> Invite people</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild><Link href={`/projects/${open.slug ?? open.id}`}><FileText size={14} /> View project</Link></DropdownMenuItem>
            {inPage && canManage ? (
              <DropdownMenuItem asChild><Link href={`/projects/${open.slug ?? open.id}?tab=settings`}><Settings size={14} /> Project settings</Link></DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}


/** The sectioned list shared by the desktop sidebar, the mobile List screen and the launcher window. */
export function ChatSections({ variant, onSelect, onNewMessage, onInbox }: Props) {
  const { data, loadError, refresh } = useChatShell();
  const { user, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const here = (href: string) => (pathname === href ? "page" as const : undefined);
  const meId = user?.id ?? null;
  const projectId = useSelectedProject();
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const setSwitcherOpen = useChatUi((state) => state.setSwitcherOpen);
  const inPage = !onSelect;
  const markAll = useMarkAllRead();
  const searchHint = useSyncExternalStore(noSubscribe, modKeyHint, () => "⌘K");
  const drafts = useDrafts();
  const scheduled = useQuery({
    queryKey: queryKeys.chat.scheduled(),
    enabled: inPage,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await listScheduled();
      if (!result.success) throw new Error(result.error);
      return result.items;
    },
  });
  const draftCount = drafts.length + (scheduled.data?.length ?? 0);
  const draftChannels = useMemo(() => new Set(drafts.filter((d) => !d.threadRootSeq).map((d) => d.channelId)), [drafts]);
  const account = user?.user_metadata as { chat_sections?: Record<string, boolean>; chat_unreads_only?: boolean } | undefined;
  const accountCollapsed = account?.chat_sections;
  const accountUnreads = account?.chat_unreads_only;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  useEffect(() => {
    setCollapsed(accountCollapsed ?? readChatUi().collapsed ?? {});
    setUnreadsOnly(accountUnreads ?? Boolean(readChatUi().unreadsOnly));
  }, [accountCollapsed, accountUnreads]);
  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      saveAccountUi({ collapsed: next });
      return next;
    });
  };
  const toggleUnreads = () => {
    setUnreadsOnly((current) => {
      saveAccountUi({ unreadsOnly: !current });
      return !current;
    });
  };

  const sections = useMemo(() => sectionsFor(data, projectId), [data, projectId]);
  const projects = projectsByActivity(data);
  const byProject = useMemo(() => channelsByProject(data), [data]);
  const badges = projectBadges(data);
  const open = projects.find((project) => project.id === projectId) ?? null;
  const keep = (channel: ChatChannelSummary) => !unreadsOnly || needsAttention(channel);

  const self = sections.dms.find((c) => isSelfDm(c, meId));
  const others = sections.dms.filter((c) => c !== self).filter(keep);
  // ponytail: "N more" expands the bootstrap's DMs (the 100 most recent) in place; older ones via ⌘K
  // or search. upgrade: page older DMs from the server when someone has more than 100.
  const [allDms, setAllDms] = useState(false);
  const dmRows = variant === "sidebar" && !allDms ? others.slice(0, DM_SIDEBAR_LIMIT) : others;
  const hiddenDms = others.length - dmRows.length;
  const presenceIds = useMemo(
    () => dmRows.filter((c) => c.kind === "dm" && c.dm_user && c.dm_user.id !== meId).slice(0, 3).map((c) => c.dm_user!.id),
    [dmRows, meId],
  );
  const online = useOnlineUsers(presenceIds);
  const inboxUnread = data?.inbox_unread ?? 0;
  const savedDue = data?.saved_due ?? 0;

  // The self-DM ("You (notes to self)") is created on first open.
  const openSelf = async () => {
    if (!meId) return;
    const result = self ? { success: true as const, channelId: self.id } : await getOrCreateDm({ userId: meId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    if (onSelect) onSelect(result.channelId);
    else router.push(conversationHref(result.channelId));
    if (!self) void refresh();
  };
  const row = (channel: ChatChannelSummary) => {
    const element = (
      <Row
        key={channel.id}
        channel={channel}
        meId={meId}
        variant={variant}
        onSelect={onSelect}
        draft={draftChannels.has(channel.id)}
        online={presenceIds.includes(channel.dm_user?.id ?? "") ? online[channel.dm_user!.id] : undefined}
      />
    );
    if (!inPage) return element;
    return variant === "list"
      ? <SwipeActions key={channel.id} channel={channel}>{element}</SwipeActions>
      : <HoverMenu key={channel.id} channel={channel}>{element}</HoverMenu>;
  };

  if (!data) {
    return loadError ? (
      <div role="alert" className="space-y-2 px-2.5 py-3 text-[13px]">
        <p className="text-foreground">Conversations didn&apos;t load.</p>
        <p className="font-mono text-[11px] text-muted-foreground">{loadError}</p>
        <button type="button" onClick={refresh} className="rounded-[5px] border border-border px-3 py-1.5 font-medium">Retry</button>
      </div>
    ) : (
      <p role="status" className="px-2.5 py-3 text-[13px] text-muted-foreground">Loading conversations…</p>
    );
  }

  const selfIdentity = profile ? { id: profile.id, username: profile.username, fullName: profile.fullName, avatarUrl: profile.avatarUrl } : null;
  const starred = sections.starred.filter(keep);
  const myApplications = sections.myApplications.filter(keep);
  const dmUnread = sections.dms.filter(needsAttention).length;
  const markProjectRead = (id: string) => () => markAll.conversations(data.channels.filter((c) => c.project_id === id && isUnread(c)));
  const browseRow = (id: string) => inPage ? (
    <Link href={`/messages/p/${id}/browse`} className="nb-chat-row text-muted-foreground"><Hash size={16} aria-hidden="true" /><span className="flex-1">Browse channels</span></Link>
  ) : null;
  /** A project's channels, then its application threads in their own collapsible group. */
  const projectRows = (id: string, channelRows: ChatChannelSummary[], applicationRows: ChatChannelSummary[]) => {
    const appsKey = `apps:${id}`;
    const empty = !(byProject.get(id) ?? []).length;
    return (
      <>
        {channelRows.map(row)}
        {empty ? <p className="px-2.5 py-1 text-[13px] text-muted-foreground">No channels yet</p> : null}
        {applicationRows.length ? (
          <div className="pt-1">
            <button type="button" className="nb-chat-section-title flex w-full items-center gap-1 text-left" aria-expanded={!collapsed[appsKey]} onClick={() => toggle(appsKey)}>
              <ChevronDown size={12} aria-hidden="true" className={`flex-none ${collapsed[appsKey] ? "-rotate-90" : ""}`} />
              <span className="flex-1">Applications</span>
              <Count value={applicationRows.filter(needsAttention).length} />
            </button>
            {collapsed[appsKey] ? null : applicationRows.map(row)}
          </div>
        ) : null}
        {unreadsOnly ? null : browseRow(id)}
      </>
    );
  };
  const projectActions = (id: string, unread: number) => (
    <>
      {unread ? <HeaderButton label={MARK_ALL_LABEL} onClick={markProjectRead(id)}><CheckCheck size={14} /></HeaderButton> : null}
      {inPage ? <HeaderButton label="Create channel" onClick={() => setCreateFor(id)}><Plus size={14} /></HeaderButton> : null}
    </>
  );
  const anyProjectRows = [...byProject.values()].flat().some((c) => !c.starred && keep(c));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <ProjectSwitcher inPage={inPage} unreadsOnly={unreadsOnly} onToggleUnreads={toggleUnreads} />
        {unreadsOnly ? (
          // While the filter is on, say so and offer the way back.
          <p className="flex items-center gap-1.5 px-2.5 text-[12px] text-muted-foreground">
            <ListFilter size={13} aria-hidden="true" /> Showing unreads only
            <button type="button" onClick={toggleUnreads} className="ml-auto font-medium text-primary hover:underline pointer-coarse:min-h-11">Show all</button>
          </p>
        ) : null}
      </div>

      {inPage ? (
        <div className="space-y-px">
          <Link href={open ? `/messages/p/${open.id}` : "/messages"} className="nb-chat-row" aria-current={here(open ? `/messages/p/${open.id}` : "/messages")}>
            <House size={16} aria-hidden="true" /><span className="flex-1">Home</span>
          </Link>
          <button type="button" className="nb-chat-row" onClick={() => setSwitcherOpen(true)} aria-keyshortcuts="Meta+K Control+K">
            <Search size={16} aria-hidden="true" /><span className="flex-1">Search</span>
            <kbd className="font-mono text-[11px] font-normal text-muted-foreground">{searchHint}</kbd>
          </button>
          <Link href="/messages/inbox" className="nb-chat-row" aria-current={here("/messages/inbox")} data-unread={inboxUnread ? "true" : undefined}>
            <Inbox size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
          </Link>
          <Link href="/messages/saved" className="nb-chat-row" aria-current={here("/messages/saved")}>
            <Bookmark size={16} aria-hidden="true" /><span className="flex-1">Saved</span><Count value={savedDue} noun={savedDue === 1 ? "reminder due" : "reminders due"} />
          </Link>
          <Link href="/messages/drafts" className="nb-chat-row" aria-current={here("/messages/drafts")}>
            <Pencil size={16} aria-hidden="true" /><span className="flex-1">Drafts &amp; scheduled</span><Count value={draftCount} noun="waiting" />
          </Link>
        </div>
      ) : (
        onInbox ? (
          <button type="button" onClick={onInbox} className="nb-chat-row" data-unread={inboxUnread ? "true" : undefined}>
            <Inbox size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
          </button>
        ) : (
          <Link href="/messages/inbox" className="nb-chat-row" data-unread={inboxUnread ? "true" : undefined}>
            <Inbox size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
          </Link>
        )
      )}

      {unreadsOnly && !starred.length && !others.length && !myApplications.length && (open ? ![...sections.channels, ...sections.applications].some(keep) : !anyProjectRows) ? (
        <p className="px-2.5 text-[13px] text-muted-foreground">You&apos;re all caught up.</p>
      ) : null}

      {starred.length ? (
        <Section id="starred" title="Starred" count={starred.filter(needsAttention).length} collapsed={Boolean(collapsed.starred)} onToggle={toggle}>{starred.map(row)}</Section>
      ) : null}

      {open ? (
        <Section
          id="channels"
          title="Channels"
          count={badges.get(open.id) ?? 0}
          collapsed={Boolean(collapsed.channels)}
          onToggle={toggle}
          action={projectActions(open.id, badges.get(open.id) ?? 0)}
        >
          {projectRows(open.id, sections.channels.filter(keep), sections.applications.filter(keep))}
        </Section>
      ) : projects.length ? (
        projects.map((project) => {
          const rows = (byProject.get(project.id) ?? []).filter((c) => !c.starred).filter(keep);
          if (unreadsOnly && !rows.length) return null;
          const count = badges.get(project.id) ?? 0;
          return (
            <Section
              key={project.id}
              id={`project:${project.id}`}
              title={<span className="inline-flex items-center gap-1.5"><ProjectBadge project={project} size="sm" />{project.title}</span>}
              count={count}
              collapsed={Boolean(collapsed[`project:${project.id}`])}
              onToggle={toggle}
              action={projectActions(project.id, count)}
            >
              {projectRows(project.id, rows.filter((c) => !c.application_id), rows.filter((c) => c.application_id))}
            </Section>
          );
        })
      ) : (
        <p className="px-2.5 py-1 text-[13px] text-muted-foreground">
          No projects yet. {inPage ? <Link href="/projects/new" className="font-medium text-primary hover:underline">Create one</Link> : null}
        </p>
      )}

      <Section
        id="dms"
        title="Direct messages"
        count={dmUnread}
        collapsed={Boolean(collapsed.dms)}
        onToggle={toggle}
        action={onNewMessage
          ? <HeaderButton label="New message" onClick={onNewMessage}><SquarePen size={14} /></HeaderButton>
          : <HeaderButton label="New message" href="/messages/new"><SquarePen size={14} /></HeaderButton>}
      >
        {meId && !sections.starred.some((c) => isSelfDm(c, meId)) && (!unreadsOnly || (self && needsAttention(self))) ? (
          self ? row(self) : (
            <button type="button" className="nb-chat-row" onClick={() => void openSelf()} aria-label="You">
              <UserAvatar identity={selfIdentity} size={20} roundedClassName="rounded-[3px]" /><span>You</span>
            </button>
          )
        ) : null}
        {dmRows.map(row)}
        {hiddenDms > 0 || allDms && others.length > DM_SIDEBAR_LIMIT ? (
          <button type="button" className="nb-chat-row" aria-expanded={allDms} onClick={() => setAllDms(!allDms)}>
            <span className="pl-6 text-muted-foreground">{allDms ? "Show less" : `${hiddenDms} more`}</span>
          </button>
        ) : null}
      </Section>

      {myApplications.length ? (
        <Section id="applications" title="My applications" count={myApplications.filter(needsAttention).length} collapsed={Boolean(collapsed.applications)} onToggle={toggle}>
          {myApplications.map(row)}
        </Section>
      ) : null}
      {markAll.dialog}
    </div>
  );
}
