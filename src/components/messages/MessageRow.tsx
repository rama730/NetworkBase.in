"use client";

import { memo, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock, Archive, Bookmark, BookmarkCheck, Copy, Flag, Forward, Hash, Link2, LogIn, LogOut, MailOpen, MessageSquareText,
  MoreHorizontal, Pencil, Pin, SmilePlus, SquareCheck, Trash2, UserMinus, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { createTaskFromMessage, deleteMessage, editMessage, listReactors, markUnread, pinMessage, react, reportMessage } from "@/app/actions/chat/messages";
import { useConversationContext } from "@/components/messages/conversation-context";
import { MessageBody, firstLink } from "@/components/messages/MessageBody";
import { MessageCard } from "@/components/messages/cards/MessageCard";
import { MessageAttachmentsV2, type ChatAttachmentV2 } from "@/components/messages/parts/message-attachments";
import { LinkPreviewCard } from "@/components/messages/parts/LinkPreviewCard";
import { ReactionQuickBar } from "@/components/messages/parts/ReactionQuickBar";
import { ReportMessageDialog } from "@/components/messages/parts/ReportMessageDialog";
import { useUpdatePages } from "@/components/messages/useConversation";
import { noteReaction, useQuickReactions } from "@/components/messages/useQuickReactions";
import { discardSend, failedSend, retrySend } from "@/components/messages/failed-sends";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PersonHoverCard } from "@/components/presence/PersonHoverCard";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useLinkPreview } from "@/hooks/useLinkPreview";
import { formatChatTime, personName } from "@/lib/messaging/channel-view";
import { messageHref } from "@/lib/messaging/routes";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { applyReaction, patchPages, upsertMessage } from "@/lib/messaging/timeline";
import { REMINDER_TIMES } from "@/lib/messaging/reminders";
import { encodeMentions, parseMentions, tokensToPlainText } from "@/lib/messaging/tokens";
import type { ChatAttachmentView, ChatMessageView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { copyWithToast } from "@/lib/clipboard";

/** The hover bar shows the first few of the shared quick set (recently used first). */
const HOVER_QUICK_COUNT = 3;
const LONG_PRESS_MS = 500;
const UNDO_DELETE_MS = 5_000;

// ponytail: the timeline shows the uploaded image itself, already capped at 1920px
// and 5 MB on the device (S3-07). ceiling: ~6-10 MB for a channel of 20 photos.
// upgrade: 400px thumbnails when measured timeline bandwidth or plan image transforms justify it.
function toViewerAttachment(attachment: ChatAttachmentView): ChatAttachmentV2 {
  const url = `/api/v1/chat/attachments/${attachment.asset_id}`;
  const type = attachment.mime.startsWith("image/") ? "image" : attachment.mime.startsWith("video/") ? "video" : "file";
  return { id: attachment.asset_id, type, url, filename: attachment.name || "file", sizeBytes: attachment.size, mimeType: attachment.mime, thumbnailUrl: null, width: attachment.width, height: attachment.height };
}

const EditBox = dynamic(() => import("@/components/messages/MessageEditBox").then((m) => m.EditBox), { ssr: false });

function LinkPreview({ body }: { body: string }) {
  const url = firstLink(body);
  const preview = useLinkPreview(url);
  if (!url || !preview.data) return null;
  return <LinkPreviewCard preview={preview.data} isOwn={false} />;
}

type Action = { id: string; label: string; icon: LucideIcon; run: () => void; shortcut?: string; destructive?: boolean; group: 1 | 2 | 3 };

// Deletes of your own messages wait out an Undo window; pending ones live here.
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();

/** Who reacted, loaded when the tooltip opens. */
function ReactionChip({ emoji, count, me, seq, onToggle }: { emoji: string; count: number; me: boolean; seq: number; onToggle: () => void }) {
  const ctx = useConversationContext();
  const [open, setOpen] = useState(false);
  const reactors = useQuery({
    queryKey: queryKeys.chat.reactors(ctx.channelId, seq),
    enabled: open,
    queryFn: async () => {
      const result = await listReactors({ channelId: ctx.channelId, seq });
      return result.success ? result.reactors : {};
    },
    staleTime: 15_000,
  });
  const names = reactors.data?.[emoji] ?? [];
  const who = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} others` : names.join(" and ").replace(/ and (?=.* and )/g, ", ");
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          disabled={ctx.isMember === false}
          aria-pressed={me}
          aria-label={`${emoji} ${count}${me ? ", you reacted" : ""}`}
          className={`inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 text-[13px] pointer-coarse:h-9 ${me ? "border-primary bg-accent" : "border-border bg-card"}`}
        >
          <span>{emoji}</span><span className="font-mono text-[11px]">{count}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-center">
        {who ? `${who} reacted with ${emoji}` : "Loading…"}
      </TooltipContent>
    </Tooltip>
  );
}

const SYSTEM_ICONS: Array<[RegExp, LucideIcon]> = [
  [/^joined/, LogIn], [/^left/, LogOut], [/^removed/, UserMinus], [/^(renamed|named|removed the group)/, Pencil],
  [/^set the topic/, MessageSquareText], [/^(unarchived|archived)/, Archive], [/^created/, Hash],
];

function SystemRow({ message, others }: { message: ChatMessageView; others?: ChatMessageView[] }) {
  const ctx = useConversationContext();
  const Icon = SYSTEM_ICONS.find(([pattern]) => pattern.test(message.body))?.[1] ?? Hash;
  const people = [message, ...(others ?? [])].map((m) => personName(m.author));
  const who = people.length === 1 ? people[0] : people.length === 2 ? `${people[0]} and ${people[1]}` : `${people[0]} and ${people.length - 1} others`;
  const body = message.body.startsWith("removed <@") ? `removed ${ctx.nameOf(message.body.slice(10, -1)) ?? "someone"}` : message.body;
  return (
    <div className="my-1 flex items-center gap-2 px-4 py-1 pl-[52px] text-[13px] text-muted-foreground" data-seq={message.seq} title={people.length > 2 ? people.join(", ") : undefined}>
      <span className="inline-flex size-5 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true"><Icon size={11} /></span>
      <span className="min-w-0 flex-1 truncate"><span className="font-medium text-foreground">{who}</span> {body}</span>
      <span className="font-mono text-[12px]">{formatChatTime((others?.at(-1) ?? message).created_at, "clock")}</span>
    </div>
  );
}

export const MessageRow = memo(function MessageRow({ message, grouped, highlighted = false, others, tabStop = false }: {
  message: ChatMessageView; grouped: boolean; highlighted?: boolean; others?: ChatMessageView[];
  /** The one row the Tab key lands on in the timeline (roving tabindex); ↑/↓ move between rows. */
  tabStop?: boolean;
}) {
  const ctx = useConversationContext();
  const queryClient = useQueryClient();
  const update = useUpdatePages(ctx.channelId);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [sheet, setSheet] = useState<"actions" | "remind" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Keeps the toolbar shown through the menu's exit animation, so the menu
  // never animates out from (0,0) after its anchor disappears.
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quick = useQuickReactions();

  const own = message.author_id === ctx.meId;
  const pending = message.seq < 0;
  const deleted = Boolean(message.deleted_at);
  const member = ctx.isMember !== false;
  const actions = !pending && !deleted && member;
  const editing = ctx.editingSeq === message.seq;
  const canDelete = own || ctx.canAdmin;
  const saved = ctx.savedSeqs?.has(message.seq) ?? false;
  const authorName = personName(message.author);
  const mentioned = !own && message.kind === "user" && (() => {
    const { userIds, broadcast } = parseMentions(message.body);
    return Boolean(broadcast) || (ctx.meId ? userIds.includes(ctx.meId) : false);
  })();
  const plain = () => tokensToPlainText(message.body, ctx.nameOf);
  const hasContent = Boolean(message.body || message.attachments.length);
  const failed = message.failed ? failedSend(message.client_message_id) : null;

  const toggleReaction = async (emoji: string) => {
    if (pending) return;
    const on = !message.reactions.some((r) => r.emoji === emoji && r.me);
    if (on) noteReaction(emoji);
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, reactions: applyReaction(m.reactions, emoji, on, true) })));
    const result = await react({ channelId: ctx.channelId, seq: message.seq, emoji, on });
    if (!result.success) {
      update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, reactions: applyReaction(m.reactions, emoji, !on, true) })));
      toast.error(chatErrorMessage(result.error));
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.reactors(ctx.channelId, message.seq) });
  };
  const copyLink = () => {
    void copyWithToast(`${window.location.origin}${messageHref(ctx.channelId, message.seq, message.thread_root_seq)}`, "Link copied");
  };
  const copyText = () => {
    // Attachment-only messages copy their file names.
    void copyWithToast(plain() || message.attachments.map((a) => a.name || "file").join(", "), "Text copied");
  };
  const startEdit = () => ctx.setEditingSeq(message.seq);
  const saveEdit = async (markdown: string) => {
    const body = encodeMentions(markdown.trim(), ctx.people.map((p) => ({ id: p.id, name: p.full_name || p.username || "" })));
    ctx.setEditingSeq(null);
    // Emptied a text-only message: that's a delete, so ask (with the usual Undo) instead of silently ignoring it.
    if (!body && !message.attachments.length) {
      toast("Delete this message?", { action: { label: "Delete", onClick: removeWithUndo } });
      return;
    }
    if (!body || body === message.body) return;
    const previous = { body: message.body, edited_at: message.edited_at };
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, body, edited_at: new Date().toISOString() })));
    const result = await editMessage({ channelId: ctx.channelId, seq: message.seq, body });
    if (!result.success) {
      update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, ...previous })));
      toast.error(chatErrorMessage(result.error));
    }
  };
  const remove = async () => {
    setConfirmDelete(false);
    const result = await deleteMessage({ channelId: ctx.channelId, seq: message.seq });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, body: "", attachments: [], deleted_at: new Date().toISOString() })));
  };
  // Your own message disappears at once with an Undo; it's deleted for real after 5 s.
  const removeWithUndo = () => {
    const key = `${ctx.channelId}:${message.seq}`;
    const before = message;
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, deleted_at: new Date().toISOString() })));
    pendingDeletes.set(key, setTimeout(() => {
      pendingDeletes.delete(key);
      void deleteMessage({ channelId: ctx.channelId, seq: before.seq }).then((result) => {
        if (result.success) return;
        update((pages) => patchPages(pages, before.seq, () => before));
        toast.error(chatErrorMessage(result.error));
      });
    }, UNDO_DELETE_MS));
    toast("Message deleted", {
      duration: UNDO_DELETE_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(pendingDeletes.get(key));
          pendingDeletes.delete(key);
          update((pages) => patchPages(pages, before.seq, () => before));
        },
      },
    });
  };
  const togglePin = async () => {
    const nextPinned = !message.pinned;
    const result = await pinMessage({ channelId: ctx.channelId, seq: message.seq, on: nextPinned });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, pinned: nextPinned })));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.pins(ctx.channelId) });
    if (nextPinned && ctx.openPinsTab) toast("Pinned to the conversation", { action: { label: "View pins", onClick: () => ctx.openPinsTab?.() } });
    else toast(nextPinned ? "Pinned to the conversation" : "Unpinned");
  };
  const unread = async () => {
    const result = await markUnread({ channelId: ctx.channelId, seq: message.seq });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    // Only the sidebar data refreshes; rows don't subscribe to the shell (REND-02).
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.bootstrap(ctx.meId) });
    toast("Marked unread from here");
  };
  const createTask = async () => {
    const title = plain().replace(/\s+/g, " ").trim().slice(0, 200) || "Task from chat";
    const result = await createTaskFromMessage({ channelId: ctx.channelId, title, threadRootSeq: message.thread_root_seq ?? (ctx.inThread ? null : message.seq) });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    if (!result.message.thread_root_seq) update((pages) => upsertMessage(pages, result.message));
    toast.success("Task created");
  };

  // One list for the hover menu, the mobile sheet and the shortcuts, so they never drift.
  const list: Action[] = [];
  if (actions) {
    if (!ctx.inThread) list.push({ id: "reply", label: "Reply in thread", icon: MessageSquareText, run: () => ctx.openThread(message.seq), shortcut: "T", group: 1 });
    if (ctx.setSaved) list.push({ id: "save", label: saved ? "Remove from Saved" : "Save", icon: saved ? BookmarkCheck : Bookmark, run: () => ctx.setSaved?.(message.seq, !saved), shortcut: "S", group: 1 });
    if (ctx.share && hasContent) list.push({ id: "share", label: "Share message", icon: Forward, run: () => ctx.share?.(message.seq), group: 1 });
    if (hasContent) list.push({ id: "copy-text", label: "Copy text", icon: Copy, run: copyText, group: 2 });
    list.push({ id: "copy-link", label: "Copy link", icon: Link2, run: copyLink, group: 2 });
    if (!ctx.inThread) list.push({ id: "unread", label: "Mark unread", icon: MailOpen, run: () => void unread(), shortcut: "U", group: 2 });
    if (ctx.projectId && message.kind === "user" && !message.card && message.body) list.push({ id: "task", label: "Create task", icon: SquareCheck, run: () => void createTask(), group: 2 });
    list.push({ id: "pin", label: message.pinned ? "Unpin" : "Pin to conversation", icon: Pin, run: () => void togglePin(), group: 2 });
    if (own && !message.card) list.push({ id: "edit", label: "Edit message", icon: Pencil, run: startEdit, shortcut: "E", group: 3 });
    if (canDelete) list.push({ id: "delete", label: "Delete message", icon: Trash2, run: () => (own && !message.reply_count ? removeWithUndo() : setConfirmDelete(true)), shortcut: "⌫", destructive: true, group: 3 });
    if (!own) list.push({ id: "report", label: "Report message", icon: Flag, run: () => setReportOpen(true), group: 3 });
  }
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  const find = (id: string) => list.find((a) => a.id === id);

  // Shortcuts act on the focused row (Tab or ↑/↓ in the timeline), never on whatever the mouse is over.
  const onRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!actions || e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const id = key === "e" ? "edit" : key === "t" ? "reply" : key === "s" ? "save" : key === "u" ? "unread"
      : key === "backspace" || key === "delete" ? "delete" : null;
    const action = id ? find(id) : undefined;
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action.run();
  };

  if (message.kind === "system") return <SystemRow message={message} others={others} />;

  const isToolbarOpen = moreOpen || closing || Boolean(pickerAnchor);
  const handleMoreOpenChange = (open: boolean) => {
    setMoreOpen(open);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setClosing(!open);
    if (!open) closeTimerRef.current = setTimeout(() => setClosing(false), 250);
  };
  const groups = [1, 2, 3].map((group) => list.filter((a) => a.group === group)).filter((g) => g.length);
  const remind = (at: () => string) => ctx.setSaved?.(message.seq, true, at());
  const fullTime = new Date(message.created_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div
      data-seq={message.seq}
      data-testid={`chat-message-${message.seq}`}
      data-mentioned={mentioned ? "true" : undefined}
      data-message-row=""
      tabIndex={tabStop ? 0 : -1}
      aria-label={`${authorName}, ${new Date(message.created_at).toLocaleString()}`}
      onKeyDown={onRowKeyDown}
      className={`group/msg relative px-4 ${grouped ? "pt-0.5" : "pt-3"} pb-0.5 outline-none hover:bg-muted/50 focus-within:bg-muted/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${highlighted ? "bg-[var(--status-warning-soft)]" : ""} ${mentioned ? "border-l-2 border-[var(--status-warning)] bg-[var(--status-warning-soft)]/40" : ""} ${pending && !message.failed ? "opacity-60" : ""}`}
      onTouchStart={() => {
        if (!actions) return;
        pressTimer.current = setTimeout(() => setSheet("actions"), LONG_PRESS_MS);
      }}
      onTouchEnd={() => pressTimer.current && clearTimeout(pressTimer.current)}
      onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
    >
      <div className="flex gap-2.5">
        <div className="w-[34px] flex-none">
          {grouped ? (
            <>
              <button type="button" tabIndex={-1} onClick={pending ? undefined : copyLink} title={`${fullTime}${pending ? "" : " · click to copy link"}`} className="hidden pt-1 font-mono text-[11px] text-muted-foreground hover:underline group-hover/msg:block">{formatChatTime(message.created_at, "clock")}</button>
              {message.pinned || saved ? (
                <span className="flex gap-0.5 pt-1.5 group-hover/msg:hidden">
                  {message.pinned ? <Pin size={11} aria-label="Pinned" className="text-muted-foreground" /> : null}
                  {saved ? <Bookmark size={11} aria-label="Saved" className="text-[var(--chat-accent)]" fill="currentColor" /> : null}
                </span>
              ) : null}
            </>
          ) : (
            <PersonHoverCard person={message.author}>
              <UserAvatar identity={message.author} size={34} roundedClassName="rounded-[5px]" />
            </PersonHoverCard>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {grouped ? null : (
            <div className="flex items-baseline gap-2">
              <PersonHoverCard person={message.author}>
                <span className="text-[13px] font-medium hover:underline">{authorName}</span>
              </PersonHoverCard>
              <button type="button" tabIndex={-1} onClick={pending ? undefined : copyLink} title={`${fullTime}${pending ? "" : " · click to copy link"}`} className="font-mono text-[12px] text-muted-foreground hover:underline">{formatChatTime(message.created_at, "clock")}</button>
              {message.pinned ? <Pin size={12} aria-label="Pinned" className="text-muted-foreground" /> : null}
              {saved ? <Bookmark size={12} aria-label="Saved" className="text-[var(--chat-accent)]" fill="currentColor" /> : null}
            </div>
          )}
          {deleted ? (
            <p className="text-[15px] italic text-muted-foreground">This message was deleted.</p>
          ) : editing ? (
            <EditBox
              body={message.body}
              labelOf={(raw) => (raw.startsWith("<#") ? `#${ctx.channelNameOf(raw.slice(2, -1)) ?? "channel"}` : `@${ctx.nameOf(raw.slice(2, -1)) ?? "someone"}`)}
              onSave={(markdown) => void saveEdit(markdown)}
              onCancel={() => ctx.setEditingSeq(null)}
            />
          ) : (
            <>
              {message.body ? (
                <MessageBody
                  body={message.body}
                  nameOf={ctx.nameOf}
                  channelNameOf={ctx.channelNameOf}
                  meId={ctx.meId}
                  suffix={message.edited_at ? <span className="ml-1 text-[12px] text-muted-foreground" title={`Edited ${new Date(message.edited_at).toLocaleString()}`}>(edited)</span> : undefined}
                />
              ) : message.edited_at ? <span className="text-[12px] text-muted-foreground">(edited)</span> : null}
              {message.attachments.length ? (
                <div className="mt-1 max-w-[520px]"><MessageAttachmentsV2 attachments={message.attachments.map(toViewerAttachment)} /></div>
              ) : null}
              {message.card ? <MessageCard card={message.card} /> : null}
              {message.body ? <LinkPreview body={message.body} /> : null}
            </>
          )}
          {message.reactions.length ? (
            <TooltipProvider delayDuration={250}>
              <div className="mt-1 flex flex-wrap gap-1">
                {message.reactions.map((r) => (
                  <ReactionChip key={r.emoji} emoji={r.emoji} count={r.count} me={r.me} seq={message.seq} onToggle={() => void toggleReaction(r.emoji)} />
                ))}
                {actions ? (
                  <button type="button" data-reaction-trigger onClick={(e) => setPickerAnchor(pickerAnchor ? null : e.currentTarget)} aria-label="Add reaction" title="Add reaction" className="inline-flex h-6 items-center rounded-[5px] border border-border bg-card px-1.5 text-muted-foreground hover:text-foreground pointer-coarse:h-9">
                    <SmilePlus size={13} />
                  </button>
                ) : null}
              </div>
            </TooltipProvider>
          ) : null}
          {message.failed ? (
            <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--status-danger)]">
              <span>Not sent{failed?.assetIds.length ? ` · ${failed.assetIds.length} file${failed.assetIds.length === 1 ? "" : "s"}` : ""}</span>
              {failed ? <button type="button" onClick={() => message.client_message_id && void retrySend(queryClient, message.client_message_id)} className="font-medium underline">Retry</button> : null}
              <button type="button" onClick={() => message.client_message_id && discardSend(queryClient, message.client_message_id, ctx.channelId, message.thread_root_seq)} className="font-medium underline">Delete</button>
            </p>
          ) : null}
          {!ctx.inThread && message.reply_count > 0 ? (
            <button type="button" onClick={() => ctx.openThread(message.seq)} className="mt-1 inline-flex min-h-7 items-center gap-2 rounded-[5px] px-1 text-[13px] font-medium text-primary hover:bg-card hover:underline">
              {message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}
              {message.last_reply_at ? <span className="font-normal text-muted-foreground">last reply {formatChatTime(message.last_reply_at, "ago")}</span> : null}
            </button>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div
          className={`absolute -top-3 right-4 z-20 ${isToolbarOpen ? "flex" : "hidden group-hover/msg:flex group-focus-within/msg:flex"} items-center rounded-[5px] border border-border bg-card/95 shadow-sm backdrop-blur-sm pointer-coarse:!hidden`}
          role="toolbar"
          aria-label="Message actions"
        >
          {quick.slice(0, HOVER_QUICK_COUNT).map((emoji) => (
            <button key={emoji} type="button" className="grid size-8 place-items-center rounded-[5px] hover:bg-muted" aria-label={`React ${emoji}`} onClick={() => void toggleReaction(emoji)}>{emoji}</button>
          ))}
          <button type="button" data-reaction-trigger className="grid size-8 place-items-center rounded-[5px] hover:bg-muted" aria-label="Add reaction" title="Add reaction" onClick={(e) => setPickerAnchor(pickerAnchor ? null : e.currentTarget)}><SmilePlus size={16} /></button>
          {(["reply", "save", "share"] as const).map((id) => {
            const action = find(id);
            if (!action) return null;
            const Icon = action.icon;
            return (
              <button key={id} type="button" className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={action.label} title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label} onClick={action.run}>
                <Icon size={16} />
              </button>
            );
          })}
          <DropdownMenu open={moreOpen} onOpenChange={handleMoreOpenChange} modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`grid size-8 place-items-center rounded-[5px] transition-colors ${moreOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} aria-label="More actions">
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-[210px]">
              {groups.map((group, index) => (
                <div key={index}>
                  {index ? <DropdownMenuSeparator /> : null}
                  {group.map((action) => {
                    const Icon = action.icon;
                    return (
                      <DropdownMenuItem key={action.id} onSelect={action.run} className={`gap-2 ${action.destructive ? "text-destructive focus:text-destructive" : ""}`}>
                        <Icon size={14} className={action.destructive ? "" : "text-muted-foreground"} />
                        <span className="flex-1">{action.label}</span>
                        {action.shortcut ? <span className="font-mono text-[11px] text-muted-foreground">{action.shortcut}</span> : null}
                      </DropdownMenuItem>
                    );
                  })}
                  {index === 0 && ctx.setSaved ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2"><AlarmClock size={14} className="text-muted-foreground" /> Remind me about this</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-48">
                        {REMINDER_TIMES.map((option) => <DropdownMenuItem key={option.label} onSelect={() => remind(option.at)}>{option.label}</DropdownMenuItem>)}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      {actions ? (
        <button type="button" className="absolute right-2 top-2 hidden size-11 place-items-center rounded-[5px] text-muted-foreground pointer-coarse:grid" aria-label="Message actions" onClick={() => setSheet("actions")}>
          <MoreHorizontal size={18} />
        </button>
      ) : null}

      {pickerAnchor ? (
        <ReactionQuickBar
          anchor={pickerAnchor}
          align="end"
          selectedReactions={message.reactions.filter((r) => r.me).map((r) => r.emoji)}
          onReact={(emoji) => { setPickerAnchor(null); void toggleReaction(emoji); }}
          onClose={() => setPickerAnchor(null)}
        />
      ) : null}

      <Dialog open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <DialogContent presentation="bottom-sheet" showCloseButton={false}>
          <DialogTitle className="sr-only">{sheet === "remind" ? "Remind me" : "Message actions"}</DialogTitle>
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          {sheet === "remind" ? (
            <div className="px-2 py-3 [&>button]:flex [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:rounded-[5px] [&>button]:px-3 [&>button]:text-[15px]">
              {REMINDER_TIMES.map((option) => <button key={option.label} type="button" onClick={() => { setSheet(null); remind(option.at); }}>{option.label}</button>)}
            </div>
          ) : (
            <>
              <div className="flex justify-around px-2 py-3">
                {quick.map((emoji) => (
                  <button key={emoji} type="button" className="grid size-11 place-items-center rounded-full text-xl hover:bg-muted" aria-label={`React ${emoji}`} onClick={() => { setSheet(null); void toggleReaction(emoji); }}>{emoji}</button>
                ))}
              </div>
              <div className="px-2 pb-3 [&>button]:flex [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-[5px] [&>button]:px-3 [&>button]:text-[15px]">
                {list.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button key={action.id} type="button" className={action.destructive ? "text-destructive" : undefined} onClick={() => { setSheet(null); action.run(); }}>
                      <Icon size={18} /> {action.label}
                    </button>
                  );
                })}
                {ctx.setSaved ? <button type="button" onClick={() => setSheet("remind")}><AlarmClock size={18} /> Remind me about this</button> : null}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={own ? "Delete your message?" : `Delete ${authorName}'s message?`}
        description={own ? "Replies in its thread stay. You can undo for a few seconds." : message.reply_count ? "It's removed for everyone. Replies in its thread stay." : "It's removed for everyone. This can't be undone."}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (own) {
            setConfirmDelete(false);
            removeWithUndo();
          } else void remove();
        }}
      />
      <ReportMessageDialog
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, details) => reportMessage({ channelId: ctx.channelId, seq: message.seq, reason: details ? `${reason}: ${details}` : reason })}
      />
    </div>
  );
});
