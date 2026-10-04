"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AtSign, Bookmark, Check, CheckCheck, ChevronDown, FileText, Hash, House, Inbox, MoreHorizontal, Pencil, Plus, Settings, SquarePen, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { getOrCreateDm, setMemberState } from "@/app/actions/chat/members";
import { markRead, markReadMany } from "@/app/actions/chat/read";
import { readChatUi, saveCollapsed, useChatUi, useDrafts, writeChatUi } from "@/components/messages/chat-ui-store";
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
  projectBadges, projectsByActivity, rowCount, sectionsFor,
} from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatChannelSummary, ChatNotify } from "@/lib/messaging/types";
import { copyWithToast } from "@/lib/clipboard";
import { conversationHref } from "@/lib/messaging/routes";
import { ConversationIcon } from "@/components/messages/ConversationIcon";
import { useConversationExit } from "@/components/messages/useConversationExit";

export type ChatSectionsVariant = "sidebar" | "list";

type Props = {
  variant: ChatSectionsVariant;
  /** Launcher: open in the window instead of navigating. */
  onSelect?: (channelId: string) => void;
  onNewMessage?: () => void;
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

function Count({ value }: { value: number }) {
  return value ? <span className="nb-chat-count">{value > 99 ? "99+" : value}</span> : null;
}

function Row({ channel, meId, variant, onSelect, online, draft }: { channel: ChatChannelSummary; meId: string | null; variant: ChatSectionsVariant; onSelect?: Props["onSelect"]; online?: boolean; draft: boolean }) {
  const pathname = usePathname();
  const href = conversationHref(channel.id);
  const current = pathname === href || pathname?.startsWith(`${href}/`);
  const count = rowCount(channel);
  const title = channelTitle(channel, meId);
  const preview = variant === "list" && isDirectLike(channel);
  const label = `${title}${count ? `, ${count} unread` : ""}${draft ? ", draft" : ""}`;
  const draftMark = draft && !current ? <Pencil size={12} aria-hidden="true" className="flex-none text-muted-foreground" /> : null;
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
      <Count value={count} />
    </>
  );
  const shared = {
    className: `nb-chat-row${preview ? " nb-chat-row-preview" : ""}`,
    "data-unread": isUnread(channel) && channel.notify !== "mute" ? "true" : undefined,
    "data-muted": channel.notify === "mute" ? "true" : undefined,
    "data-testid": `chat-row-${channel.id}`,
    "aria-label": label,
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
      if (result.success) return;
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

/** Desktop rows: a ⋯ menu appears on hover or focus, over the count. */
function HoverMenu({ channel, children }: { channel: ChatChannelSummary; children: ReactNode }) {
  const actions = useRowActions(channel);
  const title = channel.name ?? "conversation";
  return (
    <div className="group/row relative">
      {children}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[4px] bg-card text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
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

const SWIPE_WIDTH = 216;

/**
 * List rows on touch (B12): swipe left for Mark read, Mute and Archive (DMs)
 * or Star (channels); the same actions sit in an overflow menu for non-swipe users.
 */
function SwipeActions({ channel, children }: { channel: ChatChannelSummary; children: ReactNode }) {
  const actions = useRowActions(channel);
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const run = (action: () => void) => () => {
    setOffset(0);
    action();
  };
  const second = actions.direct
    ? { label: "Archive", run: run(actions.close) }
    : { label: channel.starred ? "Unstar" : "Star", run: run(actions.star) };
  return (
    <div className="nb-chat-swipe group/row flex items-center">
      <div className="nb-chat-swipe-actions" aria-hidden={offset === 0}>
        <button type="button" tabIndex={offset ? 0 : -1} className="bg-accent text-accent-foreground" onClick={run(actions.read)}>Read</button>
        <button type="button" tabIndex={offset ? 0 : -1} className="bg-secondary text-foreground" onClick={run(actions.mute)}>{actions.muted ? "Unmute" : "Mute"}</button>
        <button type="button" tabIndex={offset ? 0 : -1} className="bg-[var(--status-warning-soft)] text-[var(--status-warning)]" onClick={second.run}>{second.label}</button>
      </div>
      <div
        className="nb-chat-swipe-row min-w-0 flex-1"
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (!touch) return;
          start.current = { x: touch.clientX, y: touch.clientY, base: offset };
          moved.current = false;
        }}
        onTouchMove={(e) => {
          const touch = e.touches[0];
          if (!start.current || !touch) return;
          const dx = touch.clientX - start.current.x;
          if (!moved.current && Math.abs(dx) < Math.abs(touch.clientY - start.current.y)) return;
          moved.current = moved.current || Math.abs(dx) > 8;
          setOffset(Math.max(-SWIPE_WIDTH, Math.min(0, start.current.base + dx)));
        }}
        onTouchEnd={() => {
          start.current = null;
          setOffset((current) => (current < -SWIPE_WIDTH / 2 ? -SWIPE_WIDTH : 0));
        }}
        onClickCapture={(e) => {
          if (moved.current || offset) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="grid size-11 flex-none place-items-center rounded-[5px] text-muted-foreground" aria-label={`Actions for ${channel.name ?? "conversation"}`}>
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
        <button type="button" id={headingId} className="flex min-h-7 min-w-0 flex-1 items-center gap-1 text-left" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
          <ChevronDown size={12} aria-hidden="true" className={`flex-none ${collapsed ? "-rotate-90" : ""}`} />
          <span className="truncate">{title}</span>
          {count ? <span className="sr-only">, {count} pending</span> : null}
        </button>
        {count ? <span className="nb-chat-count" aria-hidden="true">{count}</span> : null}
        {action}
      </div>
      {collapsed ? null : <div className="space-y-px">{children}</div>}
    </section>
  );
}

/** Small icon button in a section header (+, mark read). Always visible on touch, on hover with a mouse. */
function HeaderButton({ label, onClick, children, href }: { label: string; onClick?: () => void; children: ReactNode; href?: string }) {
  const className = "grid size-6 flex-none place-items-center rounded-[4px] pointer-coarse:size-11 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/section:opacity-100";
  if (href) return <Link href={href} prefetch={true} className={className} aria-label={label} title={label}>{children}</Link>;
  return <button type="button" onClick={onClick} className={className} aria-label={label} title={label}>{children}</button>;
}

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
            <Hash size={16} aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{open ? open.title : "All projects"}</span>
          {otherUnread ? <span className="size-2 flex-none rounded-full bg-[var(--chat-accent)]" aria-label="Unread in other projects" /> : null}
          <ChevronDown size={14} aria-hidden="true" className="flex-none text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch project</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => pick(null)}>
            <Hash size={14} className="mr-1" /> <span className="flex-1">All projects</span>
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
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className="grid size-7 flex-none place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label={open ? `Options for ${open.title}` : "Options for all projects"}>
          <MoreHorizontal size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem role="menuitemcheckbox" aria-checked={unreadsOnly} onSelect={onToggleUnreads}>
            <CheckCheck size={14} />
            <span className="flex-1">Show unreads only</span>
            {unreadsOnly ? <Check size={14} aria-hidden="true" className="text-primary" /> : null}
          </DropdownMenuItem>
          {open && inPage && canManage ? (
            <DropdownMenuItem onSelect={() => setInviteFor(open.id)}><UserPlus size={14} /> Invite people</DropdownMenuItem>
          ) : null}
          {open ? (
            <DropdownMenuItem asChild><Link href={`/projects/${open.slug ?? open.id}`}><FileText size={14} /> View project</Link></DropdownMenuItem>
          ) : null}
          {open && inPage && canManage ? (
            <DropdownMenuItem asChild><Link href={`/projects/${open.slug ?? open.id}?tab=settings`}><Settings size={14} /> Project settings</Link></DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The sectioned list shared by the desktop sidebar, the mobile List screen and the launcher window. */
export function ChatSections({ variant, onSelect, onNewMessage }: Props) {
  const { data, pending, loadError, refresh, applyRead } = useChatShell();
  const { user, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const here = (href: string) => (pathname === href ? "page" as const : undefined);
  const meId = user?.id ?? null;
  const projectId = useSelectedProject();
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const inPage = !onSelect;
  const drafts = useDrafts();
  const draftChannels = useMemo(() => new Set(drafts.filter((d) => !d.threadRootSeq).map((d) => d.channelId)), [drafts]);
  const accountCollapsed = (user?.user_metadata as { chat_sections?: Record<string, boolean> } | undefined)?.chat_sections;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  useEffect(() => {
    setCollapsed(accountCollapsed ?? readChatUi().collapsed ?? {});
    setUnreadsOnly(Boolean(readChatUi().unreadsOnly));
  }, [accountCollapsed]);
  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      saveCollapsed(next);
      return next;
    });
  };
  const toggleUnreads = () => {
    setUnreadsOnly((current) => {
      writeChatUi({ unreadsOnly: !current });
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
  const channelRows = sections.channels.filter(keep);
  const applicationRows = sections.applications.filter(keep);
  const myApplications = sections.myApplications.filter(keep);
  const projectAdd = (id: string) => inPage ? (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid size-6 flex-none place-items-center rounded-[4px] pointer-coarse:size-11 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/section:opacity-100 data-[state=open]:opacity-100" aria-label="Add channels">
        <Plus size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => setCreateFor(id)}><Plus size={14} /> Create channel</DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={`/messages/p/${id}/browse`}><Hash size={14} /> Browse channels</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  const markProjectRead = (id: string) => () => {
    const unread = data.channels.filter((c) => c.project_id === id && isUnread(c));
    for (const c of unread) applyRead(c.id, c.last_seq);
    void markReadMany({ items: unread.map((c) => ({ channelId: c.id, seq: c.last_seq })) }).then((result) => {
      refresh();
      if (!result.success) toast.error(chatErrorMessage(result.error));
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <ProjectSwitcher inPage={inPage} unreadsOnly={unreadsOnly} onToggleUnreads={toggleUnreads} />
        {unreadsOnly ? (
          // The filter lives in the ⋯ menu; while it's on, say so and offer the way back.
          <p className="flex items-center gap-1.5 px-2.5 text-[12px] text-muted-foreground">
            <CheckCheck size={13} aria-hidden="true" /> Showing unreads only
            <button type="button" onClick={toggleUnreads} className="ml-auto font-medium text-primary hover:underline pointer-coarse:min-h-11">Show all</button>
          </p>
        ) : null}
      </div>

      {inPage ? (
        <div className="space-y-px">
          <Link href={open ? `/messages/p/${open.id}` : "/messages"} className="nb-chat-row" aria-current={here(open ? `/messages/p/${open.id}` : "/messages")}>
            <House size={16} aria-hidden="true" /><span className="flex-1">Home</span>
          </Link>
          <Link href="/messages/inbox" className="nb-chat-row" aria-current={here("/messages/inbox")} data-unread={inboxUnread ? "true" : undefined} aria-label={`Inbox${inboxUnread ? `, ${inboxUnread} unread` : ""}`}>
            <Inbox size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
          </Link>
          <Link href="/messages/saved" className="nb-chat-row" aria-current={here("/messages/saved")}><Bookmark size={16} aria-hidden="true" /><span className="flex-1">Saved</span></Link>
          <Link href="/messages/drafts" className="nb-chat-row" aria-current={here("/messages/drafts")} aria-label={`Drafts and scheduled${drafts.length ? `, ${drafts.length} drafts` : ""}`}>
            <Pencil size={16} aria-hidden="true" /><span className="flex-1">Drafts &amp; scheduled</span>
            {drafts.length ? <span className="font-mono text-[12px] font-normal text-muted-foreground">{drafts.length}</span> : null}
          </Link>
        </div>
      ) : (
        <Link href="/messages/inbox" className="nb-chat-row" data-unread={inboxUnread ? "true" : undefined}>
          <AtSign size={16} aria-hidden="true" /><span className="flex-1">Inbox</span><Count value={inboxUnread} />
        </Link>
      )}

      {unreadsOnly && !starred.length && !channelRows.length && !applicationRows.length && !others.length && !myApplications.length && (open || ![...byProject.values()].flat().some(keep)) ? (
        <p className="px-2.5 text-[13px] text-muted-foreground">You&apos;re all caught up.</p>
      ) : null}

      {starred.length ? (
        <Section id="starred" title="Starred" collapsed={Boolean(collapsed.starred)} onToggle={toggle}>{starred.map(row)}</Section>
      ) : null}

      {open ? (
        <Section
          id="channels"
          title="Channels"
          collapsed={Boolean(collapsed.channels)}
          onToggle={toggle}
          action={(
            <>
              {(badges.get(open.id) ?? 0) > 0 ? <HeaderButton label="Mark all read" onClick={markProjectRead(open.id)}><CheckCheck size={14} /></HeaderButton> : null}
              {projectAdd(open.id)}
            </>
          )}
        >
          {channelRows.map(row)}
          {!sections.channels.length ? <p className="px-2.5 py-1 text-[13px] text-muted-foreground">No channels yet</p> : null}
          {applicationRows.length ? (
            <>
              <p className="nb-chat-section-title pt-2">Applications</p>
              {applicationRows.map(row)}
            </>
          ) : null}
        </Section>
      ) : projects.length ? (
        projects.map((project) => {
          const rows = (byProject.get(project.id) ?? []).filter(keep);
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
              action={(
                <>
                  {count ? <HeaderButton label={`Mark ${project.title} read`} onClick={markProjectRead(project.id)}><CheckCheck size={14} /></HeaderButton> : null}
                  {projectAdd(project.id)}
                </>
              )}
            >
              {rows.map(row)}
              {!rows.length ? <p className="px-2.5 py-1 text-[13px] text-muted-foreground">No channels yet</p> : null}
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
        title={`Direct messages${sections.dms.length ? ` · ${sections.dms.length}` : ""}`}
        collapsed={Boolean(collapsed.dms)}
        onToggle={toggle}
        action={onNewMessage
          ? <HeaderButton label="New message" onClick={onNewMessage}><SquarePen size={14} /></HeaderButton>
          : <HeaderButton label="New message" href="/messages/new"><SquarePen size={14} /></HeaderButton>}
      >
        {meId && (!unreadsOnly || (self && needsAttention(self))) ? (
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
        <Section id="applications" title="My applications" count={pending.applications} collapsed={Boolean(collapsed.applications)} onToggle={toggle}>
          {myApplications.map(row)}
        </Section>
      ) : null}
    </div>
  );
}
