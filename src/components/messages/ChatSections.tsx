"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bell, BellOff, Bookmark, CheckCheck, ChevronDown, Compass, FolderOpen, House, Inbox, Keyboard, LayoutGrid, Link2, ListFilter, LogOut, MailOpen, MoreHorizontal, Pencil, Plus, Search, Settings, SquarePen, Star, StarOff, UserPlus, X } from "lucide-react";
import { toast } from "@/lib/feedback";

import { getOrCreateDm, setMemberState } from "@/app/actions/chat/members";
import { listScheduled } from "@/app/actions/chat/later";
import { markRead } from "@/app/actions/chat/read";
import { markUnread } from "@/app/actions/chat/messages";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { readChatUi, saveAccountUi, useChatUi, useDrafts } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { ProjectBadge } from "@/components/projects/ProjectBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PresenceAvatar, ProjectPresenceBadge } from "@/components/presence/PersonPresence";
import { usePersonPresence } from "@/components/presence/usePresence";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import {
  DM_SIDEBAR_LIMIT, attention, channelTitle, channelsByProject, counterpart, formatChatTime, fullTime, isApplicationThread, isDirectLike, isSelfDm, isUnread, needsAttention,
  projectBadges, projectsByActivity, rowCount, sectionsFor, swipeButtons, workspaceBadges,
} from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE, isDecidedApplication } from "@/lib/messaging/application-status";
import type { ChatChannelSummary, ChatNotify } from "@/lib/messaging/types";
import { copyWithToast } from "@/lib/clipboard";
import { conversationHref } from "@/lib/messaging/routes";
import { childProjectsOf, workspaceProjects } from "@/lib/organizations/chat-rules";
import { OrgBrowseProjects } from "@/components/messages/OrgBrowseProjects";
import { ConversationIcon } from "@/components/messages/ConversationIcon";
import { useConversationExit } from "@/components/messages/useConversationExit";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { keyLabel } from "@/components/messages/keys";
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

function ChannelIcon({ channel }: { channel: ChatChannelSummary }) {
  if (channel.kind === "dm") {
    return <PresenceAvatar identity={channel.dm_user} userId={channel.dm_user?.id} size={20} title="" />;
  }
  // An application thread shows the person on the other side, like a DM: the applicant to reviewers, the lead to the applicant.
  const other = counterpart(channel);
  if (other) return <PresenceAvatar identity={other} userId={other.id} size={20} title="" />;
  return <ConversationIcon channel={channel} size={16} aria-hidden="true" className="flex-none" />;
}

/** Like Slack: the status emoji after a DM's name (text in the tooltip); text only if there's no emoji. */
function DmStatus({ userId }: { userId: string }) {
  const { status, statusText } = usePersonPresence(userId);
  if (!status) return null;
  if (status.emoji) return <span role="img" title={statusText || undefined} aria-label={statusText || "Status"} className="flex-none font-[system-ui] text-[13px] leading-none">{status.emoji}</span>;
  return <span className="min-w-0 shrink-[999] truncate text-[13px] font-normal text-muted-foreground">· {statusText}</span>;
}

/**
 * The count: the same neutral badge as the main navigation (.nb-nav-count), capped at 99+.
 * Screen readers hear "3 unread" (or what `noun` says) as part of the row's own text.
 */
function Count({ value, noun = "unread", hidden = false }: { value: number; noun?: string; hidden?: boolean }) {
  if (!value) return null;
  return <span className="nb-chat-count" aria-hidden={hidden || undefined}>{value > 99 ? "99+" : value}{hidden ? null : <span className="sr-only"> {noun}</span>}</span>;
}

function Row({ channel, meId, variant, onSelect, draft }: { channel: ChatChannelSummary; meId: string | null; variant: ChatSectionsVariant; onSelect?: Props["onSelect"]; draft: boolean }) {
  const pathname = usePathname();
  const href = conversationHref(channel.id);
  const current = pathname === href || pathname?.startsWith(`${href}/`);
  const count = rowCount(channel);
  const title = channelTitle(channel, meId);
  const preview = variant === "list" && (isDirectLike(channel) || isApplicationThread(channel));
  // No aria-label: the row reads as what it shows (name, preview, time, count), plus these sr-only notes.
  const draftMark = draft && !current ? <Pencil size={14} aria-hidden="true" className="flex-none text-muted-foreground" /> : null;
  // Bold alone isn't heard: unread rows say so (a count says it already).
  const unread = isUnread(channel) && channel.notify !== "mute" && !count;
  const srNotes = <>{unread ? <span className="sr-only">, unread</span> : null}{draft && !preview ? <span className="sr-only">, draft</span> : null}{channel.notify === "mute" ? <span className="sr-only">, muted</span> : null}</>;
  const body: ReactNode = preview ? (
    <>
      <span className="mt-0.5"><ChannelIcon channel={channel} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{title}</span>
          {channel.last_message_at ? (
            <span className="nb-meta ml-auto flex-none" title={fullTime(channel.last_message_at)}>{formatChatTime(channel.last_message_at)}</span>
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
      <ChannelIcon channel={channel} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate">{title}</span>
        {channel.kind === "dm" && channel.dm_user ? <DmStatus userId={channel.dm_user.id} /> : null}
        {/* Applications span projects, so a reviewer's row says which one. */}
        {channel.application && !channel.application.is_applicant ? <span className="nb-meta min-w-0 shrink-[999] truncate font-normal text-muted-foreground">{channel.application.project_title}</span> : null}
      </span>
      {isDecidedApplication(channel.application?.status) ? (
        <span className="nb-status flex-none" data-status={APPLICATION_STATUS_TONE[channel.application!.status] ?? "archived"}>{APPLICATION_STATUS_LABEL[channel.application!.status]}</span>
      ) : null}
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
  // A finished application can be closed from your list, like a DM; a new message or status line brings it back.
  const closable = direct || (isApplicationThread(channel) && isDecidedApplication(channel.application?.status));
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
  // The row losing its bold is the confirmation (like Esc in a conversation): no toast unless it failed.
  const read = () => {
    applyRead(channel.id, channel.last_seq);
    void markRead({ channelId: channel.id, seq: channel.last_seq }).then((result) => {
      if (result.success) return;
      refresh();
      toast.error(chatErrorMessage(result.error));
    });
  };
  // Back to unread from its newest message, to come back to later.
  const unreadAgain = () => {
    void markUnread({ channelId: channel.id, seq: channel.last_top_seq }).then((result) => {
      if (!result.success) return void toast.error(chatErrorMessage(result.error));
      refresh();
    });
  };
  const copy = () => {
    void copyWithToast(`${window.location.origin}${conversationHref(channel.id)}`, "Link copied");
  };
  const exit = useConversationExit(channel);
  const close = () => void exit.close();
  const leave = async () => {
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
      onConfirm={leave}
    />
  );
  return {
    direct, closable, muted, mute, star, read, unreadAgain, copy, leaveDialog,
    close: () => void close(),
    leave: () => setConfirmLeave(true),
    canLeave: !direct && !channel.is_default && !channel.application_id,
    unread: needsAttention(channel),
    canMarkUnread: !isUnread(channel) && channel.last_top_seq > 0,
  };
}

function RowMenuItems({ channel, actions }: { channel: ChatChannelSummary; actions: ReturnType<typeof useRowActions> }) {
  return (
    <>
      {actions.unread ? <DropdownMenuItem onSelect={actions.read}><CheckCheck /> Mark as read</DropdownMenuItem> : null}
      {actions.canMarkUnread ? <DropdownMenuItem onSelect={actions.unreadAgain}><MailOpen /> Mark as unread</DropdownMenuItem> : null}
      <DropdownMenuItem onSelect={actions.mute}>{actions.muted ? <><Bell /> Unmute</> : <><BellOff /> Mute</>}</DropdownMenuItem>
      <DropdownMenuItem onSelect={actions.star}>{channel.starred ? <><StarOff /> Unstar</> : <><Star /> Star</>}</DropdownMenuItem>
      <DropdownMenuItem onSelect={actions.copy}><Link2 /> Copy link</DropdownMenuItem>
      {actions.closable ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={actions.close}><X /> Close conversation</DropdownMenuItem>
        </>
      ) : actions.canLeave ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={actions.leave}><LogOut /> Leave channel</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * Desktop rows: a ⋯ menu appears on hover or keyboard focus, beside the count (nb-chat-hover makes room).
 * The ⋯ isn't a Tab stop (one stop per row): Shift+F10 or the Menu key on the row opens it.
 */
function HoverMenu({ channel, meId, children }: { channel: ChatChannelSummary; meId: string | null; children: ReactNode }) {
  const actions = useRowActions(channel);
  const [open, setOpen] = useState(false);
  const title = channelTitle(channel, meId);
  return (
    <div
      className="nb-chat-hover group/row relative"
      aria-keyshortcuts="Shift+F10"
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          setOpen(true);
        }
      }}
    >
      {children}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          tabIndex={-1}
          className="nb-icon-button absolute right-1 top-1/2 size-7 -translate-y-1/2 bg-card opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
          aria-label={`Options for ${title} (${keyLabel("shift+f10")})`}
        >
          <MoreHorizontal size={16} />
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
// One swiped-open row at a time: opening one closes the rest (and so does scrolling).
const SWIPE_EVENT = "chat-swipe-open";

function SwipeActions({ channel, meId, children }: { channel: ChatChannelSummary; meId: string | null; children: ReactNode }) {
  const actions = useRowActions(channel);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!offset) return;
    const onOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== channel.id) setOffset(0);
    };
    const onScroll = () => setOffset(0);
    window.addEventListener(SWIPE_EVENT, onOther);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener(SWIPE_EVENT, onOther);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [channel.id, offset]);
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
  const labels = swipeButtons({ unread: actions.unread, muted: actions.muted, direct: actions.closable, starred: channel.starred });
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
          setOffset((current) => {
            const next = current < -width / 2 ? -width : 0;
            if (next) window.dispatchEvent(new CustomEvent(SWIPE_EVENT, { detail: channel.id }));
            return next;
          });
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
        <DropdownMenuTrigger className="nb-icon-button sr-only size-11 flex-none focus:not-sr-only pointer-fine:not-sr-only pointer-fine:size-8 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:data-[state=open]:opacity-100" aria-label={`Actions for ${channelTitle(channel, meId)}`}>
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

function Section({ id, title, count, noun = "unread", collapsed, onToggle, action, children, attention, plainTitle = false }: {
  id: string; title: ReactNode; count?: number; collapsed: boolean; onToggle: (id: string) => void; action?: ReactNode; children: ReactNode;
  /** A project's name: user data, shown as typed (not the uppercase mono label). */
  plainTitle?: boolean;
  /** What the count counts, for screen readers: "mentions" (channels) or "unread conversations". */
  noun?: string;
  /** Rows still shown while collapsed (the ones needing attention). */
  attention?: ReactNode;
}) {
  const headingId = `chat-section-${id}`;
  return (
    <section aria-labelledby={headingId} className="group/section">
      <div className="nb-chat-section-title">
        <h2 className="flex min-w-0 flex-1">
          <button type="button" id={headingId} className="flex min-h-7 min-w-0 flex-1 items-center gap-1 text-left pointer-coarse:min-h-11" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
            <ChevronDown size={14} aria-hidden="true" className={`flex-none ${collapsed ? "-rotate-90" : ""}`} />
            <span className={`truncate ${plainTitle ? "nb-ui-label normal-case tracking-normal text-foreground" : ""}`}>{title}</span>
            {count ? <span className="sr-only">, {count} {noun}</span> : null}
          </button>
        </h2>
        <Count value={count ?? 0} hidden />
        {action}
      </div>
      {/* Collapsed sections still show rows that need attention, like Slack. */}
      {collapsed ? (attention ? <div className="space-y-0.5">{attention}</div> : null) : <div className="space-y-0.5">{children}</div>}
    </section>
  );
}

/** Small icon button in a section header (+, mark read). Always visible on touch, on hover with a mouse. */
function HeaderButton({ label, onClick, children, href }: { label: string; onClick?: () => void; children: ReactNode; href?: string }) {
  const className = "nb-icon-button size-7 flex-none pointer-coarse:size-11 focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/section:opacity-100 pointer-fine:group-focus-within/section:opacity-100";
  if (href) return <Link href={href} prefetch={true} className={className} aria-label={label} title={label}>{children}</Link>;
  return <button type="button" onClick={onClick} className={className} aria-label={label} title={label}>{children}</button>;
}

const noSubscribe = () => () => undefined;
const modKeyHint = () => keyLabel("mod+k");

/**
 * The project switcher, always at the top (Slack's workspace header): the
 * open project, or All projects, with its options beside it.
 */
function ProjectSwitcher({ inPage, unreadsOnly, onToggleUnreads }: { inPage: boolean; unreadsOnly: boolean; onToggleUnreads: () => void }) {
  const { data } = useChatShell();
  const projectId = useSelectedProject();
  const setProject = useChatUi((state) => state.setProject);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const router = useRouter();
  // On the Messages page the project lives in the URL (reload keeps it); the floating window has no URL.
  const pick = (id: string | null) => (inPage ? router.push(id ? `/messages/p/${id}` : "/messages") : setProject(id));
  // Orgs and personal projects get a row; child projects live inside their org (report §25.1).
  const projects = workspaceProjects(projectsByActivity(data));
  const badges = workspaceBadges(data);
  const open = projectsByActivity(data).find((project) => project.id === projectId) ?? null;
  const canManage = open?.role === "owner" || open?.role === "admin";
  // Only with a project open: in All projects every project's count is already on screen.
  const otherUnread = open ? projects.reduce((sum, project) => sum + (project.id === open.id ? 0 : badges.get(project.id) ?? 0), 0) : 0;
  const projectHref = open ? `/${open.kind === "organization" ? "org" : "projects"}/${open.slug ?? open.id}` : "";
  const shortcutHint = useSyncExternalStore(noSubscribe, () => modKeyHint().replace("K", "/"), () => "⌘/");

  return (
    <div className="flex items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="nb-chat-row min-w-0 flex-1 font-semibold text-foreground" aria-label={`${open ? open.title : "All projects"}, switch project${otherUnread ? ", unread in other projects" : ""}`} data-testid="chat-project-switcher">
          {open ? (
            <span className="relative inline-flex flex-none"><ProjectBadge project={open} size="sm" /><ProjectPresenceBadge projectId={open.id} size={10} className="absolute" style={{ right: -3, bottom: -3 }} /></span>
          ) : (
            <LayoutGrid size={16} aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{open ? open.title : "All projects"}</span>
          {otherUnread ? <span className="size-2 flex-none rounded-full bg-primary ring-2 ring-card" aria-hidden="true" /> : null}
          <ChevronDown size={14} aria-hidden="true" className="flex-none text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch project</DropdownMenuLabel>
          {/* A radio group: screen readers hear which project is selected. */}
          <DropdownMenuRadioGroup value={open?.id ?? "all"} onValueChange={(value) => pick(value === "all" ? null : value)}>
            <DropdownMenuRadioItem value="all">
              <LayoutGrid /> <span className="flex-1">All projects</span>
            </DropdownMenuRadioItem>
            {projects.map((project) => (
              <DropdownMenuRadioItem key={project.id} value={project.id} data-testid={`chat-project-${project.id}`}>
                <span className="relative inline-flex flex-none"><ProjectBadge project={project} size="sm" /><ProjectPresenceBadge projectId={project.id} size={10} className="absolute" style={{ right: -3, bottom: -3 }} /></span>
                <span className="min-w-0 flex-1 truncate">{project.guestOf ? `${project.guestOf} · Viewer` : project.title}</span>
                <Count value={badges.get(project.id) ?? 0} noun="mentions" />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {!projects.length ? <p className="px-2 py-1.5 text-[13px] text-muted-foreground">No projects yet.</p> : null}
          {inPage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/projects/new">Create new project</Link></DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Selected filter = ink fill (spec), the same look as the Inbox's filter tabs. */}
      <button
        type="button"
        onClick={onToggleUnreads}
        aria-pressed={unreadsOnly}
        className={`nb-icon-button size-7 flex-none pointer-coarse:size-11 ${unreadsOnly ? "bg-foreground text-background hover:bg-foreground hover:text-background" : ""}`}
        aria-label="Unread only"
        title={unreadsOnly ? "Showing unread only" : "Show unread only"}
      >
        <ListFilter size={16} />
      </button>
      {/* One ⋯ for the page: the project's options (by role) and the keyboard shortcuts. */}
      {inPage ? (
        <DropdownMenu>
          <DropdownMenuTrigger className={`nb-icon-button size-7 flex-none pointer-coarse:size-11 ${open ? "" : "pointer-coarse:hidden"}`} aria-label={open ? `Options for ${open.title}` : "Messages options"}>
            <MoreHorizontal size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {open && canManage ? <DropdownMenuItem onSelect={() => setInviteFor(open.id)}><UserPlus /> Invite people</DropdownMenuItem> : null}
            {open ? <DropdownMenuItem asChild><Link href={projectHref}><FolderOpen /> View project</Link></DropdownMenuItem> : null}
            {open && canManage ? <DropdownMenuItem asChild><Link href={`${projectHref}?tab=settings`}><Settings /> Project settings</Link></DropdownMenuItem> : null}
            {open ? <DropdownMenuSeparator className="pointer-coarse:hidden" /> : null}
            <DropdownMenuItem className="pointer-coarse:hidden" onSelect={() => useChatUi.getState().setShortcutsOpen(true)}>
              <Keyboard /> Keyboard shortcuts <kbd className="nb-meta ml-auto">{shortcutHint}</kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : open ? (
        // The window: one action only, a plain link, not a menu with one item.
        <Link href={projectHref} className="nb-icon-button size-7 flex-none pointer-coarse:size-11" aria-label={`View ${open.title}`} title="View project">
          <FolderOpen size={16} />
        </Link>
      ) : null}
    </div>
  );
}


/** The list loading: row-shaped placeholders, the same on every screen. */
function SectionsSkeleton() {
  return (
    <div role="status" className="space-y-2 px-1">
      <span className="sr-only">Loading conversations…</span>
      {[70, 55, 80, 45, 60, 50].map((width, row) => (
        <div key={row} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-5 flex-none rounded-sm" />
          <Skeleton className="h-3 rounded-sm" style={{ width: `${width}%` }} />
        </div>
      ))}
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
  // Read on mount (no snap into place after the first paint), then follow the account copy when it loads.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => accountCollapsed ?? readChatUi().collapsed ?? {});
  const [unreadsOnly, setUnreadsOnly] = useState(() => accountUnreads ?? Boolean(readChatUi().unreadsOnly));
  const [synced, setSynced] = useState({ accountCollapsed, accountUnreads });
  if (synced.accountCollapsed !== accountCollapsed || synced.accountUnreads !== accountUnreads) {
    setSynced({ accountCollapsed, accountUnreads });
    if (accountCollapsed) setCollapsed(accountCollapsed);
    if (accountUnreads !== undefined) setUnreadsOnly(accountUnreads);
  }
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
  const [decidedOpen, setDecidedOpen] = useState<Record<string, boolean>>({});
  // An unread DM always shows, however old: "N more" only hides read ones.
  const dmRows = variant === "sidebar" && !allDms ? others.filter((c, i) => i < DM_SIDEBAR_LIMIT || needsAttention(c)) : others;
  const hiddenDms = others.length - dmRows.length;
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
      />
    );
    // The page's list screen swipes; the sidebar and the floating window get the ⋯ menu.
    return variant === "list" && inPage
      ? <SwipeActions key={channel.id} channel={channel} meId={meId}>{element}</SwipeActions>
      : <HoverMenu key={channel.id} channel={channel} meId={meId}>{element}</HoverMenu>;
  };

  if (!data) {
    return loadError ? <ErrorNotice what="Conversations" onRetry={refresh} /> : <SectionsSkeleton />;
  }

  const selfIdentity = profile ? { id: profile.id, username: profile.username, fullName: profile.fullName, avatarUrl: profile.avatarUrl } : null;
  const starred = sections.starred.filter(keep);
  const applications = sections.applications.filter(keep);
  const dmUnread = sections.dms.filter(needsAttention).length;
  // The same rows the Unreads filter shows (needsAttention): the button appears when any of them is unread.
  const projectAttention = (id: string) => (byProject.get(id) ?? []).filter(needsAttention);
  const projectTitle = (id: string) => projects.find((p) => p.id === id)?.title ?? "project";
  const markProjectRead = (id: string) => () => markAll.conversations(projectAttention(id), `Mark ${projectTitle(id)} read`);
  // One Browse row, in the open project's list (the All view has a Browse button per project header).
  const browseRow = (id: string) => inPage && open ? (
    <>
      <Link href={`/messages/p/${id}/browse`} className="nb-chat-row text-muted-foreground"><Compass size={16} aria-hidden="true" /><span className="flex-1">Browse channels</span></Link>
      {/* Not only on hover: creating a channel is a row anyone can find. */}
      <button type="button" onClick={() => setCreateFor(id)} className="nb-chat-row text-muted-foreground"><Plus size={16} aria-hidden="true" /><span className="flex-1">Create channel</span></button>
    </>
  ) : null;
  // Decided applications (accepted, declined, withdrawn) fold away, so the list shows what still needs an answer.
  const decidedGroup = (key: string, rows: ChatChannelSummary[]) => {
    if (!rows.length) return null;
    const isOpen = Boolean(decidedOpen[key]) || rows.some(needsAttention);
    return (
      <div>
        <button type="button" className="nb-chat-row text-muted-foreground" aria-expanded={isOpen} onClick={() => setDecidedOpen((current) => ({ ...current, [key]: !isOpen }))}>
          <ChevronDown size={14} aria-hidden="true" className={`flex-none ${isOpen ? "" : "-rotate-90"}`} />
          <span className="flex-1 text-left">Decided ({rows.length})</span>
        </button>
        {isOpen ? rows.map(row) : null}
      </div>
    );
  };
  /** A project's channels (its application threads live in the Applications section). */
  const projectRows = (id: string, channelRows: ChatChannelSummary[]) => {
    const empty = !(byProject.get(id) ?? []).length;
    return (
      <>
        {channelRows.map(row)}
        {empty ? (
          <p className="px-2.5 py-1 text-[13px] text-muted-foreground">
            No channels yet{inPage ? null : <> · <Link href={`/messages/p/${id}/browse`} className="font-medium text-primary hover:underline">Open Messages</Link></>}
          </p>
        ) : null}
        {unreadsOnly ? null : browseRow(id)}
      </>
    );
  };
  const projectActions = (id: string) => (
    <>
      {projectAttention(id).length ? <HeaderButton label={`Mark ${projectTitle(id)} read`} onClick={markProjectRead(id)}><CheckCheck size={16} /></HeaderButton> : null}
      {inPage && !open ? <HeaderButton label="Browse channels" href={`/messages/p/${id}/browse`}><Compass size={16} /></HeaderButton> : null}
      {inPage ? <HeaderButton label="Create channel" onClick={() => setCreateFor(id)}><Plus size={16} /></HeaderButton> : null}
    </>
  );
  const anyProjectRows = [...byProject.values()].flat().some((c) => !c.starred && keep(c));

  return (
    // The app sidebar's rhythm: 20px between groups, a little air between rows.
    <div className="space-y-5">
      <div className="space-y-1">
        <ProjectSwitcher inPage={inPage} unreadsOnly={unreadsOnly} onToggleUnreads={toggleUnreads} />
        {unreadsOnly ? (
          // While the filter is on, say so and offer the way back.
          <p className="flex items-center gap-1.5 px-2.5 text-[12px] text-muted-foreground">
            <ListFilter size={14} aria-hidden="true" /> Showing unread only
            <button type="button" onClick={toggleUnreads} className="ml-auto font-medium text-primary hover:underline pointer-coarse:min-h-11">Show all</button>
          </p>
        ) : null}
      </div>

      {inPage ? (
        <div className="space-y-0.5">
          {/* Below 1024px the list is the home screen: no row linking to the page you're on. */}
          <Link href={open ? `/messages/p/${open.id}` : "/messages"} className="nb-chat-row max-lg:hidden" aria-current={here(open ? `/messages/p/${open.id}` : "/messages")}>
            <House size={16} aria-hidden="true" /><span className="flex-1">Home</span>
          </Link>
          {/* No Jump to… here: the top bar's search finds conversations on this page (same ⌘K). */}
          <Link href="/messages/inbox" className="nb-chat-row" aria-current={here("/messages/inbox")} data-unread={inboxUnread ? "true" : undefined}>
            <Inbox size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
          </Link>
          <Link href="/messages/saved" className="nb-chat-row" aria-current={here("/messages/saved")} data-unread={savedDue ? "true" : undefined}>
            <Bookmark size={16} aria-hidden="true" /><span className="flex-1">Saved</span><Count value={savedDue} noun={savedDue === 1 ? "reminder due" : "reminders due"} />
          </Link>
          {/* Waiting drafts aren't unread: a plain number, not a badge. */}
          <Link href="/messages/drafts" className="nb-chat-row" aria-current={here("/messages/drafts")}>
            <Pencil size={16} aria-hidden="true" /><span className="flex-1">Drafts &amp; scheduled</span>
            {draftCount ? <span className="nb-meta">{draftCount > 99 ? "99+" : draftCount}<span className="sr-only"> waiting</span></span> : null}
          </Link>
        </div>
      ) : (
        <div className="space-y-0.5">
          {/* The window gets the same Jump to… as the page. */}
          <button type="button" className="nb-chat-row" onClick={() => setSwitcherOpen(true)} aria-keyshortcuts="Meta+K Control+K">
            <Search size={16} aria-hidden="true" /><span className="flex-1">Jump to…</span>
            <kbd className="nb-meta font-normal pointer-coarse:hidden">{searchHint}</kbd>
          </button>
          {onInbox ? (
            <button type="button" onClick={onInbox} className="nb-chat-row" data-unread={inboxUnread ? "true" : undefined}>
              <Inbox size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
            </button>
          ) : (
            <Link href="/messages/inbox" className="nb-chat-row" data-unread={inboxUnread ? "true" : undefined}>
              <Inbox size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
            </Link>
          )}
        </div>
      )}

      {applications.length ? (
        <Section id="applications" title="Applications" noun="unread conversations" count={applications.filter(needsAttention).length} collapsed={Boolean(collapsed.applications)} onToggle={toggle} attention={applications.filter(needsAttention).map(row)}>
          {applications.filter((c) => !isDecidedApplication(c.application?.status)).map(row)}
          {decidedGroup("decided:applications", applications.filter((c) => isDecidedApplication(c.application?.status)))}
        </Section>
      ) : null}

      {unreadsOnly && !starred.length && !others.length && !applications.length && (open ? !sections.channels.some(keep) : !anyProjectRows) ? (
        <EmptyState compact icon={CheckCheck} title="You're all caught up" description="Nothing unread here." className="px-3 py-6" />
      ) : null}

      {starred.length ? (
        <Section id="starred" title="Starred" noun="unread conversations" count={starred.filter(needsAttention).length} collapsed={Boolean(collapsed.starred)} onToggle={toggle} attention={starred.filter(needsAttention).map(row)}>{starred.map(row)}</Section>
      ) : null}

      {open && !(unreadsOnly && !sections.channels.some(keep)) ? (
        <Section
          id="channels"
          title="Channels"
          noun="mentions"
          // This list only: starred channels count under Starred.
          count={sections.channels.reduce((sum, c) => sum + attention(c), 0)}
          collapsed={Boolean(collapsed.channels)}
          onToggle={toggle}
          action={projectActions(open.id)}
          attention={sections.channels.filter(needsAttention).map(row)}
        >
          {projectRows(open.id, sections.channels.filter(keep))}
        </Section>
      ) : null}
      {/* An org workspace: each child project is a channel group under Projects (report §25.1, §25.7). */}
      {open && open.kind === "organization" ? (
        <>
          {childProjectsOf(data.projects ?? [], open.id).map((child) => {
            const rows = (byProject.get(child.id) ?? []).filter((c) => !c.starred).filter(keep);
            if (unreadsOnly && !rows.length) return null;
            return (
              <Section
                key={child.id}
                id={`project:${child.id}`}
                title={<span className="inline-flex items-center gap-1.5"><ProjectBadge project={child} size="sm" />{child.title}</span>}
                plainTitle
                count={rows.reduce((sum, c) => sum + attention(c), 0)}
                noun="mentions"
                collapsed={Boolean(collapsed[`project:${child.id}`])}
                onToggle={toggle}
                attention={rows.filter(needsAttention).map(row)}
              >
                {rows.map(row)}
              </Section>
            );
          })}
          {(open.role === "owner" || open.role === "admin") && !unreadsOnly ? <OrgBrowseProjects orgId={open.id} onOpen={(channelId) => (onSelect ? onSelect(channelId) : router.push(conversationHref(channelId)))} onJoined={() => void refresh()} /> : null}
        </>
      ) : null}
      {open ? null : projects.length ? (
        projects.map((project) => {
          const all = (byProject.get(project.id) ?? []).filter((c) => !c.starred);
          const rows = all.filter(keep);
          if (unreadsOnly && !rows.length) return null;
          // This header's rows only: starred channels count under Starred.
          const count = all.reduce((sum, c) => sum + attention(c), 0);
          return (
            <Section
              key={project.id}
              id={`project:${project.id}`}
              title={<span className="inline-flex items-center gap-1.5"><ProjectBadge project={project} size="sm" />{project.title}</span>}
              plainTitle
              count={count}
              noun="mentions"
              collapsed={Boolean(collapsed[`project:${project.id}`])}
              onToggle={toggle}
              action={projectActions(project.id)}
              attention={rows.filter(needsAttention).map(row)}
            >
              {projectRows(project.id, rows)}
            </Section>
          );
        })
      ) : (
        <EmptyState compact icon={LayoutGrid} title="No projects yet" description="Project channels show up here." action={inPage ? <Link href="/projects/new" className="text-[13px] font-medium text-primary hover:underline">Create a project</Link> : undefined} className="px-3 py-6" />
      )}

      {unreadsOnly && !others.length && !(self && needsAttention(self)) ? null : (
      <Section
        id="dms"
        title="Direct messages"
        count={dmUnread}
        noun="unread conversations"
        collapsed={Boolean(collapsed.dms)}
        onToggle={toggle}
        attention={others.filter(needsAttention).map(row)}
        action={onNewMessage
          ? <HeaderButton label="New message" onClick={onNewMessage}><SquarePen size={16} /></HeaderButton>
          : <HeaderButton label="New message" href="/messages/new"><SquarePen size={16} /></HeaderButton>}
      >
        {meId && !sections.starred.some((c) => isSelfDm(c, meId)) && (!unreadsOnly || (self && needsAttention(self))) ? (
          self ? row(self) : (
            <button type="button" className="nb-chat-row" onClick={() => void openSelf()} aria-label="You">
              <UserAvatar identity={selfIdentity} size={20} /><span>You</span>
            </button>
          )
        ) : null}
        {dmRows.map(row)}
        {hiddenDms > 0 || allDms && others.length > DM_SIDEBAR_LIMIT ? (
          <button type="button" className="nb-chat-row" aria-expanded={allDms} onClick={() => setAllDms(!allDms)}>
            <span className="pl-6 text-muted-foreground">{allDms ? "Show less" : `${hiddenDms} more direct message${hiddenDms === 1 ? "" : "s"}`}</span>
          </button>
        ) : null}
      </Section>
      )}

      {markAll.dialog}
    </div>
  );
}
