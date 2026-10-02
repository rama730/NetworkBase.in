"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, BellOff, Hash, Info, Lock, MoreHorizontal, Star, Users } from "lucide-react";
import { toast } from "sonner";

import { archiveChannel, joinChannel, leaveChannel, type ChannelDetails } from "@/app/actions/chat/channels";
import { setMemberState } from "@/app/actions/chat/members";
import { listPins } from "@/app/actions/chat/messages";
import { markRead } from "@/app/actions/chat/read";
import { useChatUi, writeChatUi, writeDraft } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { Composer } from "@/components/messages/Composer";
import { ConversationContext, type ConversationContextValue } from "@/components/messages/conversation-context";
import { EditChannelDialog } from "@/components/messages/EditChannelDialog";
import { MessageRow } from "@/components/messages/MessageRow";
import { Timeline } from "@/components/messages/Timeline";
import { useChannelDetails, useChannelMembers, useChannelMessages } from "@/components/messages/useConversation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/hooks/useOnlineUsers";
import { channelTitle, isSelfDm, personName } from "@/lib/messaging/channel-view";
import { CHAT_BROADCAST_MENTION_MAX_MEMBERS } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatNotify } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

type Props = {
  channelId: string;
  around?: number | null;
  /** "window" = launcher: Back instead of the full-page chrome, threads open in place. */
  surface?: "page" | "window";
  onBack?: () => void;
  onOpenThread?: (rootSeq: number) => void;
  /** Launcher header controls (open full page, minimize, close). */
  windowActions?: React.ReactNode;
};

function Intro({ channel, meId, onEdit, onCreateTask }: { channel: ChannelDetails; meId: string | null; onEdit: () => void; onCreateTask: () => void }) {
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  if (channel.kind === "dm") {
    const self = isSelfDm(channel, meId);
    return (
      <div className="px-4 pb-4 pt-8">
        <UserAvatar identity={channel.dm_user} size={72} roundedClassName="rounded-lg" />
        <h2 className="mt-3 text-[24px] font-semibold">{self ? "You (notes to self)" : personName(channel.dm_user)}</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {self ? "Jot down notes, drafts and links. Only you can see this." : `This conversation is just between you and ${personName(channel.dm_user)}.`}
        </p>
        {!self && channel.dm_user?.username ? <Link href={`/u/${channel.dm_user.username}`} className="mt-3 inline-flex h-[var(--ui-control-height)] items-center rounded-[5px] border border-border px-3 text-[13px] font-medium">View profile</Link> : null}
      </div>
    );
  }
  const named = channel.name !== null;
  return (
    <div className="px-4 pb-4 pt-8">
      <h2 className="text-[24px] font-semibold">{named ? `Everyone's here in #${channel.name}` : "This is the start of your group chat"}</h2>
      {channel.description ? <p className="mt-1 text-[15px] text-muted-foreground">{channel.description}</p> : null}
      <p className="mt-1 font-mono text-[12px] text-muted-foreground">Created {new Date(channel.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</p>
      {named ? (
        <div className="mt-3 flex flex-wrap gap-2 [&>button]:inline-flex [&>button]:min-h-[var(--ui-control-height)] [&>button]:items-center [&>button]:rounded-[5px] [&>button]:border [&>button]:border-border [&>button]:px-3 [&>button]:text-[13px] [&>button]:font-medium pointer-coarse:[&>button]:min-h-11">
          <button type="button" onClick={onEdit}>Set a topic</button>
          {channel.project_id && channel.can_admin ? <button type="button" onClick={() => setInviteFor(channel.project_id)}>Invite teammates</button> : null}
          {channel.project_id ? <button type="button" onClick={onCreateTask}>Create a task</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function Pins({ channelId }: { channelId: string }) {
  const pins = useQuery({
    queryKey: queryKeys.chat.pins(channelId),
    queryFn: async () => {
      const result = await listPins({ channelId });
      return result.success ? result.messages : [];
    },
  });
  if (pins.isLoading) return <p role="status" className="p-6 text-center text-[13px] text-muted-foreground">Loading pins…</p>;
  if (!pins.data?.length) return <p className="p-6 text-center text-[13px] text-muted-foreground">Nothing pinned yet. Pin important messages from their actions menu.</p>;
  return <div className="app-scroll app-scroll-y min-h-0 flex-1 py-2">{pins.data.map((m) => <MessageRow key={m.seq} message={m} grouped={false} />)}</div>;
}

export function ConversationView({ channelId, around = null, surface = "page", onBack, onOpenThread, windowActions }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const setProject = useChatUi((state) => state.setProject);
  const details = useChannelDetails(channelId);
  const channel = details.data ?? null;
  const isMember = Boolean(channel?.is_member);
  const members = useChannelMembers(channelId, isMember);
  const people = useMemo(() => members.data ?? [], [members.data]);
  const [tab, setTab] = useState<"messages" | "pins">("messages");
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "archive" | null>(null);
  const [composerSeed, setComposerSeed] = useState(0);
  const conversation = useChannelMessages(channelId, { around, memberCount: channel?.member_count ?? 0, isMember });
  const online = useOnlineUsers(channel?.kind === "dm" && channel.dm_user && channel.dm_user.id !== meId ? [channel.dm_user.id] : []);

  useEffect(() => {
    if (surface === "page") writeChatUi({ last: channelId });
  }, [channelId, surface]);
  useEffect(() => {
    const projectId = channel?.project_id;
    if (surface === "page" && projectId && shell.data?.projects?.some((p) => p.id === projectId)) setProject(projectId);
  }, [channel?.project_id, setProject, shell.data?.projects, surface]);

  const names = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  const channelNames = useMemo(() => new Map((shell.data?.channels ?? []).filter((c) => c.name).map((c) => [c.id, c.name!])), [shell.data?.channels]);
  const nameOf = useCallback((id: string) => names.get(id), [names]);
  const channelNameOf = useCallback((id: string) => channelNames.get(id), [channelNames]);
  const openThread = useCallback((rootSeq: number) => {
    if (onOpenThread) onOpenThread(rootSeq);
    else router.push(`/messages/${channelId}/thread/${rootSeq}`);
  }, [channelId, onOpenThread, router]);
  const ctx = useMemo<ConversationContextValue>(() => ({
    channelId, meId, canAdmin: Boolean(channel?.can_admin), isDm: channel?.kind === "dm" || (channel?.kind === "private" && channel?.name === null),
    people, nameOf, channelNameOf, editingSeq, setEditingSeq, openThread, inThread: false,
  }), [channel?.can_admin, channel?.kind, channel?.name, channelId, channelNameOf, editingSeq, meId, nameOf, openThread, people]);

  const editLast = useCallback(() => {
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      const m = conversation.messages[i]!;
      if (m.author_id === meId && m.seq > 0 && !m.deleted_at && !m.card && m.kind === "user") return setEditingSeq(m.seq);
    }
  }, [conversation.messages, meId]);

  const setState = async (patch: { notify?: ChatNotify; starred?: boolean; archived?: boolean }) => {
    const result = await setMemberState({ channelId, ...patch });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    shell.refresh();
    if (patch.archived) router.push("/messages");
  };
  const join = async () => {
    const result = await joinChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    shell.refresh();
  };
  const leaveOrArchive = async () => {
    const action = confirm;
    setConfirm(null);
    const result = action === "archive" ? await archiveChannel({ channelId }) : await leaveChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    shell.refresh();
    router.push(channel?.project_id ? `/messages/p/${channel.project_id}` : "/messages");
  };

  if (details.isError) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-2">
          <h1 className="text-[17px] font-semibold">Conversation not found</h1>
          <p className="text-[13px] text-muted-foreground">It may be private, archived, or you may have left it.</p>
          <Link href="/messages" className="text-[13px] font-medium text-primary">Back to messages</Link>
        </div>
      </div>
    );
  }
  if (!channel) return <div role="status" aria-label="Loading conversation" className="h-full animate-pulse bg-card" />;

  const title = channelTitle(channel, meId);
  const isDirect = ctx.isDm;
  // ponytail: "Active" comes from presence rooms + the 10-minute heartbeat (L-8).
  // ceiling: coarse resolution. upgrade: live presence if sub-minute status is required.
  const dmOnline = channel.kind === "dm" && channel.dm_user ? online[channel.dm_user.id] : undefined;
  const Icon = channel.kind === "private" ? Lock : Hash;
  const placeholder = isDirect ? `Message ${title}` : `Message #${title}`;
  const archived = Boolean(channel.channel_archived_at);

  return (
    <ConversationContext.Provider value={ctx}>
      <section className="flex h-full min-h-0 flex-col bg-card" aria-label={title} data-chat-pane="conversation">
        <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2 sm:px-3">
          {surface === "window" || onBack ? (
            <button type="button" onClick={onBack ?? (() => router.push("/messages"))} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button>
          ) : (
            <Link href="/messages" className="nb-icon-button nb-touch-target lg:hidden" aria-label="Back to conversations"><ArrowLeft size={18} /></Link>
          )}
          {isMember && !isDirect ? (
            <button type="button" onClick={() => void setState({ starred: !channel.starred })} className="nb-icon-button hidden size-9 sm:grid" aria-label={channel.starred ? "Unstar" : "Star"} aria-pressed={channel.starred}>
              <Star size={16} fill={channel.starred ? "currentColor" : "none"} />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {channel.kind === "dm" ? <UserAvatar identity={channel.dm_user} size={34} roundedClassName="rounded-[5px]" /> : isDirect ? <Users size={18} aria-hidden="true" /> : <Icon size={18} aria-hidden="true" />}
            <div className="min-w-0">
              <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
              <p className="truncate text-[13px] text-muted-foreground">
                {channel.kind === "dm" ? (dmOnline === undefined ? "" : dmOnline ? "Active" : "Away") : channel.topic || (channel.project_title ?? "")}
              </p>
            </div>
          </div>
          {surface === "window" ? (
            windowActions
          ) : (
            <>
              {!isDirect ? (
                <Link href={`/messages/${channelId}/details?tab=members`} className="hidden h-9 items-center gap-1 rounded-[5px] border border-border px-2 text-[13px] sm:inline-flex" aria-label={`${channel.member_count} members`}>
                  <Users size={14} aria-hidden="true" /><span className="font-mono">{channel.member_count}</span>
                </Link>
              ) : null}
              {isMember ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="nb-icon-button hidden size-9 sm:grid" aria-label="Notifications">
                    {channel.notify === "mute" ? <BellOff size={16} /> : <Bell size={16} />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup value={channel.notify} onValueChange={(value) => void setState({ notify: value as ChatNotify })}>
                      <DropdownMenuRadioItem value="all">All messages</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="mentions">Mentions only</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="mute">Mute</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <Link href={`/messages/${channelId}/details`} className="nb-icon-button nb-touch-target" aria-label="Details"><Info size={16} /></Link>
              {isMember ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="nb-icon-button nb-touch-target" aria-label="More"><MoreHorizontal size={16} /></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => { void navigator.clipboard?.writeText(`${window.location.origin}/messages/${channelId}`); toast.success("Link copied"); }}>Copy link</DropdownMenuItem>
                    {!isDirect ? <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit topic and description</DropdownMenuItem> : null}
                    {channel.kind !== "dm" ? <DropdownMenuItem onSelect={() => router.push(`/messages/${channelId}/details?tab=members`)}>Add people</DropdownMenuItem> : null}
                    <DropdownMenuItem onSelect={() => { void markRead({ channelId, seq: channel.last_seq }); shell.applyRead(channelId, channel.last_seq); }}>Mark all read</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {channel.kind === "dm" ? (
                      <DropdownMenuItem onSelect={() => void setState({ archived: true })}>Close conversation</DropdownMenuItem>
                    ) : !channel.is_default ? (
                      <DropdownMenuItem onSelect={() => setConfirm("leave")}>Leave {isDirect ? "conversation" : "channel"}</DropdownMenuItem>
                    ) : null}
                    {channel.can_admin && !isDirect && !channel.is_default ? <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm("archive")}>Archive channel</DropdownMenuItem> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          )}
        </header>

        {/* ponytail: Messages and Pins only, no Files tab (L-27); no search icon until message search exists (L-28). */}
        {!isDirect && isMember && surface === "page" ? (
          <div className="flex h-10 flex-none items-end gap-4 border-b border-border px-4" role="tablist" aria-label="Conversation views">
            {(["messages", "pins"] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`nb-tab -mb-px border-b-2 pb-2 text-[13px] font-medium capitalize ${tab === value ? "border-[var(--chat-accent)] text-foreground" : "border-transparent text-muted-foreground"}`}>
                {value}
              </button>
            ))}
          </div>
        ) : null}

        {!isMember ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-[15px]">You&apos;re not in <span className="font-medium">#{channel.name}</span> yet.</p>
              {channel.description ? <p className="text-[13px] text-muted-foreground">{channel.description}</p> : null}
              <button type="button" onClick={() => void join()} className="inline-flex min-h-11 items-center rounded-[5px] bg-primary px-4 text-[13px] font-medium text-primary-foreground sm:min-h-[var(--ui-control-height)]">Join channel</button>
            </div>
          </div>
        ) : tab === "pins" ? (
          <Pins channelId={channelId} />
        ) : (
          <>
            {conversation.query.isLoading ? (
              <div role="status" aria-label="Loading messages" className="flex-1" />
            ) : (
              <Timeline
                key={channelId}
                messages={conversation.messages}
                lastReadSeq={channel.last_read_seq}
                meId={meId}
                hasOlder={Boolean(conversation.query.hasNextPage)}
                loadingOlder={conversation.query.isFetchingNextPage}
                loadOlder={() => void conversation.query.fetchNextPage()}
                intro={<Intro channel={channel} meId={meId} onEdit={() => setEditOpen(true)} onCreateTask={() => { writeDraft(channelId, "/task "); setComposerSeed((n) => n + 1); }} />}
                highlightSeq={around}
                onSeen={conversation.markSeen}
              />
            )}
            {conversation.query.isError ? (
              <p role="alert" className="border-t border-border bg-[var(--status-danger-soft)] px-4 py-2 text-[13px] text-[var(--status-danger)]">
                Messages couldn&apos;t load. <button type="button" className="font-medium underline" onClick={() => void conversation.query.refetch()}>Retry</button>
              </p>
            ) : null}
            {archived ? (
              <p className="border-t border-border px-4 py-3 text-center text-[13px] text-muted-foreground">This channel is archived. You can read it, but not post.</p>
            ) : (
              <Composer
                key={`${channelId}:${composerSeed}`}
                channelId={channelId}
                placeholder={placeholder}
                people={people}
                allowBroadcast={!isDirect && channel.member_count <= CHAT_BROADCAST_MENTION_MAX_MEMBERS}
                canCreateTask={Boolean(channel.project_id)}
                onTyping={conversation.notifyTyping}
                onEditLast={editLast}
              />
            )}
            <p className="h-5 flex-none truncate bg-card px-4 text-[12px] text-muted-foreground" aria-live="polite">
              {conversation.typingNames.length ? `${conversation.typingNames.slice(0, 2).join(" and ")}${conversation.typingNames.length > 2 ? " and others" : ""} ${conversation.typingNames.length === 1 ? "is" : "are"} typing…` : ""}
            </p>
          </>
        )}
      </section>
      {editOpen ? <EditChannelDialog channel={channel} open={editOpen} onOpenChange={setEditOpen} /> : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "archive" ? `Archive #${channel.name}?` : `Leave ${isDirect ? "this conversation" : `#${channel.name}`}?`}
        description={confirm === "archive" ? "Nobody can post in an archived channel. History stays readable." : "You can rejoin a public channel at any time."}
        confirmLabel={confirm === "archive" ? "Archive" : "Leave"}
        variant="destructive"
        onConfirm={() => void leaveOrArchive()}
      />
    </ConversationContext.Provider>
  );
}
