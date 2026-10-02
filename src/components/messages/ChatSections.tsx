"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AtSign, Check, ChevronDown, FileText, Hash, Lock, MessagesSquare, MoreHorizontal, Plus, SquarePen, Users } from "lucide-react";
import { toast } from "sonner";

import { getOrCreateDm, setMemberState } from "@/app/actions/chat/members";
import { markRead } from "@/app/actions/chat/read";
import { readChatUi, useChatUi, writeChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/hooks/useOnlineUsers";
import { DM_SIDEBAR_LIMIT, channelTitle, formatChatTime, initials, isDirectLike, isUnread, projectBadges, projectsByActivity, rowCount, sectionsFor } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatChannelSummary, ChatNotify } from "@/lib/messaging/types";

export type ChatSectionsVariant = "sidebar" | "list";

type Props = {
  variant: ChatSectionsVariant;
  /** Launcher: open in the window instead of navigating. */
  onSelect?: (channelId: string) => void;
  onNewMessage?: () => void;
};

export function channelHref(channelId: string) {
  return `/messages/${channelId}`;
}

function ChannelIcon({ channel, meId, online }: { channel: ChatChannelSummary; meId: string | null; online?: boolean }) {
  if (channel.kind === "dm") {
    return (
      <span className="relative inline-flex flex-none">
        <UserAvatar identity={channel.dm_user} size={20} roundedClassName="rounded-[3px]" />
        {online !== undefined && channel.dm_user?.id !== meId ? (
          <span
            aria-hidden="true"
            className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-[var(--card)] ${online ? "bg-[var(--status-success)]" : "bg-transparent ring-1 ring-current"}`}
          />
        ) : null}
      </span>
    );
  }
  const Icon = channel.application_id ? FileText : channel.name === null ? Users : channel.kind === "private" ? Lock : Hash;
  return <Icon size={16} aria-hidden="true" className="flex-none" />;
}

function Row({ channel, meId, variant, onSelect, online }: { channel: ChatChannelSummary; meId: string | null; variant: ChatSectionsVariant; onSelect?: Props["onSelect"]; online?: boolean }) {
  const pathname = usePathname();
  const href = channelHref(channel.id);
  const current = pathname === href || pathname?.startsWith(`${href}/`);
  const count = rowCount(channel);
  const title = channelTitle(channel, meId);
  const preview = variant === "list" && isDirectLike(channel);
  const label = `${title}${count ? `, ${count} unread` : ""}`;
  const body: ReactNode = preview ? (
    <>
      <span className="mt-0.5"><ChannelIcon channel={channel} meId={meId} online={online} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{title}</span>
          {channel.last_message_at ? (
            <span className="ml-auto flex-none font-mono text-[12px] font-normal text-muted-foreground">
              {formatChatTime(channel.last_message_at)}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-[13px] font-normal text-muted-foreground">
          {channel.last_preview ? `${channel.last_author_id === meId ? "You: " : ""}${channel.last_preview}` : "No messages yet"}
        </span>
      </span>
      {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}</span> : null}
    </>
  ) : (
    <>
      <ChannelIcon channel={channel} meId={meId} online={online} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}</span> : null}
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

const SWIPE_WIDTH = 144;

/**
 * List rows on touch (B12): swipe left for Mute plus Archive (DMs) or Star
 * (channels); the same actions sit in an overflow menu for non-swipe users.
 */
function SwipeActions({ channel, children }: { channel: ChatChannelSummary; children: ReactNode }) {
  const { refresh } = useChatShell();
  const [offset, setOffset] = useState(0);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const direct = isDirectLike(channel);
  const muted = channel.notify === "mute";
  const act = async (patch: { notify?: ChatNotify; starred?: boolean; archived?: boolean }) => {
    setOffset(0);
    const result = await setMemberState({ channelId: channel.id, ...patch });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refresh();
  };
  const mute = () => void act({ notify: muted ? "all" : "mute" });
  const second = direct
    ? { label: "Archive", run: () => void act({ archived: true }) }
    : { label: channel.starred ? "Unstar" : "Star", run: () => void act({ starred: !channel.starred }) };
  return (
    <div className="nb-chat-swipe group/row flex items-center">
      <div className="nb-chat-swipe-actions" aria-hidden={offset === 0}>
        <button type="button" tabIndex={offset ? 0 : -1} className="bg-secondary text-foreground" onClick={mute}>{muted ? "Unmute" : "Mute"}</button>
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
          <DropdownMenuItem onSelect={mute}>{muted ? "Unmute" : "Mute"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={second.run}>{second.label}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Section({ id, title, count, collapsed, onToggle, action, children }: {
  id: string; title: string; count?: number; collapsed: boolean; onToggle: (id: string) => void; action?: ReactNode; children: ReactNode;
}) {
  const headingId = `chat-section-${id}`;
  return (
    <section aria-labelledby={headingId} className="group/section">
      <div className="nb-chat-section-title">
        <button type="button" id={headingId} className="flex min-h-7 flex-1 items-center gap-1 text-left" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
          <ChevronDown size={12} aria-hidden="true" className={collapsed ? "-rotate-90" : undefined} />
          {title}
          {count ? <span className="sr-only">, {count} pending</span> : null}
        </button>
        {count ? <span className="nb-chat-count" aria-hidden="true">{count}</span> : null}
        {action}
      </div>
      {collapsed ? null : <div className="space-y-px">{children}</div>}
    </section>
  );
}

function ProjectTile({ title }: { title: string }) {
  return (
    <span aria-hidden="true" className="grid size-5 flex-none place-items-center rounded-[4px] bg-secondary font-mono text-[10px] font-semibold text-foreground">
      {initials(title)}
    </span>
  );
}

/**
 * Projects (report 7.10, revised 2026-10): every project is listed; opening one
 * collapses the list to its name, with its channels and applications below.
 * The name's dropdown switches projects or returns to the full list.
 */
function ProjectsBlock({ row, onSelect }: { row: (channel: ChatChannelSummary) => ReactNode; onSelect?: Props["onSelect"] }) {
  const { data, refresh } = useChatShell();
  const projectId = useSelectedProject();
  const setProject = useChatUi((state) => state.setProject);
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const projects = projectsByActivity(data);
  const badges = projectBadges(data);
  const open = projects.find((project) => project.id === projectId) ?? null;
  const sections = sectionsFor(data, open?.id ?? null);
  const canManage = open?.role === "owner" || open?.role === "admin";
  const inPage = !onSelect;

  const markAllRead = async () => {
    if (!open) return;
    const unread = (data?.channels ?? []).filter((c) => c.project_id === open.id && isUnread(c));
    await Promise.all(unread.map((c) => markRead({ channelId: c.id, seq: c.last_seq })));
    refresh();
  };

  if (!projects.length) {
    return (
      <p className="px-2.5 py-1 text-[13px] text-muted-foreground">
        No projects yet. {inPage ? <Link href="/projects/new" className="font-medium text-primary hover:underline">Create one</Link> : null}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="space-y-px">
        {projects.map((project) => {
          const count = badges.get(project.id) ?? 0;
          return (
            <button
              key={project.id}
              type="button"
              className="nb-chat-row"
              data-unread={count ? "true" : undefined}
              data-testid={`chat-project-${project.id}`}
              aria-label={`${project.title}${count ? `, ${count} unread` : ""}`}
              onClick={() => setProject(project.id)}
            >
              <ProjectTile title={project.title} />
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
              {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}</span> : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-px" data-testid={`chat-project-open-${open.id}`}>
      <DropdownMenu>
        <DropdownMenuTrigger className="nb-chat-row font-semibold text-foreground" aria-label={`${open.title}, switch project`}>
          <ProjectTile title={open.title} />
          <span className="min-w-0 flex-1 truncate text-left">{open.title}</span>
          <ChevronDown size={14} aria-hidden="true" className="flex-none" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Switch project</DropdownMenuLabel>
          {projects.map((project) => {
            const count = badges.get(project.id) ?? 0;
            return (
              <DropdownMenuItem key={project.id} onSelect={() => setProject(project.id)}>
                <ProjectTile title={project.title} />
                <span className="min-w-0 flex-1 truncate">{project.title}</span>
                {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}</span> : null}
                {project.id === open.id ? <Check size={14} aria-label="Open" /> : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuItem onSelect={() => setProject(null)}>Show all projects</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void markAllRead()}>Mark all read</DropdownMenuItem>
          {inPage && canManage ? <DropdownMenuItem onSelect={() => setInviteFor(open.id)}>Invite people</DropdownMenuItem> : null}
          {inPage && canManage ? (
            <DropdownMenuItem asChild><Link href={`/projects/${open.slug ?? open.id}?tab=settings`}>Project settings</Link></DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-[18px] space-y-px border-l border-border pl-1.5">
        {sections.channels.map(row)}
        {sections.channels.length === 0 ? <p className="px-2.5 py-1 text-[13px] text-muted-foreground">No channels yet</p> : null}
        {inPage ? (
          <>
            <button type="button" className="nb-chat-row" onClick={() => setCreateFor(open.id)}><Plus size={16} aria-hidden="true" /><span>Add channel</span></button>
            <Link href={`/messages/p/${open.id}/browse`} className="nb-chat-row"><Hash size={16} aria-hidden="true" /><span>Browse channels</span></Link>
          </>
        ) : null}
        {sections.applications.length ? (
          <>
            <p className="nb-chat-section-title pt-2">Applications</p>
            {sections.applications.map(row)}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The sectioned list shared by the desktop sidebar, the mobile List screen and the launcher window. */
export function ChatSections({ variant, onSelect, onNewMessage }: Props) {
  const { data, pending, loadError, refresh } = useChatShell();
  const { user, profile } = useAuth();
  const router = useRouter();
  const meId = user?.id ?? null;
  const projectId = useSelectedProject();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => setCollapsed(readChatUi().collapsed ?? {}), []);
  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      writeChatUi({ collapsed: next });
      return next;
    });
  };

  const sections = useMemo(() => sectionsFor(data, projectId), [data, projectId]);
  const dmRows = variant === "sidebar" ? sections.dms.slice(0, DM_SIDEBAR_LIMIT) : sections.dms;
  const presenceIds = useMemo(
    () => dmRows.filter((c) => c.kind === "dm" && c.dm_user && c.dm_user.id !== meId).slice(0, 3).map((c) => c.dm_user!.id),
    [dmRows, meId],
  );
  const online = useOnlineUsers(presenceIds);
  const mentions = data?.channels.reduce((sum, c) => sum + (c.notify === "mute" ? 0 : c.mention_count), 0) ?? 0;
  // The self-DM ("You (notes to self)") is created on first open.
  const openSelf = async () => {
    if (!meId) return;
    const result = await getOrCreateDm({ userId: meId });
    if (!result.success) return;
    refresh();
    if (onSelect) onSelect(result.channelId);
    else router.push(channelHref(result.channelId));
  };
  const row = (channel: ChatChannelSummary) => {
    const element = (
      <Row key={channel.id} channel={channel} meId={meId} variant={variant} onSelect={onSelect} online={presenceIds.includes(channel.dm_user?.id ?? "") ? Boolean(online[channel.dm_user!.id]) : undefined} />
    );
    return variant === "list" && !onSelect ? <SwipeActions key={channel.id} channel={channel}>{element}</SwipeActions> : element;
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
  return (
    <div className="space-y-4">
      <div className="space-y-px">
        <Link href="/messages/threads" className="nb-chat-row"><MessagesSquare size={16} aria-hidden="true" /><span className="flex-1">Threads</span></Link>
        <Link href="/messages/activity" className="nb-chat-row" data-unread={mentions ? "true" : undefined}>
          <AtSign size={16} aria-hidden="true" /><span className="flex-1">Activity</span>
          {mentions ? <span className="nb-chat-count" aria-label={`${mentions} mentions`}>{mentions > 99 ? "99+" : mentions}</span> : null}
        </Link>
      </div>

      {sections.starred.length ? (
        <Section id="starred" title="Starred" collapsed={Boolean(collapsed.starred)} onToggle={toggle}>{sections.starred.map(row)}</Section>
      ) : null}

      <Section id="projects" title="Projects" collapsed={Boolean(collapsed.projects)} onToggle={toggle}>
        <ProjectsBlock row={row} onSelect={onSelect} />
      </Section>

      {sections.myApplications.length ? (
        <Section id="applications" title="My applications" count={pending.applications} collapsed={Boolean(collapsed.applications)} onToggle={toggle}>
          {sections.myApplications.map(row)}
        </Section>
      ) : null}

      <Section id="dms" title="Direct messages" collapsed={Boolean(collapsed.dms)} onToggle={toggle}>
        {dmRows.map(row)}
        {variant === "sidebar" && sections.dms.length > DM_SIDEBAR_LIMIT ? (
          <Link href="/messages/dms" className="nb-chat-row"><span className="pl-6">Show more</span></Link>
        ) : null}
        {meId && !sections.dms.some((c) => c.kind === "dm" && c.dm_user?.id === meId) ? (
          <button type="button" className="nb-chat-row" onClick={() => void openSelf()}>
            <UserAvatar identity={selfIdentity} size={20} roundedClassName="rounded-[3px]" /><span>You</span>
          </button>
        ) : null}
        {onNewMessage ? (
          <button type="button" className="nb-chat-row" onClick={onNewMessage}><SquarePen size={16} aria-hidden="true" /><span>New message</span></button>
        ) : (
          <Link href="/messages/new" className="nb-chat-row"><SquarePen size={16} aria-hidden="true" /><span>New message</span></Link>
        )}
      </Section>
    </div>
  );
}
