"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCheck, Hash, Inbox, SquarePen } from "lucide-react";

import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListScreen } from "@/components/messages/ListScreen";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { ProjectBadge } from "@/components/projects/ProjectBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, isDirectLike, needsAttention, rowCount } from "@/lib/messaging/channel-view";
import type { ChatChannelSummary } from "@/lib/messaging/types";
import { conversationHref } from "@/lib/messaging/routes";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { MARK_ALL_LABEL } from "@/lib/messaging/channel-view";
import { ConversationIcon } from "@/components/messages/ConversationIcon";

function ConversationLink({ channel, meId }: { channel: ChatChannelSummary; meId: string | null }) {
  const count = rowCount(channel);
  const title = channelTitle(channel, meId);
  return (
    <Link href={conversationHref(channel.id)} className="flex min-h-11 items-center gap-2.5 rounded-[5px] px-2 hover:bg-muted">
      {channel.kind === "dm" ? <UserAvatar identity={channel.dm_user} size={24} roundedClassName="rounded-[4px]" /> : <ConversationIcon channel={channel} size={16} aria-hidden="true" className="mx-1 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${needsAttention(channel) ? "font-semibold" : ""}`}>{isDirectLike(channel) ? title : `#${title}`}</span>
        {channel.last_preview ? <span className="block truncate text-[12px] text-muted-foreground">{channel.last_author_id === meId ? "You: " : ""}{channel.last_preview}</span> : null}
      </span>
      {channel.last_message_at ? <span className="flex-none font-mono text-[11px] text-muted-foreground">{formatChatTime(channel.last_message_at)}</span> : null}
      {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}</span> : null}
    </Link>
  );
}

function Card({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3" aria-label={title}>
      <div className="mb-1.5 flex items-center gap-2 px-2">
        <span className="text-muted-foreground" aria-hidden="true">{icon}</span>
        <h2 className="flex-1 text-[13px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The main pane when no conversation is open (desktop): what needs you, what's recent, your threads. */
export function HomePane() {
  const projectId = useSelectedProject();
  const { data } = useChatShell();
  const markAllRead = useMarkAllRead();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const project = data?.projects?.find((p) => p.id === projectId) ?? null;

  const visible = (data?.channels ?? []).filter((c) => !c.archived_at && !c.channel_archived_at && (!project || c.project_id === project.id || isDirectLike(c)));
  const needing = visible.filter(needsAttention).sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
  // The headline counts all of them; the card lists the first 8.
  const unread = needing.slice(0, 8);
  const loading = !data;
  const recent = visible.filter((c) => !needsAttention(c) && c.last_message_at).sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")).slice(0, 6);
  const inboxUnread = data?.inbox_unread ?? 0;
  // Every conversation that needs you (not just the 8 shown), in one roundtrip (ACT-04).
  const markAll = () => markAllRead.conversations(visible.filter(needsAttention));

  return (
    <div className="app-scroll app-scroll-y h-full bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <header className="flex flex-wrap items-center gap-3">
          {project ? <ProjectBadge project={project} size="md" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-semibold tracking-tight">{project ? project.title : "Home"}</h1>
            <p className="text-[13px] text-muted-foreground">
              {loading ? "Loading…" : needing.length ? `${needing.length} conversation${needing.length === 1 ? "" : "s"} with something new` : "You're all caught up."}
            </p>
          </div>
          {project ? (
            <Link href={`/messages/p/${project.id}/browse`} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 text-[13px] font-medium hover:bg-muted"><Hash size={14} aria-hidden="true" /> Browse channels</Link>
          ) : null}
          <Link href="/messages/new" prefetch={true} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"><SquarePen size={14} aria-hidden="true" /> New message</Link>
        </header>

        {inboxUnread ? (
          <Link href="/messages/inbox" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted">
            <Inbox size={18} aria-hidden="true" className="text-[var(--chat-accent)]" />
            <span className="flex-1 text-[14px]"><strong className="font-semibold">{inboxUnread}</strong> unread in your Inbox: mentions and thread replies</span>
            <span className="text-[13px] font-medium text-primary">Open</span>
          </Link>
        ) : null}

        <Card
          title="Unread"
          icon={<CheckCheck size={15} />}
          action={unread.length ? <button type="button" onClick={markAll} className="text-[12px] font-medium text-primary hover:underline">{MARK_ALL_LABEL}</button> : null}
        >
          {unread.length ? unread.map((c) => <ConversationLink key={c.id} channel={c} meId={meId} />) : <p className="px-2 py-2 text-[13px] text-muted-foreground">{loading ? "Loading…" : "Nothing unread."}</p>}
        </Card>

        <Card
          title="Recent"
          icon={<Hash size={15} />}
          // Threads live in one place, the Inbox's Threads tab (it has Reply).
          action={<Link href="/messages/inbox?filter=threads" className="text-[12px] font-medium text-primary hover:underline">Open threads →</Link>}
        >
          {recent.length ? recent.map((c) => <ConversationLink key={c.id} channel={c} meId={meId} />) : <p className="px-2 py-2 text-[13px] text-muted-foreground">{loading ? "Loading…" : "No other recent conversations."}</p>}
        </Card>
      </div>
      {markAllRead.dialog}
    </div>
  );
}

const WIDE = "(min-width: 1024px)";
const subscribeWide = (onChange: () => void) => {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/**
 * The List screen below 1024px; the Home pane at 1024px+ (the sidebar lists conversations).
 * Only one mounts, so the conversation list and Home's queries don't run twice.
 */
export function ListOrHome() {
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => null);
  if (wide === null) return null;
  return <div className="h-full">{wide ? <HomePane /> : <ListScreen />}</div>;
}
