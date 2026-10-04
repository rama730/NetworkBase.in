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
import { encodeMentions, parseMentions, tokensToPlainText } from "@/lib/messaging/tokens";
import type { ChatAttachmentView, ChatMessageView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { copyWithToast } from "@/lib/clipboard";

const QUICK = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];
const HOVER_QUICK_REACTIONS = ["👍", "❤️"];
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

function nineAm(daysAhead: (now: Date) => number) {
  const at = new Date();
  at.setDate(at.getDate() + daysAhead(at));
  at.setHours(9, 0, 0, 0);
  return at.toISOString();
}
const inMinutes = (minutes: number) => () => new Date(Date.now() + minutes * 60_000).toISOString();

/** "Remind me about this": the times offered in both menus, computed when picked. */
const REMINDER_TIMES = [
  { label: "In 20 minutes", at: inMinutes(20) },
  { label: "In 1 hour", at: inMinutes(60) },
  { label: "In 3 hours", at: inMinutes(180) },
  { label: "Tomorrow at 9:00", at: () => nineAm(() => 1) },
  { label: "Next Monday at 9:00", at: () => nineAm((now) => (8 - now.getDay()) % 7 || 7) },
];

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

export const MessageRow = memo(function MessageRow({ message, grouped, highlighted = false, others }: { message: ChatMessageView; grouped: boolean; highlighted?: boolean; others?: ChatMessageView[] }) {
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
  const isHoveredRef = useRef(false);
  const actionsRef = useRef<Action[]>([]);

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

  const toggleReaction = async (emoji: string) => {
    if (pending) return;
    const on = !message.reactions.some((r) => r.emoji === emoji && r.me);
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
    void copyWithToast(plain(), "Text copied");
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
    if (ctx.setSaved) list.push({ id: "save", label: saved ? "Remove from saved" : "Save for later", icon: saved ? BookmarkCheck : Bookmark, run: () => ctx.setSaved?.(message.seq, !saved), shortcut: "S", group: 1 });
    if (ctx.share && message.body) list.push({ id: "share", label: "Share message", icon: Forward, run: () => ctx.share?.(message.seq), group: 1 });
    if (message.body) list.push({ id: "copy-text", label: "Copy text", icon: Copy, run: copyText, group: 2 });
    list.push({ id: "copy-link", label: "Copy link", icon: Link2, run: copyLink, shortcut: "⌘L", group: 2 });
    if (!ctx.inThread) list.push({ id: "unread", label: "Mark unread", icon: MailOpen, run: () => void unread(), shortcut: "U", group: 2 });
    if (ctx.projectId && message.kind === "user" && !message.card && message.body) list.push({ id: "task", label: "Create task", icon: SquareCheck, run: () => void createTask(), group: 2 });
    list.push({ id: "pin", label: message.pinned ? "Unpin" : "Pin to conversation", icon: Pin, run: () => void togglePin(), group: 2 });
    if (own && !message.card) list.push({ id: "edit", label: "Edit message", icon: Pencil, run: startEdit, shortcut: "E", group: 3 });
    if (canDelete) list.push({ id: "delete", label: "Delete message", icon: Trash2, run: () => (own ? removeWithUndo() : setConfirmDelete(true)), shortcut: "⌫", destructive: true, group: 3 });
    if (!own) list.push({ id: "report", label: "Report message", icon: Flag, run: () => setReportOpen(true), group: 3 });
  }
  useEffect(() => { actionsRef.current = list; });
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  const find = (id: string) => list.find((a) => a.id === id);

  useEffect(() => {
    if (!actions) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isHoveredRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const byKey = (id: string) => actionsRef.current.find((a) => a.id === id);
      const key = e.key.toLowerCase();
      const action = (e.metaKey || e.ctrlKey) ? (key === "l" ? byKey("copy-link") : undefined)
        : key === "e" ? byKey("edit") : key === "t" ? byKey("reply") : key === "s" ? byKey("save") : key === "u" ? byKey("unread")
        : key === "backspace" || key === "delete" ? byKey("delete") : undefined;
      if (key === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void toggleReaction("👍");
      } else if (action) {
        e.preventDefault();
        action.run();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (message.kind === "system") return <SystemRow message={message} others={others} />;

  const isToolbarOpen = moreOpen || closing || Boolean(pickerAnchor);
  const handleMoreOpenChange = (open: boolean) => {
    setMoreOpen(open);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setClosing(!open);
    if (!open) closeTimerRef.current = setTimeout(() => setClosing(false), 250);
  };
  const groups = [1, 2, 3].map((group) => list.filter((a) => a.group === group)).filter((g) => g.length);
  const remindMenu = REMINDER_TIMES;
  const remind = (at: () => string) => ctx.setSaved?.(message.seq, true, at());

  return (
    <div
      data-seq={message.seq}
      data-testid={`chat-message-${message.seq}`}
      data-mentioned={mentioned ? "true" : undefined}
      className={`group/msg relative px-4 ${grouped ? "pt-0.5" : "pt-3"} pb-0.5 hover:bg-muted/50 focus-within:bg-muted/50 ${highlighted ? "bg-[var(--status-warning-soft)]" : ""} ${mentioned ? "border-l-2 border-[var(--status-warning)] bg-[var(--status-warning-soft)]/40" : ""} ${pending ? "opacity-60" : ""}`}
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => { isHoveredRef.current = false; }}
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
            <span className="hidden pt-1 font-mono text-[11px] text-muted-foreground group-hover/msg:block">{formatChatTime(message.created_at, "clock")}</span>
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
              <span className="font-mono text-[12px] text-muted-foreground">{formatChatTime(message.created_at, "clock")}</span>
              {message.pinned ? <Pin size={12} aria-label="Pinned" className="text-muted-foreground" /> : null}
              {saved ? <Bookmark size={12} aria-label="Saved for later" className="text-[var(--chat-accent)]" fill="currentColor" /> : null}
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
              </div>
            </TooltipProvider>
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
          {HOVER_QUICK_REACTIONS.map((emoji) => (
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
                        {remindMenu.map((option) => <DropdownMenuItem key={option.label} onSelect={() => remind(option.at)}>{option.label}</DropdownMenuItem>)}
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
              {remindMenu.map((option) => <button key={option.label} type="button" onClick={() => { setSheet(null); remind(option.at); }}>{option.label}</button>)}
            </div>
          ) : (
            <>
              <div className="flex justify-around px-2 py-3">
                {QUICK.map((emoji) => (
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
        title={`Delete ${authorName}'s message?`}
        description={message.reply_count ? "It's removed for everyone. Replies in its thread stay." : "It's removed for everyone. This can't be undone."}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
      <ReportMessageDialog
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, details) => reportMessage({ channelId: ctx.channelId, seq: message.seq, reason: details ? `${reason}: ${details}` : reason })}
      />
    </div>
  );
});
