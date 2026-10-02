"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AtSign, ChevronDown, FileText, Hash, Lock, MessagesSquare, MoreHorizontal, Plus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { getOrCreateDm, setMemberState } from "@/app/actions/chat/members";
import { readChatUi, writeChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/hooks/useOnlineUsers";
import { DM_SIDEBAR_LIMIT, channelTitle, isDirectLike, isUnread, rowCount, sectionsFor } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatChannelSummary, ChatNotify } from "@/lib/messaging/types";

export type ChatSectionsVariant = "sidebar" | "list";

type Props = {
  projectId: string | null;
  variant: ChatSectionsVariant;
  unreadOnly?: boolean;
  /** Launcher: open in the window instead of navigating. */
  onSelect?: (channelId: string) => void;
  onCreateChannel?: () => void;
  onInvite?: () => void;
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
            className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-[var(--chat-row-hover,var(--chat-chrome-bg))] ${online ? "bg-[var(--status-success)]" : "bg-transparent ring-1 ring-current"}`}
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
              {new Date(channel.last_message_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
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

/** The sectioned list shared by the desktop sidebar, the mobile List screen and the launcher window. */
export function ChatSections({ projectId, variant, unreadOnly = false, onSelect, onCreateChannel, onInvite }: Props) {
  const { data, pending, refresh } = useChatShell();
  const { user } = useAuth();
  const router = useRouter();
  const meId = user?.id ?? null;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => setCollapsed(readChatUi().collapsed ?? {}), []);
  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      writeChatUi({ collapsed: next });
      return next;
    });
  };

  const sections = useMemo(() => {
    const all = sectionsFor(data, projectId);
    if (!unreadOnly) return all;
    const keep = (channel: ChatChannelSummary) => isUnread(channel) || channel.mention_count > 0;
    return { starred: all.starred.filter(keep), channels: all.channels.filter(keep), applications: all.applications.filter(keep), dms: all.dms.filter(keep) };
  }, [data, projectId, unreadOnly]);

  const dmRows = variant === "sidebar" ? sections.dms.slice(0, DM_SIDEBAR_LIMIT) : sections.dms;
  const presenceIds = useMemo(
    () => dmRows.filter((c) => c.kind === "dm" && c.dm_user && c.dm_user.id !== meId).slice(0, 3).map((c) => c.dm_user!.id),
    [dmRows, meId],
  );
  const online = useOnlineUsers(presenceIds);
  const project = data?.projects?.find((p) => p.id === projectId) ?? null;
  const canInvite = project?.role === "owner" || project?.role === "admin";
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

      {projectId ? (
        <Section
          id="channels"
          title="Channels"
          collapsed={Boolean(collapsed.channels)}
          onToggle={toggle}
          action={onCreateChannel ? (
            <button type="button" className="grid size-6 place-items-center rounded-[5px] opacity-100 hover:bg-[var(--chat-row-hover,var(--chat-chrome-raised))] md:opacity-0 md:group-hover/section:opacity-100 md:focus-visible:opacity-100" aria-label="Create channel" onClick={onCreateChannel}>
              <Plus size={14} aria-hidden="true" />
            </button>
          ) : null}
        >
          {sections.channels.map(row)}
          {onSelect ? null : (
            <Link href={`/messages/p/${projectId}/browse`} className="nb-chat-row"><Plus size={16} aria-hidden="true" /><span>Browse channels</span></Link>
          )}
        </Section>
      ) : null}

      {sections.applications.length ? (
        <Section
          id="applications"
          title={projectId ? "Applications" : "My applications"}
          count={projectId ? sections.applications.filter(isUnread).length : pending.applications}
          collapsed={Boolean(collapsed.applications)}
          onToggle={toggle}
        >
          {sections.applications.map(row)}
        </Section>
      ) : null}

      <Section id="dms" title="Direct messages" collapsed={Boolean(collapsed.dms)} onToggle={toggle}>
        {dmRows.map(row)}
        {variant === "sidebar" && sections.dms.length > DM_SIDEBAR_LIMIT ? (
          <Link href="/messages/dms" className="nb-chat-row"><span className="pl-6">Show more</span></Link>
        ) : null}
        {meId && !sections.dms.some((c) => c.kind === "dm" && c.dm_user?.id === meId) ? (
          <button type="button" className="nb-chat-row" onClick={() => void openSelf()}>
            <UserAvatar identity={user} size={20} roundedClassName="rounded-[3px]" /><span>You</span>
          </button>
        ) : null}
        {canInvite && onInvite ? (
          <button type="button" className="nb-chat-row" onClick={onInvite}><UserPlus size={16} aria-hidden="true" /><span>Invite people</span></button>
        ) : null}
      </Section>
    </div>
  );
}
