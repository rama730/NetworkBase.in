"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCheck, Hash, Inbox, MessagesSquare, SquarePen } from "lucide-react";

import { listThreads } from "@/app/actions/chat/activity";
import { markReadMany } from "@/app/actions/chat/read";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListScreen } from "@/components/messages/ListScreen";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { ProjectBadge } from "@/components/projects/ProjectBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, formatChatTime, isDirectLike, needsAttention, rowCount } from "@/lib/messaging/channel-view";
import { threadHref } from "@/lib/messaging/routes";
import { tokensToPlainText } from "@/lib/messaging/tokens";
import type { ChatChannelSummary } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

function ConversationLink({ channel, meId }: { channel: ChatChannelSummary; meId: string | null }) {
  const count = rowCount(channel);
  const title = channelTitle(channel, meId);
  return (
    <Link href={`/messages/${channel.id}`} className="flex min-h-11 items-center gap-2.5 rounded-[5px] px-2 hover:bg-muted">
      {channel.kind === "dm" ? <UserAvatar identity={channel.dm_user} size={24} roundedClassName="rounded-[4px]" /> : <Hash size={16} aria-hidden="true" className="mx-1 text-muted-foreground" />}
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
  const { data, refresh, applyRead } = useChatShell();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const project = data?.projects?.find((p) => p.id === projectId) ?? null;
  const threads = useQuery({
    queryKey: queryKeys.chat.threads(),
    queryFn: async () => {
      const result = await listThreads();
      return result.success ? result.threads : [];
    },
    staleTime: 30_000,
  });

  const visible = (data?.channels ?? []).filter((c) => !c.archived_at && !c.channel_archived_at && (!project || c.project_id === project.id || isDirectLike(c)));
  const unread = visible.filter(needsAttention).sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")).slice(0, 8);
  const recent = visible.filter((c) => !needsAttention(c) && c.last_message_at).sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "")).slice(0, 6);
  const inboxUnread = data?.inbox_unread ?? 0;
  // Every conversation that needs you (not just the 8 shown), in one roundtrip (ACT-04).
  const markAll = () => {
    const all = visible.filter(needsAttention);
    for (const channel of all) applyRead(channel.id, channel.last_seq);
    void markReadMany({ items: all.map((c) => ({ channelId: c.id, seq: c.last_seq })) }).then(refresh);
  };

  return (
    <div className="app-scroll app-scroll-y h-full bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <header className="flex flex-wrap items-center gap-3">
          {project ? <ProjectBadge project={project} size="md" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-semibold tracking-tight">{project ? project.title : "Home"}</h1>
            <p className="text-[13px] text-muted-foreground">
              {unread.length ? `${unread.length} conversation${unread.length === 1 ? "" : "s"} with something new` : "You're all caught up."}
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
          action={unread.length ? <button type="button" onClick={markAll} className="text-[12px] font-medium text-primary hover:underline">Mark all read</button> : null}
        >
          {unread.length ? unread.map((c) => <ConversationLink key={c.id} channel={c} meId={meId} />) : <p className="px-2 py-2 text-[13px] text-muted-foreground">Nothing unread.</p>}
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Recent" icon={<Hash size={15} />}>
            {recent.length ? recent.map((c) => <ConversationLink key={c.id} channel={c} meId={meId} />) : <p className="px-2 py-2 text-[13px] text-muted-foreground">No other recent conversations.</p>}
          </Card>
          <Card title="Your threads" icon={<MessagesSquare size={15} />} action={<Link href="/messages/inbox?filter=threads" className="text-[12px] font-medium text-primary hover:underline">All</Link>}>
            {(threads.data ?? []).slice(0, 5).map((t) => (
              <Link key={`${t.channel_id}:${t.root_seq}`} href={threadHref(t.channel_id, t.root_seq)} className="flex min-h-11 items-center gap-2.5 rounded-[5px] px-2 hover:bg-muted">
                <UserAvatar identity={t.author} size={24} roundedClassName="rounded-[4px]" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[14px] ${t.unread ? "font-semibold" : ""}`}>{tokensToPlainText(t.body) || "Attachment"}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{t.channel_name ? `#${t.channel_name}` : t.channel_title ?? "Direct message"} · {t.reply_count} {t.reply_count === 1 ? "reply" : "replies"}</span>
                </span>
                {t.unread ? <span className="size-2 flex-none rounded-full bg-[var(--chat-accent)]" aria-label="Unread" /> : null}
              </Link>
            ))}
            {threads.data && !threads.data.length ? <p className="px-2 py-2 text-[13px] text-muted-foreground">Threads you start or reply to show up here.</p> : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The List screen below 1024px; the Home pane at 1024px+ (the sidebar lists conversations). */
export function ListOrHome() {
  return (
    <>
      <div className="h-full lg:hidden"><ListScreen /></div>
      <div className="hidden h-full lg:block"><HomePane /></div>
    </>
  );
}
