"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Compass, Dot, Inbox, SquarePen } from "lucide-react";

import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListScreen } from "@/components/messages/ListScreen";
import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { ProjectBadge } from "@/components/projects/ProjectBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, isDirectLike, isVisible, needsAttention, projectsByActivity, rowCount } from "@/lib/messaging/channel-view";
import type { ChatChannelSummary } from "@/lib/messaging/types";
import { conversationHref } from "@/lib/messaging/routes";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { MARK_ALL_LABEL } from "@/lib/messaging/channel-view";
import { ConversationIcon } from "@/components/messages/ConversationIcon";

function ConversationLink({ channel, meId }: { channel: ChatChannelSummary; meId: string | null }) {
  const count = rowCount(channel);
  return (
    <Link href={conversationHref(channel.id)} className="flex min-h-11 items-center gap-2.5 rounded-[5px] px-2 hover:bg-muted">
      {channel.kind === "dm" ? <UserAvatar identity={channel.dm_user} size={24} roundedClassName="rounded-[4px]" /> : <ConversationIcon channel={channel} size={16} aria-hidden="true" className="mx-1 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        {/* The icon already says # or 🔒: the name goes without a "#". */}
        <span className={`block truncate text-[14px] ${needsAttention(channel) ? "font-semibold" : ""}`}>{channelTitle(channel, meId)}</span>
        {channel.last_preview ? <span className="block truncate text-[12px] text-muted-foreground">{channel.last_author_id === meId ? "You: " : ""}{channel.last_preview}</span> : null}
      </span>
      {channel.last_message_at ? <span className="flex-none font-mono text-[11px] text-muted-foreground">{formatChatTime(channel.last_message_at)}</span> : null}
      {count ? <span className="nb-chat-count">{count > 99 ? "99+" : count}<span className="sr-only"> unread</span></span> : null}
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

const UNREAD_SHOWN = 8;

/**
 * The main pane when no conversation is open (desktop): the Inbox banner and what's unread.
 * Recent conversations live in the sidebar; a first-time user gets the two ways to start instead.
 */
export function HomePane() {
  const projectId = useSelectedProject();
  const { data, loadError, refresh } = useChatShell();
  const markAllRead = useMarkAllRead();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const [showAll, setShowAll] = useState(false);
  const project = data?.projects?.find((p) => p.id === projectId) ?? null;

  const visible = (data?.channels ?? []).filter((c) => isVisible(c) && (!project || c.project_id === project.id || isDirectLike(c)));
  const needing = visible.filter(needsAttention).sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
  const unread = showAll ? needing : needing.slice(0, UNREAD_SHOWN);
  const inboxUnread = data?.inbox_unread ?? 0;
  // In a project, Home's button clears that project's channels only (DMs stay as they are).
  const clearable = project ? needing.filter((c) => c.project_id === project.id) : needing;
  const markAll = () => markAllRead.conversations(clearable);
  const firstRun = Boolean(data) && visible.length <= 1;
  const browseProject = project ?? projectsByActivity(data)[0] ?? null;

  return (
    <div className="app-scroll app-scroll-y h-full bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <header className="flex flex-wrap items-center gap-3">
          {project ? <ProjectBadge project={project} size="md" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-semibold tracking-tight">{project ? project.title : "Home"}</h1>
            {loadError ? null : (
              <p className="text-[13px] text-muted-foreground">
                {!data ? "Loading…" : needing.length ? `${needing.length} conversation${needing.length === 1 ? "" : "s"} with something new` : "You're all caught up."}
              </p>
            )}
          </div>
          {project ? (
            <Link href={`/messages/p/${project.id}/browse`} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 text-[13px] font-medium hover:bg-muted"><Compass size={14} aria-hidden="true" /> Browse channels</Link>
          ) : null}
          <Link href="/messages/new" prefetch={true} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"><SquarePen size={14} aria-hidden="true" /> New message</Link>
        </header>

        {/* One failure, one message. */}
        {loadError ? (
          <div role="alert" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-[14px]">
            <span className="flex-1">Your conversations didn&apos;t load.</span>
            <button type="button" onClick={refresh} className="rounded-[5px] border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted">Retry</button>
          </div>
        ) : !data ? (
          <ListSkeleton label="Loading conversations" />
        ) : firstRun ? (
          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="home-start">
            <h2 id="home-start" className="text-[15px] font-semibold">Start a conversation</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Message a teammate directly, or join a channel in one of your projects.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/messages/new" className="inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"><SquarePen size={14} aria-hidden="true" /> Message a teammate</Link>
              <Link href={browseProject ? `/messages/p/${browseProject.id}/browse` : "/projects"} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted"><Compass size={14} aria-hidden="true" /> {browseProject ? "Browse channels" : "Find a project"}</Link>
            </div>
          </section>
        ) : (
          <>
            {inboxUnread ? (
              <Link href="/messages/inbox" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted">
                <Inbox size={18} aria-hidden="true" className="text-[var(--chat-accent)]" />
                <span className="flex-1 text-[14px]"><strong className="font-semibold">{inboxUnread}</strong> unread in your Inbox: mentions and thread replies</span>
                <span className="text-[13px] font-medium text-primary">Open</span>
              </Link>
            ) : null}
            <Card
              title="Unread"
              icon={<Dot size={15} />}
              action={clearable.length ? <button type="button" onClick={markAll} className="text-[12px] font-medium text-primary hover:underline">{project ? `Mark ${project.title} read` : MARK_ALL_LABEL}</button> : null}
            >
              {unread.length ? unread.map((c) => <ConversationLink key={c.id} channel={c} meId={meId} />) : <p className="px-2 py-2 text-[13px] text-muted-foreground">Nothing unread.</p>}
              {needing.length > UNREAD_SHOWN ? (
                <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className="mt-1 min-h-9 w-full rounded-[5px] px-2 text-left text-[13px] font-medium text-primary hover:bg-muted">
                  {showAll ? "Show less" : `Show all ${needing.length}`}
                </button>
              ) : null}
            </Card>
          </>
        )}
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
  // Before hydration knows the width, keep the route's skeleton up instead of a blank pane.
  if (wide === null) return <ListSkeleton label="Loading messages" />;
  return <div className="h-full">{wide ? <HomePane /> : <ListScreen />}</div>;
}
