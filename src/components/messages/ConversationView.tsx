"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, AtSign, Bell, BellOff, Check, Hash, Link2, Lock, MoreHorizontal, Search, Star, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { deleteCanvas } from "@/app/actions/chat/canvas";
import { addChannelTab, joinChannel, removeChannelTab, saveChannelTabs } from "@/app/actions/chat/channels";
import { setMemberState } from "@/app/actions/chat/members";
import { listPins, pinMessage } from "@/app/actions/chat/messages";
import { markRead } from "@/app/actions/chat/read";
import { readChatUi, useChatUi, writeChatUi } from "@/components/messages/chat-ui-store";
import { useBack } from "@/components/messages/useBack";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import type { CanvasSeed } from "@/components/messages/ChannelCanvas";
import { ChannelTabBar } from "@/components/messages/ChannelTabBar";
import { ConversationContext, useConversationContext, type ConversationContextValue } from "@/components/messages/conversation-context";
import { MessageBody } from "@/components/messages/MessageBody";
import { FilesView } from "@/components/messages/parts/FilesView";
import { Timeline } from "@/components/messages/Timeline";
import { usePanes } from "@/components/messages/usePanes";
import { useChannelCanvas, useChannelDetails, useChannelMembers, useChannelMessages, useChannelTabs, useSavedSeqs, useTyping } from "@/components/messages/useConversation";
import { SkeletonTasks } from "@/components/projects/skeletons/SkeletonTasks";
import { PersonPresenceBadge } from "@/components/presence/PersonPresence";
import { StatusInline } from "@/components/presence/StatusInline";
import { usePersonPresence } from "@/components/presence/usePresence";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/hooks/useOnlineUsers";
import type { ChannelDetails } from "@/app/actions/chat/channels";
import type { CanvasTemplate } from "@/lib/messaging/canvas-store";
import { conversationTabs, restoreTabOrder, type ChannelTabItem } from "@/lib/messaging/channel-tabs";
import { canAddPeople, channelTitle, isSelfDm, personName } from "@/lib/messaging/channel-view";
import { CHAT_BROADCAST_MENTION_MAX_MEMBERS } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref, type DetailsTab } from "@/lib/messaging/routes";
import type { ChatMessageView, ChatNotify } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { copyWithToast } from "@/lib/clipboard";
import { useConversationExit } from "@/components/messages/useConversationExit";
import { ConversationIcon } from "@/components/messages/ConversationIcon";

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

const NOTIFY_LABEL: Record<ChatNotify, string> = { all: "All messages", mentions: "Mentions only", mute: "Muted" };

function IntroButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 text-[13px] font-medium hover:bg-muted">{children}</button>;
}

function Intro({ channel, meId, isMember, onDetails, onAddPeople, onCanvas }: {
  channel: ChannelDetails; meId: string | null; isMember: boolean; onDetails: () => void; onAddPeople: () => void; onCanvas?: () => void;
}) {
  if (channel.kind === "dm") {
    const self = isSelfDm(channel, meId);
    return (
      <div className="px-4 py-4 text-[13px] text-muted-foreground">
        <p>
          {self
            ? "This is your space. Jot down notes, drafts and links only you can see."
            : `This is the very beginning of your direct message history with ${personName(channel.dm_user)}.`}
        </p>
      </div>
    );
  }
  if (channel.name === null) {
    return (
      <div className="space-y-3 px-4 py-5">
        <p className="text-[13px] text-muted-foreground">This is the start of your group conversation. Give it a name so it&apos;s easy to find.</p>
        {isMember ? <div className="flex flex-wrap gap-2"><IntroButton onClick={onDetails}>Name the group</IntroButton><IntroButton onClick={onAddPeople}><UserPlus size={14} /> Add people</IntroButton></div> : null}
      </div>
    );
  }
  const isDefault = Boolean(channel.is_default);
  return (
    <div className="space-y-4 px-4 pb-6 pt-6 sm:px-6 sm:pt-8">
      <div>
        <h1 className="flex flex-wrap items-center gap-x-2 text-[24px] font-bold tracking-tight text-foreground sm:text-[28px]">
          <span>{isDefault ? "Welcome to" : "This is the start of"}</span>
          <span className="inline-flex items-center gap-1.5">
            {channel.kind === "private" ? <Lock size={22} className="text-muted-foreground" aria-hidden="true" /> : <Hash size={24} className="stroke-[2.5] text-muted-foreground" aria-hidden="true" />}
            <span>{channel.name}</span>
          </span>
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-normal text-muted-foreground">
          {channel.description || (isDefault
            ? `${channel.project_title ?? "The project"}'s home channel. Everyone on the team is here: share updates, decisions and wins.`
            : `Everything about #${channel.name} lives here: conversations, files and decisions.`)}
        </p>
        {channel.created_at ? (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
            Created {new Date(channel.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          </p>
        ) : null}
      </div>
      {isMember ? (
        <div className="flex flex-wrap gap-2">
          {!channel.description ? <IntroButton onClick={onDetails}>Add a description</IntroButton> : null}
          <IntroButton onClick={onAddPeople}><UserPlus size={14} /> Add people</IntroButton>
          {onCanvas ? <IntroButton onClick={onCanvas}>Create a canvas</IntroButton> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One pinned message: who, when (with the date), what; Jump to it or Unpin. No other actions here. */
function PinRow({ message, channelId }: { message: ChatMessageView; channelId: string }) {
  const router = useRouter();
  const ctx = useConversationContext();
  const queryClient = useQueryClient();
  const unpin = async () => {
    const result = await pinMessage({ channelId, seq: message.seq, on: false });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.pins(channelId) });
    toast("Unpinned");
  };
  const when = new Date(message.created_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <li className="flex gap-3 border-b border-border px-4 py-3">
      <UserAvatar identity={message.author} size={34} roundedClassName="rounded-[5px]" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[13px]">
          <span className="font-medium">{personName(message.author)}</span>
          <time dateTime={message.created_at} className="font-mono text-[12px] text-muted-foreground" title={new Date(message.created_at).toLocaleString()}>{when}</time>
        </p>
        {message.body ? <MessageBody body={message.body} nameOf={ctx.nameOf} channelNameOf={ctx.channelNameOf} meId={ctx.meId} /> : null}
        {message.attachments.length ? <p className="text-[13px] text-muted-foreground">{message.attachments.map((a) => a.name || "Attachment").join(", ")}</p> : null}
        <div className="mt-1 flex gap-3 text-[13px]">
          <button type="button" onClick={() => router.replace(conversationHref(channelId, { m: message.seq }), { scroll: false })} className="font-medium text-primary hover:underline">Jump to message</button>
          <button type="button" onClick={() => void unpin()} className="text-muted-foreground hover:text-foreground">Unpin</button>
        </div>
      </div>
    </li>
  );
}

export function Pins({ channelId }: { channelId: string }) {
  const pins = useQuery({
    queryKey: queryKeys.chat.pins(channelId),
    queryFn: async () => {
      const result = await listPins({ channelId });
      return result.success ? result.messages : [];
    },
  });
  if (pins.isLoading) return <p role="status" className="p-6 text-center text-[13px] text-muted-foreground">Loading pins…</p>;
  if (!pins.data?.length) return <p className="p-6 text-center text-[13px] text-muted-foreground">Nothing pinned yet. Pin important messages from their actions menu.</p>;
  return <ul aria-label="Pins" className="app-scroll app-scroll-y min-h-0 flex-1">{pins.data.map((m) => <PinRow key={m.seq} message={m} channelId={channelId} />)}</ul>;
}

function TimelineSkeleton() {
  return (
    <div role="status" aria-label="Loading messages" className="flex-1 space-y-5 overflow-hidden p-4">
      {[64, 80, 48, 72, 56].map((width, row) => (
        <div key={row} className="flex animate-pulse gap-2.5">
          <div className="size-[34px] flex-none rounded-[5px] bg-muted" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-3 rounded bg-muted" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// The editors (Tiptap) load after the timeline; the placeholders hold their space.
const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), {
  ssr: false,
  loading: () => <div className="nb-message-composer border-t border-border bg-card px-3 pt-2 sm:px-4"><div className="h-[86px] rounded-lg border border-input" /></div>,
});
const ChannelCanvas = dynamic(() => import("@/components/messages/ChannelCanvas").then((m) => m.ChannelCanvas), { ssr: false, loading: () => <div className="flex-1" /> });
const CanvasTemplateModal = dynamic(() => import("@/components/messages/CanvasTemplateModal").then((m) => m.CanvasTemplateModal), { ssr: false });
const AddTabLinkDialog = dynamic(() => import("@/components/messages/AddTabLinkDialog").then((m) => m.AddTabLinkDialog), { ssr: false });
const EditTabsDialog = dynamic(() => import("@/components/messages/EditTabsDialog").then((m) => m.EditTabsDialog), { ssr: false });
const ExistingCanvasModal = dynamic(() => import("@/components/messages/ExistingCanvasModal").then((m) => m.ExistingCanvasModal), { ssr: false });
const AddPeopleDialog = dynamic(() => import("@/components/messages/parts/AddPeople").then((m) => m.AddPeopleDialog), { ssr: false });
const ShareDialog = dynamic(() => import("@/components/messages/parts/ShareDialog").then((m) => m.ShareDialog), { ssr: false });
const TasksTab = dynamic(() => import("@/components/projects/v2/TasksTab"), { ssr: false, loading: () => <SkeletonTasks /> });

export function ConversationView({ channelId, around = null, surface = "page", onBack, onOpenThread, windowActions }: Props) {
  const router = useRouter();
  const goBack = useBack();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const panes = usePanes(channelId);
  const setProject = useChatUi((state) => state.setProject);
  const details = useChannelDetails(channelId);
  const channel = details.data ?? null;
  const isMember = Boolean(channel?.is_member);
  const archived = Boolean(channel?.channel_archived_at);
  // Project members read a public channel before joining it (Slack preview).
  const canPreview = !isMember && channel?.kind === "public" && !archived;
  const isChannel = Boolean(channel && channel.kind !== "dm" && channel.name !== null);
  const isDirect = channel?.kind === "dm" || (channel?.kind === "private" && channel?.name === null);
  const members = useChannelMembers(channelId, isMember);
  const people = useMemo(() => members.data ?? [], [members.data]);
  const searchParams = useSearchParams();
  const linkedTab = searchParams?.get("tab") ?? null;
  const pathname = usePathname();
  const [tab, setTabState] = useState<string>(linkedTab ?? "messages");
  // ?tab= is the open view, both ways: links open a tab, and picking one writes it (a refresh keeps it).
  useEffect(() => setTabState(linkedTab ?? "messages"), [linkedTab]);
  const setTab = useCallback((id: string) => {
    setTabState(id);
    if (surface !== "page" || !pathname) return;
    const params = new URLSearchParams(window.location.search);
    if (id === "messages") params.delete("tab");
    else params.set("tab", id);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, surface]);
  const [canvasHidden, setCanvasHidden] = useState(false);
  const [dialog, setDialog] = useState<"bookmark" | "tabs" | "template" | "existing" | "people" | null>(null);
  const [shareSeq, setShareSeq] = useState<number | null>(null);
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<"leave" | "archive" | "canvas" | "replace" | null>(null);
  const [pendingSeed, setPendingSeed] = useState<{ title: string; body: string } | null>(null);
  const [canvasSeed, setCanvasSeed] = useState<CanvasSeed | null>(null);
  const canvasQuery = useChannelCanvas(channelId, isMember && isChannel);
  const sharedTabs = useChannelTabs(channelId, isMember);
  const saved = useSavedSeqs(channelId, isMember);
  const conversation = useChannelMessages(channelId, { around, memberCount: channel?.member_count ?? 0, isMember, canPreview });
  // A jump to a message that's already loaded scrolls there; only one outside the loaded pages rebuilds the timeline.
  const [timeline, setTimeline] = useState({ around, epoch: 0 });
  if (timeline.around !== around) {
    const loaded = around !== null && conversation.messages.some((m) => m.seq === around);
    setTimeline({ around, epoch: loaded || around === null ? timeline.epoch : timeline.epoch + 1 });
  }
  const typing = useTyping(channelId, { rootSeq: null, people, memberCount: channel?.member_count ?? 0, enabled: isMember });
  const online = useOnlineUsers(channel?.kind === "dm" && channel.dm_user && channel.dm_user.id !== meId ? [channel.dm_user.id] : []);
  const memberIds = useMemo(() => people.slice(0, 3).map((p) => p.id), [people]);
  const memberOnline = useOnlineUsers(memberIds);

  useEffect(() => setCanvasHidden((readChatUi().hiddenCanvas ?? []).includes(channelId)), [channelId]);
  // A jump to a message (?m=) always lands on the timeline.
  useEffect(() => { if (around) setTab("messages"); }, [around, setTab]);

  const pinsQuery = useQuery({
    queryKey: queryKeys.chat.pins(channelId),
    enabled: isMember,
    queryFn: async () => {
      const result = await listPins({ channelId });
      return result.success ? result.messages : [];
    },
    staleTime: 30_000,
  });
  const pinCount = pinsQuery.data?.length ?? 0;

  // The canvas is shared: once anyone writes one, everyone sees its tab (unless they hid it).
  const hasCanvas = Boolean(canvasQuery.data) || tab === "canvas";
  const tabs = useMemo(() => conversationTabs({
    pinCount,
    canvasTitle: hasCanvas ? canvasQuery.data?.title?.trim() || "Canvas" : null,
    canvasHidden,
    active: tab,
    shared: sharedTabs.data ?? [],
    projectId: channel?.project_id ?? null,
  }), [canvasHidden, canvasQuery.data?.title, channel?.project_id, hasCanvas, pinCount, sharedTabs.data, tab]);
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  const hideCanvas = useCallback((hidden: boolean) => {
    const list = new Set(readChatUi().hiddenCanvas ?? []);
    if (hidden) list.add(channelId);
    else list.delete(channelId);
    writeChatUi({ hiddenCanvas: [...list] });
    setCanvasHidden(hidden);
  }, [channelId]);

  const openCanvas = useCallback((seed?: { title: string; body: string }) => {
    hideCanvas(false);
    if (seed) setCanvasSeed({ ...seed, nonce: Date.now() });
    setTab("canvas");
  }, [hideCanvas, setTab]);
  // A template or another channel's canvas replaces this one: ask first when there's something to lose.
  const seedCanvas = (seed: { title: string; body: string }) => {
    if (canvasQuery.data?.body?.trim()) {
      setPendingSeed(seed);
      setConfirm("replace");
    } else openCanvas(seed);
  };

  const removeCanvas = useCallback(async () => {
    // Null first: the closing editor sees it and skips its leave-save, so it can't recreate the canvas.
    queryClient.setQueryData(queryKeys.chat.canvas(channelId), null);
    setTab("messages");
    const result = await deleteCanvas({ channelId });
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      void canvasQuery.refetch();
    }
  }, [canvasQuery, channelId, queryClient, setTab]);

  const refreshTabs = () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.tabs(channelId) });
  const addTab = async (kind: "tasks" | "link" | "files", title: string, url?: string, quiet = false) => {
    const result = await addChannelTab({ channelId, kind, title, url });
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      return null;
    }
    refreshTabs();
    if (kind !== "link" && !quiet) setTab(result.tab.id);
    if (kind === "link" && !quiet) toast.success(`"${title}" bookmark added for everyone`);
    return result.tab;
  };
  const closeTab = async (item: ChannelTabItem) => {
    if (item.kind === "canvas") {
      hideCanvas(true);
      setTab("messages");
      toast("Canvas tab hidden for you", { action: { label: "Undo", onClick: () => hideCanvas(false) } });
      return;
    }
    if (tab === item.id) setTab("messages");
    const before = (sharedTabs.data ?? []).map((t) => ({ id: t.id, title: t.title }));
    const result = await removeChannelTab({ channelId, tabId: item.id });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshTabs();
    // Undo re-adds it and puts it back where it was.
    const undo = async () => {
      const added = await addTab(item.kind as "tasks" | "link" | "files", item.title, item.url ?? undefined, true);
      if (!added) return;
      const saved = await saveChannelTabs({ channelId, tabs: restoreTabOrder(before, item.id, added) });
      if (!saved.success) toast.error(chatErrorMessage(saved.error));
      refreshTabs();
    };
    toast(`"${item.title}" removed for everyone`, { action: { label: "Undo", onClick: () => void undo() } });
  };
  const saveTabs = async (next: ChannelTabItem[]) => {
    const result = await saveChannelTabs({ channelId, tabs: next.map((t) => ({ id: t.id, title: t.title })) });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshTabs();
    if (!next.some((t) => t.id === tab) && tabs.find((t) => t.id === tab)?.shared) setTab("messages");
  };

  useEffect(() => {
    const projectId = channel?.project_id;
    if (surface === "page" && projectId && shell.data?.projects?.some((p) => p.id === projectId)) setProject(projectId);
  }, [channel?.project_id, setProject, shell.data?.projects, surface]);

  const openDetails = useCallback((which: DetailsTab = "about") => {
    if (surface === "page") panes.openDetails(which);
    else router.push(conversationHref(channelId, { details: which }));
  }, [channelId, panes, router, surface]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        e.preventDefault();
        openDetails("about");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDetails]);

  const names = useMemo(() => new Map(people.map((p) => [p.id, personName(p)])), [people]);
  const channelNames = useMemo(() => new Map((shell.data?.channels ?? []).filter((c) => c.name).map((c) => [c.id, c.name!])), [shell.data?.channels]);
  const nameOf = useCallback((id: string) => names.get(id), [names]);
  const channelNameOf = useCallback((id: string) => channelNames.get(id), [channelNames]);
  const openThread = useCallback((rootSeq: number) => {
    if (onOpenThread) onOpenThread(rootSeq);
    else panes.openThread(rootSeq);
  }, [onOpenThread, panes]);
  const openPinsTab = useCallback(() => setTab("pins"), [setTab]);
  const ctx = useMemo<ConversationContextValue>(() => ({
    channelId, meId, canAdmin: Boolean(channel?.can_admin), isDm: Boolean(isDirect),
    people, nameOf, channelNameOf, editingSeq, setEditingSeq, openThread, inThread: false,
    openPinsTab, isMember, projectId: channel?.project_id ?? null,
    savedSeqs: saved.seqs, setSaved: (seq, on, remindAt) => void saved.setSaved(seq, on, remindAt), share: setShareSeq,
  }), [channel?.can_admin, channel?.project_id, channelId, channelNameOf, editingSeq, isDirect, isMember, meId, nameOf, openPinsTab, openThread, people, saved]);

  const editLast = useCallback(() => {
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      const m = conversation.messages[i]!;
      if (m.author_id === meId && m.seq > 0 && !m.deleted_at && !m.card && m.kind === "user") return setEditingSeq(m.seq);
    }
  }, [conversation.messages, meId]);

  const markAllRead = () => {
    if (!channel?.last_seq) return;
    shell.applyRead(channelId, channel.last_seq);
    void markRead({ channelId, seq: channel.last_seq });
  };

  const setState = async (patch: { notify?: ChatNotify; starred?: boolean; archived?: boolean }) => {
    const result = await setMemberState({ channelId, ...patch });
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      return false;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    shell.refresh();
    return true;
  };
  const exit = useConversationExit({ id: channelId, project_id: channel?.project_id ?? null, kind: channel?.kind ?? "public", name: channel?.name ?? null });
  const closeConversation = () => exit.close();
  const join = async () => {
    const result = await joinChannel({ channelId });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
    shell.refresh();
  };
  const unarchive = () => void exit.unarchive();
  const leaveOrArchive = async () => {
    const action = confirm;
    setConfirm(null);
    if (action === "archive") await exit.archive();
    else await exit.leave();
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
  const dmOnline = channel.kind === "dm" && channel.dm_user ? online[channel.dm_user.id] : undefined;
  const placeholder = isDirect ? `Message ${title}` : `Message #${title}`;
  const displayName = isChannel ? `#${title}` : title;
  const notify = (channel.notify ?? "all") as ChatNotify;
  const NotifyIcon = notify === "mute" ? BellOff : notify === "mentions" ? AtSign : Bell;
  const notifyMenu = (
    <DropdownMenuRadioGroup value={notify} onValueChange={(value) => void setState({ notify: value as ChatNotify })}>
      <DropdownMenuRadioItem value="all">All messages</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="mentions">Mentions only</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="mute">Mute</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
  const headerButton = "grid size-8 pointer-coarse:size-11 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <ConversationContext.Provider value={ctx}>
      <section className="flex h-full min-h-0 flex-col bg-card" aria-label={title} data-chat-pane="conversation">
        <header className="group/header flex h-14 flex-none items-center gap-1 border-b border-border px-2 sm:px-3">
          {surface === "window" || onBack ? (
            <button type="button" onClick={onBack ?? (() => router.push("/messages"))} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button>
          ) : (
            <span className="contents lg:hidden">
              <button type="button" onClick={goBack} className="nb-icon-button nb-touch-target" aria-label="Back to conversations"><ArrowLeft size={18} /></button>
            </span>
          )}
          {channel.kind === "dm" ? (
            <button type="button" onClick={() => openDetails("about")} className="relative inline-flex flex-none rounded-[5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label={`About ${title}`}>
              <UserAvatar identity={channel.dm_user} size={32} roundedClassName="rounded-[5px]" />
              {channel.dm_user ? <PersonPresenceBadge userId={channel.dm_user.id} live={channel.dm_user.id === meId || dmOnline} size={14} className="absolute" style={{ right: -3, bottom: -3 }} /> : null}
            </button>
          ) : null}
          <div className="min-w-0 flex-1 pl-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => openDetails("about")}
                className="group/title inline-flex min-w-0 items-center gap-1 rounded-xs text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title="Details (⌘I)"
              >
                {channel.kind !== "dm" ? <ConversationIcon channel={channel} size={18} strokeWidth={2.25} aria-hidden="true" className="shrink-0" /> : null}
                <h1 className="truncate text-[17px] font-bold leading-tight text-foreground group-hover/title:underline">{title}</h1>
              </button>
              {isMember ? (
                <button
                  type="button"
                  onClick={() => void setState({ starred: !channel.starred })}
                  className={`grid size-6 shrink-0 place-items-center rounded-[4px] hover:bg-muted pointer-coarse:size-11 ${channel.starred ? "" : "opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100 pointer-coarse:opacity-100"}`}
                  aria-label={channel.starred ? `Unstar ${isChannel ? "channel" : "conversation"}` : `Star ${isChannel ? "channel" : "conversation"}`}
                  aria-pressed={channel.starred}
                >
                  <Star size={14} className={channel.starred ? "text-[var(--status-warning)]" : "text-muted-foreground"} fill={channel.starred ? "currentColor" : "none"} />
                </button>
              ) : null}
              {channel.kind === "dm" && channel.dm_user ? (
                <DmHeaderStatus userId={channel.dm_user.id} live={channel.dm_user.id === meId || dmOnline} />
              ) : channel.project_title ? (
                <span className="hidden truncate text-[13px] text-muted-foreground sm:inline">{channel.project_title}</span>
              ) : null}
            </div>
            {channel.topic ? (
              <button type="button" onClick={() => openDetails("about")} className="block max-w-full truncate text-left text-[12px] text-muted-foreground hover:text-foreground">{channel.topic}</button>
            ) : isMember && isChannel ? (
              <button type="button" onClick={() => openDetails("about")} className="block text-left text-[12px] text-muted-foreground/80 hover:text-foreground">Add a topic</button>
            ) : null}
          </div>
          {surface === "window" ? windowActions : (
            <>
              {isMember ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className={headerButton} aria-label={`Notifications: ${NOTIFY_LABEL[notify]}`} title={`Notifications: ${NOTIFY_LABEL[notify]}`}>
                    <NotifyIcon size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                    {notifyMenu}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {isMember ? (
                <Link href={`/messages/search?in=${channelId}`} className={headerButton} aria-label={`Search in ${displayName}`} title={`Search in ${displayName}`}>
                  <Search size={16} />
                </Link>
              ) : null}
              {channel.kind !== "dm" ? (
                <button
                  type="button"
                  onClick={() => openDetails("members")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[5px] px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-11"
                  aria-label={`${channel.member_count} members`}
                  title="Members"
                >
                  <span className="hidden items-center -space-x-1.5 sm:inline-flex">
                    {people.slice(0, 3).map((p) => (
                      <span key={p.id} className="relative inline-block rounded-[4px] ring-2 ring-card">
                        <UserAvatar title="" identity={p} size={22} roundedClassName="rounded-[4px]" />
                        <PersonPresenceBadge userId={p.id} live={memberOnline[p.id]} size={8} className="absolute" style={{ right: -2, bottom: -2, ["--presence-cut" as string]: "var(--card)" }} />
                      </span>
                    ))}
                  </span>
                  {!people.length ? <Users size={14} aria-hidden="true" /> : null}
                  <span className="font-mono text-[12px] font-medium text-foreground">{channel.member_count}</span>
                </button>
              ) : null}
              {!isMember && channel.kind === "public" && !archived ? (
                <button type="button" onClick={() => void join()} className="ml-1 inline-flex h-8 items-center rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground">Join</button>
              ) : null}
              {isMember ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="nb-icon-button nb-touch-target" aria-label="More options">
                    <MoreHorizontal size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    {canAddPeople(channel) ? <DropdownMenuItem onSelect={() => setDialog("people")}><UserPlus size={14} className="mr-2" /> Add people</DropdownMenuItem> : null}
                    {canAddPeople(channel) ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem onSelect={() => { void copyWithToast(`${window.location.origin}${conversationHref(channelId)}`, "Link copied"); }}>
                      <Link2 size={14} className="mr-2" /> Copy link
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={markAllRead}><Check size={14} className="mr-2" /> Mark as read</DropdownMenuItem>
                    {channel.kind === "dm" || (!channel.is_default && !channel.application_id) || (channel.can_admin && isChannel && !channel.is_default) ? <DropdownMenuSeparator /> : null}
                    {channel.kind === "dm" ? (
                      <DropdownMenuItem onSelect={() => void closeConversation()}>Close conversation</DropdownMenuItem>
                    ) : !channel.is_default && !channel.application_id ? (
                      <DropdownMenuItem onSelect={() => setConfirm("leave")}>Leave {isChannel ? "channel" : "conversation"}</DropdownMenuItem>
                    ) : null}
                    {channel.can_admin && isChannel && !channel.is_default && !archived ? (
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm("archive")}>
                        <Archive size={14} className="mr-2" /> Archive channel
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          )}
        </header>

        {isMember && surface === "page" ? (
          <ChannelTabBar
            activeTab={activeTab.id}
            tabs={tabs}
            pinCount={pinCount}
            onSelectTab={setTab}
            onCloseTab={(item) => void closeTab(item)}
            onAddCanvas={isChannel ? (from) => (from === "blank" ? openCanvas() : setDialog(from === "existing" ? "existing" : "template")) : undefined}
            onAddTasks={channel.project_id && !(sharedTabs.data ?? []).some((t) => t.kind === "tasks") ? () => void addTab("tasks", "Tasks") : undefined}
            onAddFiles={!(sharedTabs.data ?? []).some((t) => t.kind === "files") ? () => void addTab("files", "Files") : undefined}
            onAddBookmark={() => setDialog("bookmark")}
            onEditTabs={(sharedTabs.data ?? []).length ? () => setDialog("tabs") : undefined}
            hasCanvas={Boolean(canvasQuery.data)}
          />
        ) : null}

        {!isMember && !canPreview ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-[15px]">You&apos;re not in <span className="font-medium">{displayName}</span>.</p>
              {channel.description ? <p className="text-[13px] text-muted-foreground">{channel.description}</p> : null}
            </div>
          </div>
        ) : activeTab.kind === "canvas" ? (
          <ChannelCanvas key={channelId} channel={channel} channelId={channelId} seed={canvasSeed} onDelete={() => setConfirm("canvas")} />
        ) : activeTab.kind === "pins" ? (
          <Pins channelId={channelId} />
        ) : activeTab.kind === "files" ? (
          <FilesView channelId={channelId} />
        ) : activeTab.kind === "tasks" && channel.project_id ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TasksTab
              projectId={channel.project_id}
              projectSlug={channel.project_slug ?? undefined}
              projectName={channel.project_title ?? undefined}
              currentUserId={meId ?? undefined}
              currentUserName={profile?.fullName ?? profile?.username ?? null}
              currentUserAvatarUrl={profile?.avatarUrl ?? null}
              canEditTasks={Boolean(channel.can_admin || channel.is_member)}
              canManageWorkflow={Boolean(channel.can_admin)}
            />
          </div>
        ) : (
          <>
            {conversation.query.isLoading && !conversation.messages.length ? <TimelineSkeleton /> : (
              <Timeline
                key={`${channelId}:${timeline.epoch}`}
                messages={conversation.messages}
                lastReadSeq={isMember ? channel.last_read_seq : channel.last_seq}
                meId={meId}
                hasOlder={Boolean(conversation.query.hasNextPage)}
                loadingOlder={conversation.query.isFetchingNextPage}
                loadOlder={() => void conversation.query.fetchNextPage()}
                intro={<Intro channel={channel} meId={meId} isMember={isMember} onDetails={() => openDetails("about")} onAddPeople={() => setDialog("people")} onCanvas={isChannel ? () => openCanvas() : undefined} />}
                highlightSeq={around}
                onSeen={isMember ? conversation.markSeen : () => undefined}
                onMarkRead={isMember ? markAllRead : undefined}
                typing={typing.names.length > 0}
              />
            )}
            {conversation.query.isError ? (
              <p role="alert" className="border-t border-border bg-[var(--status-danger-soft)] px-4 py-2 text-[13px] text-[var(--status-danger)]">
                Messages couldn&apos;t load. <button type="button" className="font-medium underline" onClick={() => void conversation.query.refetch()}>Retry</button>
              </p>
            ) : null}
            {!isMember ? (
              <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border bg-muted/40 px-4 py-3 text-[13px]">
                <span className="text-muted-foreground">You&apos;re previewing <strong className="font-semibold text-foreground">{displayName}</strong>.</span>
                <button type="button" onClick={() => void join()} className="inline-flex h-8 items-center rounded-[5px] bg-primary px-3 font-medium text-primary-foreground">Join channel</button>
              </div>
            ) : archived ? (
              <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
                <span>This channel is archived. You can read it, but not post.</span>
                {channel.can_admin ? <button type="button" onClick={() => void unarchive()} className="inline-flex h-8 items-center rounded-[5px] border border-border px-3 font-medium text-foreground hover:bg-muted">Unarchive</button> : null}
              </div>
            ) : (
              <Composer
                channelId={channelId}
                placeholder={placeholder}
                people={people}
                allowBroadcast={!isDirect && channel.member_count <= CHAT_BROADCAST_MENTION_MAX_MEMBERS}
                canCreateTask={Boolean(channel.project_id)}
                onOpenCanvas={isChannel && surface === "page" ? () => openCanvas() : undefined}
                onTyping={typing.notify}
                typingNames={typing.names}
                onEditLast={editLast}
              />
            )}
          </>
        )}
      </section>
      {dialog === "bookmark" ? <AddTabLinkDialog open onOpenChange={(open) => !open && setDialog(null)} onAddTab={(name, url) => void addTab("link", name, url)} /> : null}
      {dialog === "tabs" ? <EditTabsDialog open onOpenChange={(open) => !open && setDialog(null)} tabs={tabs.filter((t) => t.shared)} onSaveTabs={(next) => void saveTabs(next)} /> : null}
      {dialog === "template" ? (
        <CanvasTemplateModal
          open
          onOpenChange={(open) => !open && setDialog(null)}
          onSelectTemplate={(template: CanvasTemplate) => {
            const generated = template.generate(channel.name || "general", channel.project_title ?? null);
            seedCanvas({ title: generated.title, body: generated.content });
          }}
          channelName={channel.name || "general"}
          projectName={channel.project_title ?? null}
        />
      ) : null}
      {dialog === "existing" ? (
        <ExistingCanvasModal
          open
          onOpenChange={(open) => !open && setDialog(null)}
          onSelectExisting={(name: string, body: string) => {
            seedCanvas({ title: name, body });
          }}
          projectId={channel.project_id}
          currentChannelId={channelId}
        />
      ) : null}
      {dialog === "people" ? <AddPeopleDialog channelId={channelId} title={displayName} onClose={() => setDialog(null)} /> : null}
      {shareSeq !== null ? <ShareDialog channelId={channelId} seq={shareSeq} onClose={() => setShareSeq(null)} /> : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "replace" ? "Replace the canvas?" : confirm === "canvas" ? "Delete this canvas?" : confirm === "archive" ? `Archive ${displayName}?` : `Leave ${isChannel ? displayName : "this conversation"}?`}
        description={confirm === "replace"
          ? "The current canvas is replaced for everyone in the channel. Copy it first if you want to keep it."
          : confirm === "canvas"
          ? "It's removed for everyone in the channel. Copy it first if you want to keep it."
          : confirm === "archive"
            ? "Nobody can post in an archived channel. History stays readable, and admins can unarchive it."
            : channel.kind === "public" ? "You can rejoin a public channel at any time." : "You'll need to be added again to come back."}
        confirmLabel={confirm === "replace" ? "Replace" : confirm === "canvas" ? "Delete canvas" : confirm === "archive" ? "Archive" : "Leave"}
        variant="destructive"
        onConfirm={() => {
          if (confirm === "replace") {
            setConfirm(null);
            if (pendingSeed) openCanvas(pendingSeed);
            setPendingSeed(null);
          } else if (confirm === "canvas") {
            setConfirm(null);
            void removeCanvas();
          } else void leaveOrArchive();
        }}
      />
    </ConversationContext.Provider>
  );
}

/** Next to a DM's name: their status (emoji + text), else when they were active. */
function DmHeaderStatus({ userId, live }: { userId: string; live?: boolean }) {
  const presence = usePersonPresence(userId, { live });
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate text-[13px] text-muted-foreground">
      {presence.status ? <StatusInline emoji={presence.status.emoji} text={presence.statusText} className="truncate" /> : <span className="truncate">{presence.availabilityText}</span>}
    </span>
  );
}
