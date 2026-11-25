"use client";

import { padCount } from "@/lib/messaging/mix-format";
import { useState } from "react";
import Link from "next/link";
import { AlarmClock, Compass, Dot, Inbox, SquarePen } from "lucide-react";

import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { useWide } from "@/components/messages/useWide";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";

import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListScreen } from "@/components/messages/ListScreen";
import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { useSelectedWorkspace } from "@/components/messages/useSelectedWorkspace";
import { WorkspaceBadge } from "@/components/workspaces/WorkspaceBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, fullTime, isDirectLike, isVisible, needsAttention, projectsByActivity, rowCount } from "@/lib/messaging/channel-view";
import type { ChatChannelSummary } from "@/lib/messaging/types";
import { conversationHref } from "@/lib/messaging/routes";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { MARK_ALL_LABEL, counterpart } from "@/lib/messaging/channel-view";
import { ConversationIcon } from "@/components/messages/ConversationIcon";

function ConversationLink({ channel, meId }: { channel: ChatChannelSummary; meId: string | null }) {
  const count = rowCount(channel);
  return (
    <Link href={conversationHref(channel.id)} className="nbm-mrow">
      {channel.kind === "dm" || counterpart(channel) ? <UserAvatar identity={channel.dm_user ?? counterpart(channel)} size={26} /> : <ConversationIcon channel={channel} size={16} aria-hidden="true" className="mx-[5px] text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        {/* The icon already says # or 🔒: the name goes without a "#". */}
        <span className={`block truncate text-[13px] ${needsAttention(channel) ? "font-semibold" : "font-medium"}`}>{channelTitle(channel, meId)}</span>
        {channel.last_preview ? <span className="block truncate text-[13px] text-muted-foreground">{channel.last_author_id === meId ? "You: " : ""}{channel.last_preview}</span> : null}
      </span>
      {channel.last_message_at ? <span className="nbm-lrow-meta flex-none" title={fullTime(channel.last_message_at)}>{formatChatTime(channel.last_message_at)}</span> : null}
      {count ? <span className="nbm-count hot"><span aria-hidden="true">{padCount(count)}</span><span className="sr-only">{count} unread</span></span> : needsAttention(channel) ? <span className="sr-only">, unread</span> : null}
    </Link>
  );
}

function Card({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="nbm-home-list" aria-label={title}>
      <div className="nbm-glabel">
        <span aria-hidden="true">{icon}</span>
        <h2 className="m-0 font-[inherit] text-[length:inherit]">{title}</h2>
        <span className="nbm-glabel-rule" aria-hidden="true" />
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
  const projectId = useSelectedWorkspace();
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
  const savedDue = data?.saved_due ?? 0;
  // Nothing new, no Inbox or reminder banner: one centred empty state instead of a stray line.
  const caughtUp = Boolean(data) && !loadError && !firstRun && !needing.length && !inboxUnread && !savedDue;

  // The same frame as every other Messages screen: a 56px header bar on the card surface.
  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label={project ? project.title : "Home"}>
      <header className="nbm-lhead">
        {project ? <WorkspaceBadge project={project} size="sm" /> : null}
        <h1 className="nbm-lhead-title">{project ? project.title : "Home"}</h1>
        {project ? (
          <Button asChild variant="outline" size="sm"><Link href={`/messages/w/${project.id}/browse`}><Compass size={16} aria-hidden="true" /> Browse channels</Link></Button>
        ) : null}
        <Button asChild size="sm"><Link href="/messages/new"><SquarePen size={16} aria-hidden="true" /> New message</Link></Button>
      </header>
      <div className="app-scroll app-scroll-y min-h-0 flex-1">
      {caughtUp ? (
        <div className="grid min-h-full place-items-center p-6">
          <EmptyState figure="person"
            title="You’re all caught up"
            description="New messages, mentions and thread replies show up here."
            className="w-full max-w-md"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm"><Link href="/messages/new"><SquarePen size={16} aria-hidden="true" /> New message</Link></Button>
                {browseProject ? <Button asChild variant="outline" size="sm"><Link href={`/messages/w/${browseProject.id}/browse`}><Compass size={16} aria-hidden="true" /> Browse channels</Link></Button> : null}
              </div>
            }
          />
        </div>
      ) : (
      <div className="flex max-w-3xl flex-col gap-4 px-4 py-6">
        {needing.length > 0 && !loadError ? (
          <p className="nbm-home-line">{`${needing.length} conversation${needing.length === 1 ? "" : "s"} with something new`}</p>
        ) : null}

        {/* One failure, one message. */}
        {loadError ? (
          <ErrorNotice what="Your conversations" onRetry={refresh} />
        ) : !data ? (
          <ListSkeleton label="Loading conversations" header={false} />
        ) : firstRun ? (
          // EmptyState v2: pixel figure, serif line, one sentence, the two ways to start.
          <EmptyState
            figure="person"
            title="Start a conversation"
            description="Message a teammate directly, or join a channel in one of your workspaces."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm"><Link href="/messages/new"><SquarePen size={16} aria-hidden="true" /> Message someone</Link></Button>
                <Button asChild variant="outline" size="sm"><Link href={browseProject ? `/messages/w/${browseProject.id}/browse` : "/workspaces"}><Compass size={16} aria-hidden="true" /> {browseProject ? "Browse channels" : "Find a workspace"}</Link></Button>
              </div>
            }
          />
        ) : (
          <>
            {inboxUnread ? (
              <Link href="/messages/inbox" className="nbm-checkrow">
                <Inbox size={18} aria-hidden="true" className="text-primary" />
                <span className="flex-1 text-[15px]"><strong className="font-semibold">{inboxUnread}</strong> unread in your Inbox: mentions and thread replies</span>
                <span className="text-[13px] font-medium text-primary">Open</span>
              </Link>
            ) : null}
            {/* Reminders whose time has come: caught up on messages doesn't mean nothing's waiting. */}
            {savedDue ? (
              <Link href="/messages/saved" className="nbm-checkrow">
                <AlarmClock size={18} aria-hidden="true" className="text-primary" />
                <span className="flex-1 text-[15px]"><strong className="font-semibold">{savedDue}</strong> reminder{savedDue === 1 ? "" : "s"} due</span>
                <span className="text-[13px] font-medium text-primary">Open</span>
              </Link>
            ) : null}
            {/* All caught up: the line above says so; an empty card would say it twice. */}
            {unread.length ? (
              <Card
                title="Unread"
                icon={<Dot size={16} />}
                action={clearable.length ? <Button type="button" variant="ghost" size="sm" onClick={markAll} className="nbm-glabel-act text-primary pointer-coarse:h-11">{project ? `Mark ${project.title} read` : MARK_ALL_LABEL}</Button> : null}
              >
                {unread.map((c) => <ConversationLink key={c.id} channel={c} meId={meId} />)}
                {needing.length > UNREAD_SHOWN ? (
                  <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className="mt-1 min-h-9 w-full rounded-md px-2 text-left text-[13px] font-medium text-primary hover:bg-muted pointer-coarse:min-h-11">
                    {showAll ? "Show less" : `Show all ${needing.length}`}
                  </button>
                ) : null}
              </Card>
            ) : null}
          </>
        )}
      </div>
      )}
      </div>
      {markAllRead.dialog}
    </section>
  );
}


/**
 * The List screen below 1024px; the Home pane at 1024px+ (the sidebar lists conversations).
 * Only one mounts, so the conversation list and Home's queries don't run twice.
 */
export function ListOrHome() {
  const wide = useWide();
  // Before hydration knows the width, keep the route's skeleton up instead of a blank pane.
  if (wide === null) return <ListSkeleton label="Loading messages" />;
  return <div className="h-full">{wide ? <HomePane /> : <ListScreen />}</div>;
}
