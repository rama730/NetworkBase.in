"use client";

import { SidebarSheetToggle } from "@/components/messages/MessagesSidebar";
import { useBugsAdded } from "@/components/messages/useBugsAdded";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Ban, Bell, BellDot, BellOff, Bookmark, CheckCheck, ExternalLink, FileText, Hash, Link2, Lock, LogOut, MoreHorizontal, PanelRight, Pencil, Pin, Search, Star, UserPlus, Users, X } from "lucide-react";
import { toast } from "@/lib/feedback";

import { deleteCanvas } from "@/app/actions/chat/canvas";
import { addChannelTab, joinChannel, removeChannelTab, saveChannelTabs } from "@/app/actions/chat/channels";
import { setMemberState } from "@/app/actions/chat/members";
import { listPins, pinMessage } from "@/app/actions/chat/messages";
import { markRead } from "@/app/actions/chat/read";
import { readChatUi, useChatUi, writeChatUi } from "@/components/messages/chat-ui-store";
import { useBack } from "@/hooks/useBack";
import { useBlockFlow, useMuteToggle } from "@/components/privacy/BlockDialog";
import { useReportDialog } from "@/components/reports/ReportDialog";
import { useBlockedIds, useChatShell, useMutedIds } from "@/components/messages/ChatShellProvider";
import type { CanvasSeed } from "@/components/messages/ChannelCanvas";
import { ChannelTabBar } from "@/components/messages/ChannelTabBar";
import { ConversationContext, useConversationContext, type ConversationContextValue } from "@/components/messages/conversation-context";
import { MessageBody } from "@/components/messages/MessageBody";
import { FilesView } from "@/components/messages/parts/FilesView";
import { Timeline } from "@/components/messages/Timeline";
import { usePanes } from "@/components/messages/usePanes";
import { useChannelCanvas, useChannelDetails, useChannelMembers, useChannelMessages, useChannelTabs, usePersonContext, useSavedSeqs, useTyping } from "@/components/messages/useConversation";
import { SkeletonTasks } from "@/components/workspaces/skeletons/SkeletonTasks";
import { PersonPresenceBadge, PresenceAvatar } from "@/components/presence/PersonPresence";
import { StatusInline } from "@/components/presence/StatusInline";
import { usePersonPresence } from "@/components/presence/usePresence";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { RowsSkeleton } from "@/components/messages/parts/RowsSkeleton";
import { detailsKeys, isDetailsKey, keyLabel } from "@/components/messages/keys";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitlePrefix } from "@/hooks/useDocumentTitlePrefix";
import type { ChannelDetails } from "@/app/actions/chat/channels";
import type { CanvasTemplate } from "@/lib/messaging/canvas-store";
import { conversationTabs, restoreTabOrder, type ChannelTabItem } from "@/lib/messaging/channel-tabs";
import { ApplicationStatusBar } from "@/components/messages/cards/ApplicationCard";
import { APPLICATION_STATUS_LABEL, isDecidedApplication } from "@/lib/messaging/application-status";
import { canAddPeople, counterpart, channelTitle, isSelfDm, notifiesEveryMessage, notifyChoice, notifyChoices, notifyLabel, personName } from "@/lib/messaging/channel-view";
import { CHAT_BROADCAST_MENTION_MAX_MEMBERS } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { cameFromOutsideMessages, conversationHref, messageHref, type DetailsTab } from "@/lib/messaging/routes";
import { currentEntry, subscribeEntry } from "@/lib/navigation/in-app-history";
import type { ChatMessageView, ChatNotify, ChatPerson } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { copyWithToast } from "@/lib/clipboard";
import { useConversationExit } from "@/components/messages/useConversationExit";
import { useChatWindow } from "@/components/messages/chat-window-store";
import { ConnectionBanner } from "@/components/messages/ConnectionBanner";
import { DropOverlay, draftKeyOf, dropFilesTo, useFileDrop } from "@/components/messages/useFileDrop";
import { ConversationIcon } from "@/components/messages/ConversationIcon";
import { ConversationSkeleton, TimelineSkeleton } from "@/components/messages/ConversationSkeleton";
import { channelHome } from "@/lib/organizations/chat-rules";

type Props = {
  channelId: string;
  around?: number | null;
  /** "window" = launcher: Back instead of the full-page chrome, threads open in place. */
  surface?: "page" | "window";
  onBack?: () => void;
  onOpenThread?: (rootSeq: number) => void;
  /** Launcher header controls (minimize, close); the window ⋯ adds Open in Messages. */
  windowActions?: React.ReactNode;
};


function IntroButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <Button type="button" variant="outline" size="sm" onClick={onClick} className="pointer-coarse:h-11">{children}</Button>;
}

function Intro({ channel, meId, isMember, hasCanvas, onDetails, onAddPeople, onCanvas }: {
  channel: ChannelDetails; meId: string | null; isMember: boolean; hasCanvas: boolean; onDetails: () => void; onAddPeople: () => void; onCanvas?: () => void;
}) {
  // Kept minimal on purpose (the DM design): the header already shows who it is and links to their details.
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
  if (channel.application_id) {
    const meta = channel.application;
    const subject = meta ? `${meta.role_removed ? "a removed role" : meta.role_title ?? "a role"} on ${meta.project_title}` : "a workspace role";
    const decided = meta ? isDecidedApplication(meta.status) : false;
    const outcome = meta ? (APPLICATION_STATUS_LABEL[meta.status] ?? meta.status).toLowerCase() : "";
    return (
      <div className="px-4 py-4 text-[13px] text-muted-foreground">
        <p>
          {meta?.is_applicant
            ? `This is your application for ${subject}. ${decided ? `It was ${outcome}. You can still ask or reply here.` : "The workspace’s reviewers answer here, and you can ask or add anything they need."}`
            : `This is the application${meta ? ` from ${personName(meta.applicant)}` : ""} for ${subject}. ${decided ? `It was ${outcome}. You can still reply here.` : "Accept or decline from the bar above, and ask questions here."}`}
        </p>
      </div>
    );
  }
  if (channel.name === null) {
    return (
      <div className="space-y-3 px-4 py-5">
        <p className="text-[13px] text-muted-foreground">This is the start of your group conversation. Give it a name so it’s easy to find.</p>
        {isMember ? <div className="flex flex-wrap gap-2"><IntroButton onClick={onDetails}>Name the group</IntroButton><IntroButton onClick={onAddPeople}><UserPlus size={16} /> Add people</IntroButton></div> : null}
      </div>
    );
  }
  const isDefault = Boolean(channel.is_default);
  return (
    <div className="space-y-4 px-4 pb-6 pt-6 sm:px-6 sm:pt-8">
      <div>
        <h2 className="nb-section-title flex flex-wrap items-center gap-x-2 text-foreground">
          <span>{isDefault ? "Welcome to" : "This is the start of"}</span>
          <span className="inline-flex items-center gap-1">
            {channel.kind === "private" ? <Lock size={18} className="text-muted-foreground" aria-hidden="true" /> : <Hash size={18} className="text-muted-foreground" aria-hidden="true" />}
            <span>{channel.name}</span>
          </span>
        </h2>
        <p className="nb-body mt-2 max-w-2xl text-muted-foreground">
          {channel.description || (isDefault
            ? `The general channel of ${channel.project_title ?? "this workspace"}. Every member is here: share updates, decisions and wins.`
            : `Everything about #${channel.name} lives here: conversations, files and decisions.`)}
        </p>
        {channel.created_at ? (
          <p className="nb-meta mt-1">
            Created {new Date(channel.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          </p>
        ) : null}
      </div>
      {isMember ? (
        <div className="flex flex-wrap gap-2">
          {!channel.description ? <IntroButton onClick={onDetails}>Add a description</IntroButton> : null}
          <IntroButton onClick={onAddPeople}><UserPlus size={16} /> Add people</IntroButton>
          {/* Once a canvas exists its tab is right above; the intro only offers to start one. */}
          {onCanvas && !hasCanvas ? <IntroButton onClick={onCanvas}>Create a note</IntroButton> : null}
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
  const refreshPins = () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.pins(channelId) });
  const unpin = async () => {
    const result = await pinMessage({ channelId, seq: message.seq, on: false });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    refreshPins();
    toast.success("Unpinned", {
      action: {
        label: "Undo",
        onClick: () => void pinMessage({ channelId, seq: message.seq, on: true }).then((undo) => {
          if (!undo.success) toast.error(chatErrorMessage(undo.error));
          refreshPins();
        }),
      },
    });
  };
  const when = new Date(message.created_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <li className="flex gap-3 border-b border-border px-4 py-3">
      <UserAvatar identity={message.author} size={34} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[13px]">
          <span className="font-medium">{personName(message.author)}</span>
          <time dateTime={message.created_at} className="nb-meta" title={new Date(message.created_at).toLocaleString()}>{when}</time>
        </p>
        {message.body ? <MessageBody body={message.body} nameOf={ctx.nameOf} channelNameOf={ctx.channelNameOf} meId={ctx.meId} /> : null}
        {message.attachments.length ? <p className="text-[13px] text-muted-foreground">{message.attachments.map((a) => a.name || "Attachment").join(", ")}</p> : null}
        <div className="mt-1 flex gap-1">
          {/* A pinned thread reply opens its thread (replies aren't in the main timeline). */}
          <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(messageHref(channelId, message.seq, message.thread_root_seq), { scroll: false })} className="-ml-2.5 pointer-coarse:h-11">Jump to message</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void unpin()} className="text-muted-foreground pointer-coarse:h-11">Unpin</Button>
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
      if (!result.success) throw new Error(result.error);
      return result.messages;
    },
  });
  if (pins.isLoading) return <RowsSkeleton label="Loading pins…" />;
  // An error is not "nothing pinned".
  if (pins.isError) return <ErrorNotice what="Pins" onRetry={() => void pins.refetch()} className="m-4" />;
  if (!pins.data?.length) return <EmptyState compact icon={Pin} title="Nothing pinned yet" description="Pin important messages from their actions menu." className="m-4" />;
  return <ul aria-label="Pins" className="app-scroll app-scroll-y min-h-0 flex-1">{pins.data.map((m) => <PinRow key={m.seq} message={m} channelId={channelId} />)}</ul>;
}

// The editors (Tiptap) load after the timeline; the placeholders hold their space.
const Composer = dynamic(() => import("@/components/messages/Composer").then((m) => m.Composer), {
  ssr: false,
  loading: () => <div className="nb-message-composer border-t border-border bg-card px-3 pt-2 sm:px-4"><div className="h-[86px] rounded-md border border-input" /></div>,
});
const ChannelCanvas = dynamic(() => import("@/components/messages/ChannelCanvas").then((m) => m.ChannelCanvas), { ssr: false, loading: () => <div className="flex-1" /> });
const CanvasTemplateModal = dynamic(() => import("@/components/messages/CanvasTemplateModal").then((m) => m.CanvasTemplateModal), { ssr: false });
const AddTabLinkDialog = dynamic(() => import("@/components/messages/AddTabLinkDialog").then((m) => m.AddTabLinkDialog), { ssr: false });
const EditTabsDialog = dynamic(() => import("@/components/messages/EditTabsDialog").then((m) => m.EditTabsDialog), { ssr: false });
const ExistingCanvasModal = dynamic(() => import("@/components/messages/ExistingCanvasModal").then((m) => m.ExistingCanvasModal), { ssr: false });
const AddPeopleDialog = dynamic(() => import("@/components/messages/parts/AddPeople").then((m) => m.AddPeopleDialog), { ssr: false });
const ShareDialog = dynamic(() => import("@/components/messages/parts/ShareDialog").then((m) => m.ShareDialog), { ssr: false });
const TasksTab = dynamic(() => import("@/components/workspaces/v2/TasksTab"), { ssr: false, loading: () => <SkeletonTasks /> });

export function ConversationView({ channelId, around = null, surface = "page", onBack, onOpenThread, windowActions }: Props) {
  const router = useRouter();
  const goBack = useBack("/messages");
  // Opened from outside Messages, desktop gets the arrow too: the list beside it isn't where you came from (R1).
  const entry = useSyncExternalStore(subscribeEntry, currentEntry, () => null);
  const outside = cameFromOutsideMessages(entry?.from ?? null);
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const meId = user?.id ?? null;
  const shell = useChatShell();
  const panes = usePanes(channelId, surface === "page");
  const setProject = useChatUi((state) => state.setProject);
  const details = useChannelDetails(channelId);
  const channel = details.data ?? null;
  const isMember = Boolean(channel?.is_member);
  const archived = Boolean(channel?.channel_archived_at);
  // Block from the DM itself (Blocking B5, B44): the blocker sees their own block; the other person only "can't reply".
  const blockFlow = useBlockFlow("message");
  const toggleMute = useMuteToggle();
  const dmOther = channel?.kind === "dm" ? channel.dm_user : null;
  const reportDm = useReportDialog({ kind: "person", targetId: dmOther?.id ?? "", noun: "person", personName: dmOther ? personName(dmOther) : null });
  const blockedIds = useBlockedIds();
  const mutedIds = useMutedIds();
  // Folding is for shared spaces, group chats included; a 1:1 DM across a block stays readable as it was (B10, B44).
  const oneToOne = channel?.kind === "dm";
  // Project members read a public channel before joining it (Slack preview).
  const canPreview = !isMember && channel?.kind === "public" && !archived;
  const isChannel = Boolean(channel && channel.kind !== "dm" && channel.name !== null);
  const isDirect = channel?.kind === "dm" || (channel?.kind === "private" && channel?.name === null);
  // An application thread is a fixed private room: no bookmarks, files tab, tasks, canvases or sharing out of it.
  const isApplication = Boolean(channel?.application_id);
  const canCloseApplication = isApplication && isDecidedApplication(channel?.application?.status);
  const members = useChannelMembers(channelId, isMember);
  const people = useMemo(() => members.data ?? [], [members.data]);
  const searchParams = useSearchParams();
  // The window has no URL of its own: the host page's ?tab= isn't for it.
  const linkedTab = surface === "page" ? searchParams?.get("tab") ?? null : null;
  const pathname = usePathname();
  const [tab, setTabState] = useState<string>(linkedTab ?? "messages");
  // ?tab= is the open view, both ways: links open a tab, and picking one writes it (a refresh keeps it).
  useEffect(() => setTabState(linkedTab ?? "messages"), [linkedTab]);
  const setTab = useCallback((id: string) => {
    setTabState(id);
    if (surface !== "page" || !pathname) return;
    const currentSearch = searchParams?.toString() ?? "";
    const href = conversationHref(channelId, id === "messages" ? { tab: null } : { tab: id, m: null }, currentSearch);
    const current = `/messages/${channelId}${currentSearch ? `?${currentSearch}` : ""}`;
    if (href !== current) {
      router.replace(href, { scroll: false });
    }
  }, [channelId, pathname, router, searchParams, surface]);
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
  // The browser tab says which conversation ("#design | Messages"), on the full page only.
  useDocumentTitlePrefix(surface === "page" && meId && channel && !details.isError ? (isSelfDm(channel, meId) ? "Notes to self" : channel.name ? `#${channel.name}` : channelTitle(channel, meId)) : null);
  // Bumped on each send, so the timeline follows your message down even if you were reading older ones.
  const [sentTick, setSentTick] = useState(0);

  const newestLoadedSeq = useMemo(() => {
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      if (conversation.messages[i]!.seq > 0) return conversation.messages[i]!.seq;
    }
    return 0;
  }, [conversation.messages]);

  const shellChannel = useMemo(
    () => shell.data?.channels.find((c) => c.id === channelId),
    [channelId, shell.data?.channels],
  );

  const effectiveLastReadSeq = isMember
    ? Math.max(channel?.last_read_seq ?? 0, shellChannel?.last_read_seq ?? 0)
    : (channel?.last_seq ?? 0);

  const onSent = useCallback(() => {
    setSentTick((tick) => tick + 1);
    const target = Math.max(channel?.last_seq ?? 0, newestLoadedSeq);
    if (target > 0) {
      shell.applyRead(channelId, target);
      queryClient.setQueryData<any>(queryKeys.chat.channel(channelId), (prev: any) =>
        prev ? { ...prev, last_read_seq: Math.max(prev.last_read_seq ?? 0, target), mention_count: 0 } : prev
      );
      conversation.flushRead(target);
    }
  }, [channel?.last_seq, channelId, conversation, newestLoadedSeq, queryClient, shell]);
  // Files dropped on the timeline go to this conversation's composer.
  const drop = useFileDrop((files) => dropFilesTo(draftKeyOf(channelId, null), files));

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
  const hasCanvas = isChannel && (Boolean(canvasQuery.data) || tab === "canvas");
  const tabs = useMemo(() => conversationTabs({
    pinCount,
    canvasTitle: hasCanvas ? canvasQuery.data?.title?.trim() || "Channel notes" : null,
    canvasHidden,
    active: tab,
    shared: sharedTabs.data ?? [],
    projectId: channel?.project_id ?? null,
  }), [canvasHidden, canvasQuery.data?.title, channel?.project_id, hasCanvas, pinCount, sharedTabs.data, tab]);
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  useEffect(() => {
    if (sharedTabs.isSuccess && (!isChannel || canvasQuery.isSuccess) && pinsQuery.isSuccess && tab !== "messages" && !tabs.some((t) => t.id === tab)) setTab("messages");
  }, [sharedTabs.isSuccess, canvasQuery.isSuccess, pinsQuery.isSuccess, isChannel, tab, tabs, setTab]);

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
    if (kind === "link" && !quiet) toast.success(`"${title}" link added for everyone`);
    return result.tab;
  };
  const closeTab = async (item: ChannelTabItem) => {
    if (item.kind === "canvas") {
      hideCanvas(true);
      setTab("messages");
      toast("Note tab hidden for you", { action: { label: "Undo", onClick: () => hideCanvas(false) } });
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
    const home = projectId && shell.data?.projects ? channelHome(projectId, shell.data.projects) : null;
    if (surface === "page" && home) setProject(home);
  }, [channel?.project_id, setProject, shell.data?.projects, surface]);

  const openDetails = useCallback((which: DetailsTab = "about") => {
    if (surface === "page") panes.openDetails(which);
    else router.push(conversationHref(channelId, { details: which }));
  }, [channelId, panes, router, surface]);

  // ⌘⇧I (Ctrl+Alt+I off a Mac) toggles Details (⌘I stays Italic in the composer), from anywhere on the page.
  useEffect(() => {
    if (surface !== "page") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isDetailsKey(e)) {
        e.preventDefault();
        if (panes.details) panes.closeDetails();
        else openDetails("about");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDetails, panes, surface]);

  // Mentions of people who left (or while previewing) still show a name: anyone the sidebar knows.
  const names = useMemo(() => {
    const known = new Map<string, string>();
    for (const c of shell.data?.channels ?? []) {
      if (c.dm_user) known.set(c.dm_user.id, personName(c.dm_user));
      for (const p of c.members_preview ?? []) known.set(p.id, personName(p));
    }
    for (const p of people) known.set(p.id, personName(p));
    return known;
  }, [people, shell.data?.channels]);
  const channelNames = useMemo(() => new Map((shell.data?.channels ?? []).filter((c) => c.name).map((c) => [c.id, c.name!])), [shell.data?.channels]);
  const nameOf = useCallback((id: string) => names.get(id), [names]);
  const channelNameOf = useCallback((id: string) => channelNames.get(id), [channelNames]);
  const openThread = useCallback((rootSeq: number) => {
    if (onOpenThread) onOpenThread(rootSeq);
    else panes.openThread(rootSeq);
  }, [onOpenThread, panes]);
  const openPinsTab = useCallback(() => setTab("pins"), [setTab]);
  const bugs = useBugsAdded(isApplication ? null : channel?.project_id);
  const ctx = useMemo<ConversationContextValue>(() => ({
    channelId, meId, canAdmin: Boolean(channel?.can_admin), isDm: Boolean(isDirect),
    people, nameOf, channelNameOf, editingSeq, setEditingSeq, openThread, inThread: false,
    openPinsTab, isMember, projectId: isApplication ? null : channel?.project_id ?? null, bugs,
    savedSeqs: saved.seqs, setSaved: (seq, on, remindAt) => void saved.setSaved(seq, on, remindAt), share: isApplication ? undefined : setShareSeq,
    blockedIds: oneToOne ? undefined : blockedIds, mutedIds: oneToOne ? undefined : mutedIds, openBlock: blockFlow.openBlock, toggleMute,
  }), [blockFlow.openBlock, toggleMute, blockedIds, mutedIds, oneToOne, channel?.can_admin, bugs, channel?.project_id, channelId, channelNameOf, editingSeq, isApplication, isDirect, isMember, meId, nameOf, openPinsTab, openThread, people, saved]);

  const editLast = useCallback(() => {
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      const m = conversation.messages[i]!;
      if (m.author_id === meId && m.seq > 0 && !m.deleted_at && !m.card && m.kind === "user") return setEditingSeq(m.seq);
    }
  }, [conversation.messages, meId]);

  const hasUnread = Boolean(
    channel && (channel.last_seq > effectiveLastReadSeq || newestLoadedSeq > effectiveLastReadSeq),
  );
  const markAllRead = async (announce = false) => {
    const target = Math.max(channel?.last_seq ?? 0, newestLoadedSeq);
    if (target <= 0) return;
    shell.applyRead(channelId, target);
    queryClient.setQueryData<any>(queryKeys.chat.channel(channelId), (prev: any) =>
      prev ? { ...prev, last_read_seq: Math.max(prev.last_read_seq ?? 0, target), mention_count: 0 } : prev
    );
    conversation.flushRead(target);
    const result = await markRead({ channelId, seq: target });
    if (!result.success) {
      shell.refresh();
      return void toast.error(chatErrorMessage(result.error));
    }
    if (announce) toast.success("Conversation marked as read");
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
  const placeProject = channel?.project_id && !isApplication ? shell.data?.projects?.find((p) => p.id === channel.project_id) ?? null : null;
  const orgPlace = placeProject && (placeProject.kind === "organization" || placeProject.parent_id)
    ? { title: placeProject.title, href: `/${placeProject.kind === "organization" ? "org" : "projects"}/${encodeURIComponent(placeProject.slug ?? placeProject.id)}` }
    : null;
  const exit = useConversationExit({ id: channelId, project_id: channel?.project_id ?? null, kind: channel?.kind ?? "public", name: channel?.name ?? null });
  // In the window, a conversation you close or leave drops back to the list.
  const closeConversation = async () => {
    if (await exit.close() && surface === "window") onBack?.();
  };
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
    else if (await exit.leave() && surface === "window") onBack?.();
  };

  const backButton = surface === "window" || onBack ? (
    <button type="button" onClick={onBack ?? (() => router.push("/messages"))} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={16} /></button>
  ) : (
    <span className={outside ? "contents" : "contents lg:hidden"}>
      <button type="button" onClick={goBack} className="nb-icon-button nb-touch-target" aria-label={outside ? "Back" : "Back to conversations"}><ArrowLeft size={16} /></button>
    </span>
  );
  // A failed refetch keeps the conversation on screen; only a first load that fails says so.
  if (details.isError && !channel) {
    const missing = ["chat_channel_not_found", "chat_not_member", "chat_invalid_input"].includes(details.error.message);
    return (
      <div className="flex h-full flex-col bg-card">
        <div className="flex h-14 flex-none items-center gap-2 border-b border-border px-2 sm:px-3">{backButton}<span className="flex-1" />{windowActions}</div>
        <div className="grid flex-1 place-items-center p-6 text-center">
          {missing ? (
            <div className="space-y-2">
              <h1 className="nb-card-title">Conversation not found</h1>
              <p className="nb-compact text-muted-foreground">It may be private, archived, or you may have left it.</p>
              <Button asChild variant="outline" size="sm"><Link href="/messages">Back to messages</Link></Button>
            </div>
          ) : (
            <ErrorNotice what="This conversation" onRetry={() => void details.refetch()} />
          )}
        </div>
      </div>
    );
  }
  if (!channel) return <ConversationSkeleton header={<>{backButton}{surface === "window" ? <span className="ml-auto flex items-center">{windowActions}</span> : null}</>} tabs={surface === "page"} />;

  const self = isSelfDm(channel, meId);
  const other = counterpart(channel);
  const meta = channel.application;
  const applicationSubline = !meta ? null
    : meta.is_applicant
      ? `With ${personName(meta.lead)} · Owner of ${meta.project_title}`
      : `${meta.project_title} · Applied ${new Date(meta.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const title = self ? `${personName(channel.dm_user)} (you)` : channelTitle(channel, meId);
  const placeholder = self ? "Write a note…"
    : channel.application_id ? (channel.application?.is_applicant ? "Message the reviewers" : `Message ${channel.application ? personName(channel.application.applicant).split(" ")[0] : "the applicant"}`)
      : isDirect ? `Message ${title}` : `Message #${title}`;
  const displayName = isChannel ? `#${title}` : title;
  const dmPerson = channel.kind === "dm" && channel.dm_user && !self ? { id: channel.dm_user.id, name: personName(channel.dm_user) } : null;
  const blockItem = dmPerson ? (channel.blocked_by_me
    ? <DropdownMenuItem onSelect={() => blockFlow.openUnblock(dmPerson)}><Ban /> Unblock {dmPerson.name}</DropdownMenuItem>
    : <DropdownMenuItem variant="destructive" onSelect={() => blockFlow.openBlock(dmPerson)}><Ban /> Block {dmPerson.name}</DropdownMenuItem>) : null;
  const notify = notifyChoice(channel, (channel.notify ?? "all") as ChatNotify);
  // Bell = the default; a dot = DMs set to mentions only; crossed out = muted.
  const NotifyIcon = notify === "mute" ? BellOff : notify === "mentions" && notifiesEveryMessage(channel) ? BellDot : Bell;
  const notifyText = notifyLabel(channel, notify);
  const notifyMenu = (
    <DropdownMenuRadioGroup value={notify} onValueChange={(value) => void setState({ notify: value as ChatNotify })}>
      {notifyChoices(channel).map((choice) => <DropdownMenuRadioItem key={choice.value} value={choice.value}>{choice.label}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
  );
  const headerButton = "nb-icon-button nb-touch-target size-8";
  const detailsShortcut = keyLabel(detailsKeys());
  // DMs with only Messages skip the tab bar (40px for one tab); bookmarks and files move to ⋯.
  const showTabBar = isMember && surface === "page" && !isApplication && (tabs.length > 1 || !isDirect);
  const starLabel = channel.starred ? `Unstar ${isChannel ? "channel" : "conversation"}` : `Star ${isChannel ? "channel" : "conversation"}`;

  return (
    <ConversationContext.Provider value={ctx}>
      <section className="flex h-full min-h-0 flex-col bg-card" aria-label={title} data-chat-pane="conversation">
        <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2 sm:px-3">
          {backButton}
          {surface === "page" ? <SidebarSheetToggle /> : null}
          {channel.kind === "dm" ? (
            <button type="button" onClick={() => openDetails("about")} className="inline-flex flex-none rounded-md" aria-label={`About ${title}`}>
              <PresenceAvatar identity={channel.dm_user} userId={channel.dm_user?.id} size={34} title="" />
            </button>
          ) : other ? (
            // An application thread shows the person on the other side: the applicant to reviewers, the project's lead to the applicant.
            <button type="button" onClick={() => openDetails("about")} className="inline-flex flex-none rounded-md" aria-label={`About ${personName(other)}`}>
              <PresenceAvatar identity={other} userId={other.id} size={34} title="" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1 pl-1">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => openDetails("about")}
                className="group/title inline-flex min-w-0 items-center gap-1 rounded-sm text-left"
                title={`Conversation details (${detailsShortcut})`}
              >
                {channel.kind !== "dm" && !other ? <ConversationIcon channel={channel} size={16} aria-hidden="true" className="shrink-0" /> : null}
                <h1 className="nb-card-title truncate text-foreground group-hover/title:underline">{title}</h1>
              </button>
              {/* Only a starred conversation shows its star (click to unstar); starring lives in ⋯ and Details, so no empty slot. */}
              {isMember && channel.starred ? (
                <button type="button" onClick={() => void setState({ starred: false })} className="nb-icon-button nb-touch-target size-7 shrink-0" aria-label={starLabel} title={starLabel}>
                  <Star size={14} className="text-primary" fill="currentColor" />
                </button>
              ) : null}
              {channel.kind === "dm" && channel.dm_user ? (
                <DmHeaderStatus userId={channel.dm_user.id} />
              ) : null}
            </div>
            {applicationSubline ? (
              <p className="truncate text-xs leading-4 text-muted-foreground">{applicationSubline}</p>
            ) : null}
            {/* One quiet line under the name: the project and the topic, when there are any. */}
            {channel.kind !== "dm" && !channel.application && (channel.project_title || channel.topic) ? (
              <p className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
                {channel.project_title ? <span className="hidden flex-none truncate sm:inline">{channel.project_title}</span> : null}
                {channel.project_title && channel.topic ? <span aria-hidden="true" className="hidden sm:inline">·</span> : null}
                {channel.topic ? (
                  <button type="button" onClick={() => openDetails("about")} className="min-w-0 truncate text-left hover:text-foreground" title={channel.topic}>{channel.topic}</button>
                ) : null}
              </p>
            ) : null}
          </div>
          {surface === "window" ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger className="nb-icon-button nb-touch-target" aria-label="More options">
                  <MoreHorizontal size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {isMember ? (
                    <>
                      <DropdownMenuItem onSelect={() => void setState({ starred: !channel.starred })}><Star /> {starLabel}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                      {notifyMenu}
                      <DropdownMenuSeparator />
                      {channel.kind === "dm" || canCloseApplication ? (
                        <DropdownMenuItem onSelect={() => void closeConversation()}><X /> Close conversation</DropdownMenuItem>
                      ) : !channel.is_default && !channel.application_id ? (
                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("leave")}><LogOut /> Leave {isChannel ? "channel" : "conversation"}</DropdownMenuItem>
                      ) : null}
                      {blockItem}
                    </>
                  ) : null}
                  <DropdownMenuItem onSelect={() => { useChatWindow.getState().close(); router.push(conversationHref(channelId, { m: around })); }}>
                    <ExternalLink /> Open in Messages
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {windowActions}
            </>
          ) : (
            <>
              {isMember ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className={`${headerButton} hidden sm:inline-flex`} aria-label={`Notifications: ${notifyText}`} title={`Notifications: ${notifyText}`}>
                    <NotifyIcon size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                    {notifyMenu}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {/* Org #general and child project channels link to their page (report §25.5): "Open Compiler Lab →". */}
              {orgPlace ? (
                <Link href={orgPlace.href} className="nb-ui-label hidden shrink-0 items-center px-2 text-[13px] text-primary hover:underline sm:inline-flex" data-testid="channel-open-project">
                  Open {orgPlace.title} →
                </Link>
              ) : null}
              {isMember ? (
                <Link href={`/messages/search?in=${channelId}`} className={`${headerButton} hidden sm:inline-flex`} aria-label={`Search in ${displayName}`} title={`Search in ${displayName}`}>
                  <Search size={16} />
                </Link>
              ) : null}
              {channel.kind !== "dm" ? (
                <button
                  type="button"
                  onClick={() => openDetails("members")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-11"
                  aria-label={`${channel.member_count} members`}
                  title="Members"
                >
                  <span className="hidden items-center -space-x-1.5 sm:inline-flex">
                    {people.slice(0, 3).map((p) => (
                      <span key={p.id} className="relative inline-block rounded-sm ring-2 ring-card">
                        <UserAvatar title="" identity={p} size={20} />
                        <PersonPresenceBadge userId={p.id} size={8} className="absolute" style={{ right: -2, bottom: -2, ["--presence-cut" as string]: "var(--card)" }} />
                      </span>
                    ))}
                  </span>
                  {/* Below sm the avatars are hidden: the icon says what the number counts. */}
                  <Users size={16} aria-hidden="true" className={people.length ? "sm:hidden" : ""} />
                  <span className="nb-meta text-foreground">{channel.member_count}</span>
                </button>
              ) : null}
              {!isMember && channel.kind === "public" && !archived ? (
                <Button type="button" size="sm" onClick={() => void join()} className="ml-1 pointer-coarse:h-11">Join</Button>
              ) : null}
              {isMember || canPreview ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="nb-icon-button nb-touch-target" aria-label="More options">
                    <MoreHorizontal size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    {isMember ? <DropdownMenuItem onSelect={() => openDetails("about")}><PanelRight /> Conversation details <kbd className="nb-meta ml-auto">{detailsShortcut}</kbd></DropdownMenuItem> : null}
                    {canAddPeople(channel) ? <DropdownMenuItem onSelect={() => setDialog("people")}><UserPlus /> Add people</DropdownMenuItem> : null}
                    {/* Star and topic live here at every width; on phones search and notifications do too. */}
                    {isMember ? (
                      <>
                        <DropdownMenuItem onSelect={() => void setState({ starred: !channel.starred })}><Star /> {starLabel}</DropdownMenuItem>
                        {isChannel && channel.can_admin && !archived ? <DropdownMenuItem onSelect={() => openDetails("about")}><Pencil /> {channel.topic ? "Edit topic" : "Add a topic"}</DropdownMenuItem> : null}
                        <DropdownMenuItem className="sm:hidden" onSelect={() => router.push(`/messages/search?in=${channelId}`)}><Search /> Search in {displayName}</DropdownMenuItem>
                        <DropdownMenuSeparator className="sm:hidden" />
                        <DropdownMenuLabel className="sm:hidden">Notifications</DropdownMenuLabel>
                        <div className="sm:hidden">{notifyMenu}</div>
                      </>
                    ) : null}
                    {/* A DM without its tab bar: bookmarks and files start here. */}
                    {isMember && !showTabBar ? (
                      <>
                        {isApplication ? null : <DropdownMenuItem onSelect={() => setDialog("bookmark")}><Bookmark /> Add a link</DropdownMenuItem>}
                        {!isApplication && !(sharedTabs.data ?? []).some((t) => t.kind === "files") ? <DropdownMenuItem onSelect={() => void addTab("files", "Files")}><FileText /> Show files</DropdownMenuItem> : null}
                      </>
                    ) : null}
                    {isMember ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem onSelect={() => { void copyWithToast(`${window.location.origin}${conversationHref(channelId, surface === "page" ? panes : {}, surface === "page" ? window.location.search : "")}`, "Link copied"); }}>
                      <Link2 /> Copy link
                    </DropdownMenuItem>
                    {isMember && hasUnread ? <DropdownMenuItem onSelect={() => void markAllRead(true)}><CheckCheck /> Mark as read</DropdownMenuItem> : null}
                    {isMember && (channel.kind === "dm" || canCloseApplication || (!channel.is_default && !channel.application_id) || (channel.can_admin && isChannel && !channel.is_default)) ? <DropdownMenuSeparator /> : null}
                    {!isMember ? null : channel.kind === "dm" || canCloseApplication ? (
                      <DropdownMenuItem onSelect={() => void closeConversation()}><X /> Close conversation</DropdownMenuItem>
                    ) : !channel.is_default && !channel.application_id && !archived ? (
                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("leave")}><LogOut /> Leave {isChannel ? "channel" : "conversation"}</DropdownMenuItem>
                    ) : null}
                    {isMember ? blockItem : null}
                    {isMember && channel.can_admin && isChannel && !channel.is_default ? (
                      archived ? (
                        <DropdownMenuItem onSelect={unarchive}><ArchiveRestore /> Unarchive channel</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("archive")}>
                          <Archive /> Archive channel
                        </DropdownMenuItem>
                      )
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          )}
        </header>

        {channel.application_id && isMember ? <ApplicationStatusBar applicationId={channel.application_id} /> : null}

        {showTabBar ? (
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
            canCopyCanvas={Boolean(channel.project_id)}
          />
        ) : null}

        {/* The tab bar's panel (labelled by the selected tab); without a tab bar it's a plain column. */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          {...(showTabBar ? { id: "conversation-tabpanel", role: "tabpanel", "aria-labelledby": `conversation-tab-${activeTab.id}` } : {})}
        >
        {!isMember && !canPreview ? (
          <div className="grid flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-[15px]">You’re not in <span className="font-medium">{displayName}</span>.</p>
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
          <div className="relative flex min-h-0 flex-1 flex-col" {...(isMember && !archived && !channel.reply_closed ? drop.handlers : {})}>
            <DropOverlay show={drop.dragging} />
            <ConnectionBanner status={conversation.status} />
            {conversation.query.isLoading && !conversation.messages.length ? <TimelineSkeleton /> : (
              <Timeline
                key={`${channelId}:${timeline.epoch}`}
                messages={conversation.messages}
                lastReadSeq={effectiveLastReadSeq}
                meId={meId}
                hasOlder={Boolean(conversation.query.hasNextPage)}
                loadingOlder={conversation.query.isFetchingNextPage}
                olderError={conversation.query.isFetchNextPageError}
                loadOlder={() => void conversation.query.fetchNextPage()}
                intro={<Intro channel={channel} meId={meId} isMember={isMember} hasCanvas={Boolean(canvasQuery.data)} onDetails={() => openDetails("about")} onAddPeople={() => setDialog("people")} onCanvas={isChannel ? () => openCanvas() : undefined} />}
                highlightSeq={around}
                onSeen={isMember ? conversation.markSeen : () => undefined}
                onMarkRead={isMember ? () => void markAllRead() : undefined}
                typing={typing.names.length > 0}
                revealSeq={editingSeq}
                behindLatest={!around && (conversation.messages.findLast((m) => m.seq > 0)?.seq ?? 0) < channel.last_top_seq}
                onReloadLatest={() => {
                  // Leaving a jump: drop ?m= (the timeline then starts over at the newest page).
                  if (around && surface === "page" && pathname) {
                    const params = new URLSearchParams(window.location.search);
                    params.delete("m");
                    const query = params.toString();
                    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
                  } else conversation.reloadLatest();
                }}
                sentTick={sentTick}
              />
            )}
            {conversation.query.isError ? <ErrorNotice what="Messages" onRetry={() => void conversation.query.refetch()} className="mx-3 mb-2" /> : null}
            {!isMember ? (
              <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border bg-muted px-4 py-3 text-[13px]">
                <span className="text-muted-foreground">You’re previewing <strong className="font-semibold text-foreground">{displayName}</strong>. Join to post.</span>
                <Button type="button" size="sm" onClick={() => void join()} className="pointer-coarse:h-11">Join channel</Button>
              </div>
            ) : channel.reply_closed ? (
              <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
                {channel.blocked_by_me && dmPerson ? (
                  <>
                    <span>You blocked {dmPerson.name}. They can’t message you. You can still read this conversation.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => blockFlow.openUnblock(dmPerson)} className="pointer-coarse:h-11">Unblock</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={reportDm.open} className="pointer-coarse:h-11">Report</Button>
                  </>
                ) : <span>You can’t reply to this conversation.</span>}
              </div>
            ) : archived ? (
              <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
                <span>This channel is archived. You can read it, but not post.</span>
                {channel.can_admin ? <Button type="button" variant="outline" size="sm" onClick={() => void unarchive()} className="pointer-coarse:h-11">Unarchive</Button> : null}
              </div>
            ) : (
              <>
              {channel.kind === "dm" && channel.dm_user && !self ? <DmContextLine person={channel.dm_user} /> : null}
              <Composer
                channelId={channelId}
                placeholder={placeholder}
                people={people}
                allowBroadcast={!isDirect && !channel.application_id && channel.member_count <= CHAT_BROADCAST_MENTION_MAX_MEMBERS}
                canCreateTask={Boolean(channel.project_id) && !isApplication}
                onOpenCanvas={isChannel && surface === "page" ? () => openCanvas() : undefined}
                onTyping={typing.notify}
                typingNames={typing.names}
                onEditLast={editLast}
                onSent={onSent}
                autoFocus
              />
              </>
            )}
          </div>
        )}
        </div>
      </section>
      {blockFlow.dialog}
      {reportDm.dialog}
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
          channelName={channel.name}
        />
      ) : null}
      {dialog === "people" ? <AddPeopleDialog channelId={channelId} title={displayName} onClose={() => setDialog(null)} /> : null}
      {shareSeq !== null ? <ShareDialog channelId={channelId} seq={shareSeq} onClose={() => setShareSeq(null)} /> : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "replace" ? "Replace the note?" : confirm === "canvas" ? "Delete this note?" : confirm === "archive" ? `Archive ${displayName}?` : `Leave ${isChannel ? displayName : "this conversation"}?`}
        description={confirm === "replace"
          ? "The current note is replaced for everyone in the channel. Copy it first if you want to keep it."
          : confirm === "canvas"
          ? "It’s removed for everyone in the channel. Copy it first if you want to keep it."
          : confirm === "archive"
            ? "Nobody can post in an archived channel. History stays readable, and admins can unarchive it."
            : channel.kind === "public" ? "You can rejoin a public channel at any time." : "You’ll need to be added again to come back."}
        confirmLabel={confirm === "replace" ? "Replace" : confirm === "canvas" ? "Delete note" : confirm === "archive" ? "Archive" : "Leave"}
        variant="destructive"
        onConfirm={async () => {
          if (confirm === "replace") {
            if (pendingSeed) openCanvas(pendingSeed);
            setPendingSeed(null);
          } else if (confirm === "canvas") {
            await removeCanvas();
          } else await leaveOrArchive();
        }}
      />
    </ConversationContext.Provider>
  );
}

/**
 * Above the composer in a DM (round 3 #261): "Ana paused notifications · 11:40 PM their time", so
 * you know before you send. Their time shows only when their clock differs from yours.
 */
function DmContextLine({ person }: { person: ChatPerson }) {
  const presence = usePersonPresence(person.id);
  const context = usePersonContext(person.id);
  const [now] = useState(() => new Date());
  const zone = context.data?.timeZone;
  const time = (timeZone?: string) => now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  const theirs = zone ? time(zone) : null;
  const first = personName(person).split(" ")[0];
  const parts = [
    presence.status?.pausesNotifications ? `${first} paused notifications` : null,
    theirs && theirs !== time() ? `${theirs} their time` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="nb-meta border-t border-border px-4 pt-1.5">{parts.join(" · ")}</p>;
}

/** Next to a DM's name: their status (emoji + text), else when they were active. */
function DmHeaderStatus({ userId }: { userId: string }) {
  const presence = usePersonPresence(userId);
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate text-[13px] text-muted-foreground">
      {presence.status ? <StatusInline emoji={presence.status.emoji} text={presence.statusText} className="truncate" /> : <span className="truncate">{presence.availabilityText}</span>}
    </span>
  );
}
