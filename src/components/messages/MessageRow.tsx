"use client";

import { joinPeople } from "@/lib/messaging/mix-format";
import { foldLabel, systemLine } from "@/lib/messaging/system-line";
import { PixelBeat } from "@/components/messages/mix/primitives";
import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock, Archive, Ban, BellOff, Bookmark, BookmarkCheck, Bug, CheckCircle2, Copy, Flag, Forward, Hash, Link2, Lock, LogIn, LogOut, MailOpen, MessageSquareText, Eye, EyeOff,
  ListChecks, MoreHorizontal, Pencil, Pin, RotateCcw, Send, SmilePlus, SquareCheck, Trash2, Undo2, UserMinus, XCircle, type LucideIcon,
} from "lucide-react";
import { toast, feedbackError, deferredFeedback } from "@/lib/feedback";

import { createTaskFromMessage, deleteMessage, reportBugFromMessage, editMessage, hideLinkPreview, listReactors, markUnread, pinMessage, react } from "@/app/actions/chat/messages";
import { useConversationContext } from "@/components/messages/conversation-context";
import { MessageBody, firstLink } from "@/components/messages/MessageBody";
import { MessageCard } from "@/components/messages/cards/MessageCard";
import { MessageAttachmentsV2, type ChatAttachmentV2 } from "@/components/messages/parts/message-attachments";
import { MessageLinkPreview } from "@/components/messages/parts/MessageLinkPreview";
import { ReactionQuickBar } from "@/components/messages/parts/ReactionQuickBar";
import { ReportDialog, useOpenReportCase } from "@/components/reports/ReportDialog";
import { moderatedText, useModeratedItems } from "@/components/reports/ModeratedPlaceholder";
import { useUpdatePages } from "@/components/messages/useConversation";
import { noteReaction, useQuickReactions } from "@/components/messages/useQuickReactions";
import { discardSend, editFailedSend, failedSend, retrySend } from "@/components/messages/failed-sends";
import { keyLabel } from "@/components/messages/keys";
import { TimePickerDialog } from "@/components/messages/parts/TimePickerDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PersonHoverCard } from "@/components/presence/PersonHoverCard";
import { usePersonPresence } from "@/components/presence/usePresence";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatChatTime, personName } from "@/lib/messaging/channel-view";
import { applicationLineKind, type ApplicationLineKind } from "@/lib/messaging/application-status";
import { messageHref } from "@/lib/messaging/routes";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { applyReaction, patchPages, upsertMessage } from "@/lib/messaging/timeline";
import { laterTimes } from "@/lib/messaging/reminders";
import { encodeMentions, parseMentions, tokensToPlainText } from "@/lib/messaging/tokens";
import { pollOptions, pollParts, pollStats } from "@/lib/messaging/poll";
import { bugFromMessage } from "@/lib/workflows/bugs";
import type { ChatAttachmentView, ChatMessageView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { copyWithToast } from "@/lib/clipboard";
import { profileHref } from "@/lib/routing/identifiers";

/** The hover bar shows the first few of the shared quick set (recently used first). */
const HOVER_QUICK_COUNT = 3;
const LONG_PRESS_MS = 500;

// ponytail: the timeline shows the uploaded image itself, already capped at 1920px
// and 5 MB on the device (S3-07). ceiling: ~6-10 MB for a channel of 20 photos.
// upgrade: 400px thumbnails when measured timeline bandwidth or plan image transforms justify it.
function toViewerAttachment(attachment: ChatAttachmentView): ChatAttachmentV2 {
  const url = `/api/v1/chat/attachments/${attachment.asset_id}`;
  const type = attachment.mime.startsWith("image/") ? "image" : attachment.mime.startsWith("video/") ? "video" : "file";
  return { id: attachment.asset_id, type, url, localUrl: attachment.local_url, filename: attachment.name || "file", sizeBytes: attachment.size, mimeType: attachment.mime, thumbnailUrl: null, width: attachment.width, height: attachment.height };
}

const CreateTaskModal = dynamic(() => import("@/components/workspaces/v2/tasks/CreateTaskModal"), { ssr: false });
const EditBox = dynamic(() => import("@/components/messages/MessageEditBox").then((m) => m.EditBox), { ssr: false });

type Action = { id: string; label: string; icon: LucideIcon; run: () => void; shortcut?: string; destructive?: boolean; group: 1 | 2 | 3 };

// Deletes of your own messages wait out an Undo window; pending ones live here.
const pendingDeletes = new Map<string, { commit: () => void }>();
let flushOnLeave = false;
/**
 * Leaving the page (or hiding it, which on phones is often the last event before it's killed)
 * sends the pending deletes now, so a closed tab doesn't bring the message back.
 * ponytail: best effort; a request started while the page unloads can still be cut off.
 */
function bindFlushOnLeave() {
  if (flushOnLeave) return;
  flushOnLeave = true;
  const flush = () => {
    for (const [key, pending] of pendingDeletes) {
      pendingDeletes.delete(key);
      pending.commit();
    }
  };
  window.addEventListener("pagehide", flush);
}

/** Who reacted, loaded when the tooltip opens. */
function ReactionChip({ emoji, count, me, seq, onToggle, pop = false }: { emoji: string; count: number; me: boolean; seq: number; onToggle: () => void; pop?: boolean }) {
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
  const rest = names.length - 3;
  const who = rest > 0 ? `${names.slice(0, 3).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}` : names.join(" and ").replace(/ and (?=.* and )/g, ", ");
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          // aria-disabled, not disabled: previewers still get the "who reacted" tooltip.
          onClick={ctx.isMember === false ? undefined : onToggle}
          aria-disabled={ctx.isMember === false || undefined}
          aria-pressed={me}
          aria-label={`${emoji} ${count}${me ? ", you reacted" : ""}`}
          className={`nbm-rc${pop ? " nbm-pop" : ""}`}
          data-me={me ? "true" : undefined}
        >
          <span className="nbm-rc-e">{emoji}</span><span>{count}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-center">
        {who ? `${who} reacted with ${emoji}` : count ? "Loading…" : "No votes yet"}
      </TooltipContent>
    </Tooltip>
  );
}

const SYSTEM_ICONS: Array<[RegExp, LucideIcon]> = [
  [/^joined/, LogIn], [/^left/, LogOut], [/^removed/, UserMinus], [/^(renamed|named|removed the group)/, Pencil],
  [/^set the topic/, MessageSquareText], [/^(unarchived|archived)/, Archive], [/^created/, Hash],
];

// Application status lines: each verb has its own mark, so a decline never looks like a channel being created.
const APPLICATION_LINE_ICONS: Record<ApplicationLineKind, LucideIcon> = {
  accepted: CheckCircle2, declined: XCircle, withdrew: Undo2, reopened: RotateCcw, applied: Send, edited: Pencil, closed: Lock,
};

function SystemRow({
  message,
  others,
  onToggleReaction,
}: {
  message: ChatMessageView;
  others?: ChatMessageView[];
  onToggleReaction?: (emoji: string) => void;
}) {
  const ctx = useConversationContext();
  const lineKind = applicationLineKind(message.body);
  const Icon = (lineKind ? APPLICATION_LINE_ICONS[lineKind] : undefined) ?? SYSTEM_ICONS.find(([pattern]) => pattern.test(message.body))?.[1] ?? Hash;
  const isJoin = /^joined/.test(message.body);
  const people = [message, ...(others ?? [])].map((m) => personName(m.author));
  // Names for <@id> tokens, no actor before a whole sentence, a capped tooltip (system-line.ts).
  const line = systemLine(message.body, people, ctx.nameOf);
  const who = line.who ?? "";
  const body = line.text;
  const at = (others?.at(-1) ?? message).created_at;
  const authorRole = message.author?.project_role_title;

  if (isJoin && message.author) {
    const userHref = profileHref({ id: message.author.id, username: message.author.username });
    return (
      <div className="nbm-sys nbm-sys-join" data-seq={message.seq} title={line.title}>
        <span className="nbm-sys-face" aria-hidden="true">
          <UserAvatar identity={message.author} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 leading-snug">
            <Link href={userHref} className="font-semibold text-foreground hover:underline">
              {who}
            </Link>
            {authorRole ? (
              <span className="nbm-tag">{authorRole}</span>
            ) : null}
            <span className="text-muted-foreground">{body}.</span>
            <span className="nbm-msg-time ml-auto" title={new Date(at).toLocaleString()}>
              {formatChatTime(at, "clock")}
            </span>
          </div>

          <div className="nbm-reacts">
            {message.reactions.map((r) => (
              <ReactionChip
                key={r.emoji}
                emoji={r.emoji}
                count={r.count}
                me={r.me}
                seq={message.seq}
                onToggle={() => onToggleReaction?.(r.emoji)}
              />
            ))}
            {onToggleReaction ? (
              <button
                type="button"
                onClick={() => onToggleReaction("👋")}
                aria-label={`Wave to ${who}`}
                title={`Say hello to ${who}`}
                className="nbm-wave"
              >
                <span className="nbm-rc-e">👋</span>
                <span>Wave</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nbm-sys" data-seq={message.seq} title={line.title}>
      {/* The glyph sits in the avatar column, so the text lines up with message text. */}
      <span className="nbm-sys-gutter" aria-hidden="true"><span className="nbm-sys-glyph"><Icon size={14} /></span></span>
      {/* A decision note can be long: it wraps instead of being cut off. */}
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{who ? <><b>{who}</b> </> : null}{body}</span>
      <span className="nbm-msg-time" title={new Date(at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}>{formatChatTime(at, "clock")}</span>
    </div>
  );
}

/** One poll option: its bar and count; who voted for it on hover (the same list as a reaction's tooltip). */
function PollOption({ option, seq, canVote, onVote, label }: {
  option: ReturnType<typeof pollStats>["options"][number]; seq: number; canVote: boolean; onVote: (emoji: string) => void; label: string;
}) {
  const ctx = useConversationContext();
  const [open, setOpen] = useState(false);
  const reactors = useQuery({
    queryKey: queryKeys.chat.reactors(ctx.channelId, seq),
    enabled: open && option.count > 0,
    queryFn: async () => {
      const result = await listReactors({ channelId: ctx.channelId, seq });
      return result.success ? result.reactors : {};
    },
    staleTime: 15_000,
  });
  const names = reactors.data?.[option.emoji] ?? [];
  const who = joinPeople(names, 3);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="nbm-poll-opt"
          aria-pressed={option.me}
          aria-disabled={canVote ? undefined : true}
          onClick={canVote ? () => onVote(option.emoji) : undefined}
          aria-label={`${label}, ${option.count} vote${option.count === 1 ? "" : "s"}${option.me ? ", your vote" : ""}`}
        >
          <span className="nbm-poll-num" aria-hidden="true">{option.emoji}</span>
          <span className="nbm-poll-main" aria-hidden="true">
            <span className="nbm-poll-label">{label}</span>
            <span className="nbm-poll-track"><span className="nbm-poll-bar" style={{ width: `${option.share}%` }} /></span>
          </span>
          <span className="nbm-poll-count" aria-hidden="true">{option.count} <i>{option.share}%</i></span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-center">
        {who ? `${who} reacted with ${option.emoji}` : option.count ? "Loading…" : "No votes yet"}
      </TooltipContent>
    </Tooltip>
  );
}

/** A /poll message as a card: one button per option with its bar (votes ÷ all votes), "Pick any" (each option is a reaction). */
function PollCard({ poll, seq, reactions, canVote, onVote, suffix }: { poll: NonNullable<ReturnType<typeof pollParts>>; seq: number; reactions: ChatMessageView["reactions"]; canVote: boolean; onVote: (emoji: string) => void; suffix?: React.ReactNode }) {
  const ctx = useConversationContext();
  // The /poll text keeps its tokens (encode() in the Composer): names, not <@id>, here too.
  const plain = (text: string) => tokensToPlainText(text, ctx.nameOf, ctx.channelNameOf).replace(/\*\*(.+?)\*\*/g, "$1");
  const stats = pollStats(poll.options, reactions);
  return (
    <div className="nbm-poll" role="group" aria-label={`Poll: ${plain(poll.question)}`}>
      <div className="nbm-poll-head"><span className="nbm-tag"><ListChecks size={12} aria-hidden="true" />Poll</span>{suffix}</div>
      <p className="nbm-poll-q">{plain(poll.question)}</p>
      <TooltipProvider delayDuration={250}>
        {stats.options.map((option) => <PollOption key={option.emoji} option={option} seq={seq} canVote={canVote} onVote={onVote} label={plain(option.label)} />)}
      </TooltipProvider>
      <div className="nbm-poll-foot"><span>{stats.votes ? `${stats.votes} vote${stats.votes === 1 ? "" : "s"}` : "No votes yet"}</span><span>Pick any</span></div>
    </div>
  );
}

/** Long messages stop at 12 lines with a fade and "Show all · 4,000 characters"; short ones never show the button. */
const FOLD_PX = 14.5 * 1.5 * 12;
function FoldBody({ length, children }: { length: number; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  // Watches the content itself: a narrower column, an image shown, or an edit can make it overflow later.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setOver(el.getBoundingClientRect().height > FOLD_PX + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div className="nbm-fold-body" data-folded={open ? undefined : "true"} data-over={over ? "true" : undefined}><div ref={inner}>{children}</div></div>
      {over || open ? <button type="button" className="nbm-fold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : foldLabel(length)}</button> : null}
    </>
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
  const [customRemind, setCustomRemind] = useState<Date | null>(null);
  // The hover bar sits above the row; on the top row it would hide under the tab bar, so it drops inside.
  const [barInside, setBarInside] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  // Reactions already there when the row mounted don't pop; one added while you watch does.
  const seenReactions = useRef(new Set([...message.reactions.map((r) => r.emoji), ...pollOptions(message.body)]));
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const previewMutationRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Keeps the toolbar shown through the menu's exit animation, so the menu
  // never animates out from (0,0) after its anchor disappears.
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quick = useQuickReactions();

  const own = message.author_id === ctx.meId;
  // "Reported · in review" (trust and safety C16): one shared request per session, not one per message.
  const reportedCase = useOpenReportCase(!own && !message.card && message.kind === "user" ? { kind: "chat_message", targetId: ctx.channelId, seq: message.seq } : undefined);
  const pending = message.seq < 0;
  const deleted = Boolean(message.deleted_at);
  // A message hidden or removed by moderation says so in place (trust and safety §7.1); asked once per conversation.
  const moderated = useModeratedItems(deleted ? { channelId: ctx.channelId } : null).find((m) => m.seq === message.seq) ?? null;
  const member = ctx.isMember !== false;
  const actions = !pending && !deleted && member;
  const editing = ctx.editingSeq === message.seq;
  // The application card is the application's record: it is never deleted (the database refuses too).
  const canDelete = (own || ctx.canAdmin) && message.card?.kind !== "application";
  const saved = ctx.savedSeqs?.has(message.seq) ?? false;
  const authorName = personName(message.author);
  // Like Slack: the author's status emoji after their name (💬 when the status is text only).
  const authorPresence = usePersonPresence(grouped ? null : message.author?.id);
  const authorStatus = authorPresence.status ? authorPresence.statusText || "Status" : null;
  const mentioned = !own && message.kind === "user" && (() => {
    const { userIds, broadcast } = parseMentions(message.body);
    return Boolean(broadcast) || (ctx.meId ? userIds.includes(ctx.meId) : false);
  })();
  const plain = () => tokensToPlainText(message.body, ctx.nameOf, ctx.channelNameOf);
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
  // Saving or cancelling an edit puts focus back in this pane's message box, never on <body>.
  const backToComposer = () => requestAnimationFrame(() => {
    rowRef.current?.closest("[data-chat-pane]")?.querySelector<HTMLElement>(".nb-message-composer [contenteditable]")?.focus();
  });
  const cancelEdit = () => {
    ctx.setEditingSeq(null);
    backToComposer();
  };
  const saveEdit = async (markdown: string) => {
    const body = encodeMentions(markdown.trim(), ctx.people.map((p) => ({ id: p.id, name: p.full_name || p.username || "" })), { broadcast: false });
    ctx.setEditingSeq(null);
    backToComposer();
    // Emptied a text-only message: that's a delete, so ask (the same dialog as Delete) instead of ignoring it.
    // With files, empty text just removes the caption.
    if (!body && !message.attachments.length) {
      setConfirmDelete(true);
      return;
    }
    if (body === message.body) return;
    const previous = { body: message.body, edited_at: message.edited_at };
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, body, edited_at: new Date().toISOString() })));
    const result = await editMessage({ channelId: ctx.channelId, seq: message.seq, body });
    if (!result.success) {
      update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, ...previous })));
      toast.error(chatErrorMessage(result.error));
    }
  };
  // From the confirm dialog: a failure throws, so the dialog stays open and says why.
  const remove = async () => {
    const result = await deleteMessage({ channelId: ctx.channelId, seq: message.seq });
    if (!result.success) throw new Error(chatErrorMessage(result.error));
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, body: "", attachments: [], deleted_at: new Date().toISOString() })));
  };
  // The toast reading clock also owns the deferred commit, including hover/focus/hidden-tab pauses.
  const removeWithUndo = () => {
    const key = `${ctx.channelId}:${message.seq}`;
    const before = message;
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, deleted_at: new Date().toISOString() })));
    const run = () => void deleteMessage({ channelId: ctx.channelId, seq: before.seq }).then((result) => {
      if (result.success) return;
      update((pages) => patchPages(pages, before.seq, () => before));
      toast.error(chatErrorMessage(result.error));
    }).catch(() => {
      update((pages) => patchPages(pages, before.seq, () => before));
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(ctx.channelId) });
      toast.error("Deletion wasn’t confirmed", { description: "Refreshing message status." });
    });
    bindFlushOnLeave();
    const pending = deferredFeedback("Message deleted", () => {
      pendingDeletes.delete(key);
      update((pages) => patchPages(pages, before.seq, () => before));
    }, () => { pendingDeletes.delete(key); run(); });
    pendingDeletes.set(key, pending);
  };
  // The author's × on the link card: gone for everyone (the link stays in the text).
  const removePreview = useCallback(async (hidden = true) => {
    if (previewMutationRef.current) return;
    previewMutationRef.current = true;
    const previous = message.link_preview_hidden;
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, link_preview_hidden: hidden })));
    if (hidden) {
      const focusTarget = moreTriggerRef.current?.getClientRects().length ? moreTriggerRef.current : rowRef.current;
      focusTarget?.focus();
    }
    try {
      const result = await hideLinkPreview({ channelId: ctx.channelId, seq: message.seq, hidden });
      if (!result.success) throw new Error(chatErrorMessage(result.error));
    } catch (error) {
      update((pages) => patchPages(pages, message.seq, (m) => m.link_preview_hidden === hidden ? { ...m, link_preview_hidden: previous } : m));
      toast.error(feedbackError(error instanceof Error ? error.message : 'Couldn’t update the link preview', "Couldn’t update the link preview"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.messages(ctx.channelId) });
    } finally {
      previewMutationRef.current = false;
    }
  }, [ctx.channelId, message.seq, message.link_preview_hidden, queryClient, update]);
  const onRemovePreview = useCallback(() => { void removePreview(); }, [removePreview]);
  const togglePin = async () => {
    const nextPinned = !message.pinned;
    const result = await pinMessage({ channelId: ctx.channelId, seq: message.seq, on: nextPinned });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, pinned: nextPinned })));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.pins(ctx.channelId) });
    if (nextPinned && ctx.openPinsTab) toast.success("Pinned to the conversation", { action: { label: "View pins", onClick: () => ctx.openPinsTab?.() } });
    else toast.success(nextPinned ? "Pinned to the conversation" : "Unpinned");
  };
  const unread = async () => {
    const result = await markUnread({ channelId: ctx.channelId, seq: message.seq });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    // Only the sidebar data refreshes; rows don't subscribe to the shell (REND-02).
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.bootstrap(ctx.meId) });
    toast.success("Marked unread from here");
  };
  const createTask = async () => {
    const title = plain().replace(/\s+/g, " ").trim().slice(0, 200) || "Task from a message";
    const result = await createTaskFromMessage({ channelId: ctx.channelId, title, threadRootSeq: message.thread_root_seq ?? (ctx.inThread ? null : message.seq), operationId: crypto.randomUUID() });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    if (!result.message.thread_root_seq) update((pages) => upsertMessage(pages, result.message));
    toast.success("Task created");
  };

  // Report 38.6 W10 (A2.3): Report as bug opens the New module on Bug, prefilled from the message.
  const [bugDraft, setBugDraft] = useState<{ title: string; steps: string } | null>(null);
  const openBugReport = () => setBugDraft(bugFromMessage(plain().trim() || message.attachments.map((a) => a.name || "file").join(", ")));

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
    if (ctx.projectId && ctx.bugs && message.kind === "user" && !message.card && hasContent) list.push({ id: "bug", label: "Report as bug", icon: Bug, run: openBugReport, group: 2 });
    list.push({ id: "pin", label: message.pinned ? "Unpin" : "Pin to conversation", icon: Pin, run: () => void togglePin(), group: 2 });
    if (own && message.body && firstLink(message.body)) list.push({ id: "preview", label: message.link_preview_hidden ? "Restore link preview" : "Remove link preview", icon: message.link_preview_hidden ? Eye : EyeOff, run: () => void removePreview(!message.link_preview_hidden), group: 3 });
    if (own && !message.card) list.push({ id: "edit", label: "Edit message", icon: Pencil, run: startEdit, shortcut: "E", group: 3 });
    if (canDelete) list.push({ id: "delete", label: "Delete message", icon: Trash2, run: () => (own && !message.reply_count ? removeWithUndo() : setConfirmDelete(true)), shortcut: keyLabel("backspace"), destructive: true, group: 3 });
    // Task, application and invite cards are the app's own messages: nothing to report.
    if (!own && !message.card) list.push(reportedCase
      ? { id: "report", label: `Reported · in review · ${reportedCase}`, icon: Flag, run: () => toast(`You’ve already reported this. Case ${reportedCase} is in review.`), group: 3 }
      : { id: "report", label: "Report message", icon: Flag, run: () => setReportOpen(true), group: 3 });
    const author = message.author;
    if (!own && !message.card && author && ctx.openBlock && !ctx.blockedIds?.has(author.id)) {
      list.push({ id: "block", label: `Block ${authorName}`, icon: Ban, run: () => ctx.openBlock?.({ id: author.id, name: authorName }), destructive: true, group: 3 });
    }
    if (!own && !message.card && author && ctx.toggleMute && ctx.mutedIds) {
      const muted = ctx.mutedIds.has(author.id);
      list.push({ id: "mute", label: muted ? `Unmute ${authorName}` : `Mute ${authorName}`, icon: BellOff, run: () => ctx.toggleMute?.({ id: author.id, name: authorName }, !muted), group: 3 });
    }
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

  // @mention chips open the person's card (the people list has their avatar and username).
  // Stable, so the message's markdown isn't parsed again on every hover or menu change.
  const { people, nameOf } = ctx;
  const wrapMention = useCallback((userId: string, chip: React.ReactNode) => {
    const person = people.find((p) => p.id === userId) ?? { id: userId, username: null, full_name: nameOf(userId) ?? null, avatar_url: null };
    return <PersonHoverCard person={person}>{chip}</PersonHoverCard>;
  }, [nameOf, people]);
  // Who reacted, for the touch sheet (no hover tooltips on a phone).
  const reactors = useQuery({
    queryKey: queryKeys.chat.reactors(ctx.channelId, message.seq),
    enabled: sheet === "actions" && message.reactions.length > 0,
    queryFn: async () => {
      const result = await listReactors({ channelId: ctx.channelId, seq: message.seq });
      return result.success ? result.reactors : {};
    },
    staleTime: 15_000,
  });

  if (message.kind === "system") {
    if (message.card) {
      return (
        <div className="px-4 py-2" data-seq={message.seq}>
          <MessageCard card={message.card} />
        </div>
      );
    }
    return <SystemRow message={message} others={others} onToggleReaction={toggleReaction} />;
  }

  // Someone you blocked or muted, in a channel or group you share: folded until you ask (Blocking B10, B26, B40, B42).
  const foldedAs = own || unfolded || !message.author_id ? null
    : ctx.blockedIds?.has(message.author_id) ? "blocked" : ctx.mutedIds?.has(message.author_id) ? "muted" : null;
  if (foldedAs) {
    return (
      <div className="nbm-folded" data-seq={message.seq}>
        Message from someone you {foldedAs}<span className="sr-only">, hidden</span>.{" "}
        <button type="button" className="font-medium text-foreground underline underline-offset-2 hover:text-primary pointer-coarse:min-h-11" onClick={() => setUnfolded(true)}>Show</button>
      </div>
    );
  }

  const isToolbarOpen = moreOpen || closing || Boolean(pickerAnchor);
  const handleMoreOpenChange = (open: boolean) => {
    setMoreOpen(open);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setClosing(!open);
    if (!open) closeTimerRef.current = setTimeout(() => setClosing(false), 250);
  };
  const groups = [1, 2, 3].map((group) => list.filter((a) => a.group === group)).filter((g) => g.length);
  const remind = (at: () => Date) => ctx.setSaved?.(message.seq, true, at().toISOString());
  // A poll shows a chip for every option from the start (0 votes too); other reactions follow.
  const options = pollOptions(message.body);
  // A poll's options are its card's buttons; only other reactions stay chips under it.
  const poll = options.length ? pollParts(message.body) : null;
  const chips = options.length ? message.reactions.filter((r) => !options.includes(r.emoji)) : message.reactions;
  const fullTime = new Date(message.created_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const rowId = `msg-${ctx.channelId}-${ctx.inThread ? "t" : "c"}-${message.seq}`;
  const placeBar = () => {
    const row = rowRef.current;
    const scroller = row?.closest("[data-virtuoso-scroller]");
    if (row && scroller) setBarInside(row.getBoundingClientRect().top - scroller.getBoundingClientRect().top < 24);
  };

  return (
    <div
      ref={rowRef}
      data-seq={message.seq}
      data-testid={`chat-message-${message.seq}`}
      data-mentioned={mentioned ? "true" : undefined}
      data-message-row=""
      tabIndex={tabStop ? 0 : -1}
      // Read as "who, when" plus the message itself (an aria-label would replace the message).
      role="article"
      aria-labelledby={`${rowId}-who ${rowId}-body`}
      onKeyDown={onRowKeyDown}
      onMouseEnter={placeBar}
      onFocus={placeBar}
      // Mention: a neutral well (status colours mean status, and the spec has no side bar);
      // a jump target: the accent tint, so the two never look alike.
      className={`nbm-msg group/msg relative outline-none [-webkit-touch-callout:none]${highlighted ? " nbm-flash" : ""}`}
      data-grouped={grouped ? "true" : undefined}
      data-mention={mentioned ? "true" : undefined}
      onContextMenu={(e) => {
        // Touch: long-press opens our sheet, not the browser's callout.
        if (actions && window.matchMedia("(pointer: coarse)").matches) e.preventDefault();
      }}
      onTouchStart={(e) => {
        if (!actions) return;
        // A press on a link, image, video or chip does its own thing.
        if ((e.target as HTMLElement).closest("a,button,img,video,input,textarea,[contenteditable=true]")) return;
        pressTimer.current = setTimeout(() => setSheet("actions"), LONG_PRESS_MS);
      }}
      onTouchEnd={() => pressTimer.current && clearTimeout(pressTimer.current)}
      onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
    >
      <span id={`${rowId}-who`} className="sr-only">{authorName}{authorStatus ? ` (${authorStatus})` : ""}, {fullTime}{pending && !message.failed ? ", sending" : ""}</span>
      {message.pinned || saved ? (
        <p className="nbm-flags">
          {message.pinned ? <span>Pinned</span> : null}
          {saved ? <span className="nbm-flags-saved">Saved</span> : null}
        </p>
      ) : null}
      <div className="flex gap-3">
        <div className="nbm-msg-gutter">
          {grouped ? (
            <button type="button" tabIndex={-1} onClick={pending ? undefined : copyLink} title={`${fullTime}${pending ? "" : " · click to copy link"}`} className="nbm-gutter-time">{formatChatTime(message.created_at, "clock")}</button>
          ) : (
            <PersonHoverCard person={message.author}>
              <UserAvatar identity={message.author} size={36} />
            </PersonHoverCard>
          )}
        </div>
        <div className="min-w-0 flex-1" id={`${rowId}-body`}>
          {grouped ? null : (
            <div className="flex items-baseline gap-2" aria-hidden="true">
              <PersonHoverCard person={message.author}>
                <span className="nbm-msg-name hover:underline">{authorName}</span>
              </PersonHoverCard>
              {authorStatus ? <span title={authorStatus} className="font-[system-ui] text-[13px] leading-none">{authorPresence.status?.emoji || "💬"}</span> : null}
              <button type="button" tabIndex={-1} onClick={pending ? undefined : copyLink} title={`${fullTime}${pending ? "" : " · click to copy link"}`} className="nbm-msg-time hover:underline">{formatChatTime(message.created_at, "clock")}</button>
              {pending && !message.failed ? <span className="nbm-msg-sending" aria-hidden="true"><PixelBeat />Sending…</span> : null}
            </div>
          )}
          {deleted ? (
            <p className="text-[15px] italic text-muted-foreground">
              {moderated ? `${moderatedText(moderated, "message")}.` : "This message was deleted."}
              {moderated?.canAppeal && moderated.caseLabel ? <> <a href={`/appeal/${moderated.caseLabel}`} className="not-italic font-medium text-foreground underline underline-offset-4">Appeal</a></> : null}
            </p>
          ) : editing ? (
            <EditBox
              body={message.body}
              labelOf={(raw) => (raw.startsWith("<#") ? `#${ctx.channelNameOf(raw.slice(2, -1)) ?? "channel"}` : `@${ctx.nameOf(raw.slice(2, -1)) ?? "someone"}`)}
              onSave={(markdown) => void saveEdit(markdown)}
              onCancel={cancelEdit}
              people={ctx.people}
            />
          ) : (
            <>
              {poll ? (
                <PollCard poll={poll} seq={message.seq} reactions={message.reactions} canVote={ctx.isMember !== false && !pending} onVote={(emoji) => void toggleReaction(emoji)} suffix={message.edited_at ? <span className="nbm-edited ml-auto">(edited)</span> : undefined} />
              ) : message.body ? (
                <FoldBody length={tokensToPlainText(message.body, ctx.nameOf, ctx.channelNameOf).length}>
                <MessageBody
                  body={message.body}
                  nameOf={ctx.nameOf}
                  channelNameOf={ctx.channelNameOf}
                  meId={ctx.meId}
                  wrapMention={wrapMention}
                  suffix={message.edited_at ? <span className="nbm-edited ml-1" title={`Edited ${new Date(message.edited_at).toLocaleString()}`}>(edited)</span> : undefined}
                />
                </FoldBody>
              ) : message.edited_at ? <span className="nbm-edited">(edited)</span> : null}
              {message.attachments.length ? (
                <div className="mt-1 max-w-[480px]"><MessageAttachmentsV2 attachments={message.attachments.map(toViewerAttachment)} /></div>
              ) : null}
              {message.card ? <MessageCard card={message.card} /> : null}
              {message.body && !message.link_preview_hidden && message.card?.kind !== "application" ? <MessageLinkPreview body={message.body} onRemove={own && actions ? onRemovePreview : undefined} /> : null}
            </>
          )}
          {/* A deleted message keeps no reactions (like Slack). */}
          {(chips.length || (poll && actions)) && !deleted ? (
            <TooltipProvider delayDuration={250}>
              <div className="nbm-reacts">
                {chips.map((r) => (
                  <ReactionChip key={r.emoji} emoji={r.emoji} count={r.count} me={r.me} seq={message.seq} onToggle={() => void toggleReaction(r.emoji)} pop={!seenReactions.current.has(r.emoji)} />
                ))}
                {actions ? (
                  <button type="button" data-reaction-trigger onClick={(e) => setPickerAnchor(pickerAnchor ? null : e.currentTarget)} aria-label="Add reaction" title="Add reaction" className="nbm-rc nbm-rc-add">
                    <SmilePlus size={14} />
                  </button>
                ) : null}
              </div>
            </TooltipProvider>
          ) : null}
          {pending && !message.failed && grouped ? <p className="nbm-msg-sending" aria-hidden="true"><PixelBeat />Sending…</p> : null}
          {message.failed ? (
            <p role="alert" className="nbm-failed">
              <span className="nbm-failed-label">Not sent{failed?.assetIds.length ? ` · ${failed.assetIds.length} file${failed.assetIds.length === 1 ? "" : "s"}` : ""}</span>
              {failed ? <button type="button" onClick={() => message.client_message_id && void retrySend(queryClient, message.client_message_id)} className="font-medium underline pointer-coarse:min-h-11">Retry</button> : null}
              {/* Edit puts the text back in the box; files can't go with it, so a send with files only retries. */}
              {failed && message.body && !failed.assetIds.length ? <button type="button" onClick={() => message.client_message_id && editFailedSend(queryClient, message.client_message_id, ctx.channelId, message.thread_root_seq, failed.body)} className="font-medium underline pointer-coarse:min-h-11">Edit</button> : null}
              <button type="button" onClick={() => message.client_message_id && discardSend(queryClient, message.client_message_id, ctx.channelId, message.thread_root_seq)} className="font-medium underline pointer-coarse:min-h-11">Delete</button>
            </p>
          ) : null}
          {!ctx.inThread && message.reply_count > 0 ? (
            <button type="button" onClick={() => ctx.openThread(message.seq)} className="nbm-thr">
              <b>{message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}</b>
              {message.last_reply_at ? <span className="nbm-thr-meta">last reply {formatChatTime(message.last_reply_at, "ago")}</span> : null}
            </button>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div
          className={`absolute ${barInside ? "top-1" : "-top-3"} right-4 z-20 ${isToolbarOpen ? "flex" : "hidden group-hover/msg:flex group-focus-within/msg:flex"} items-center nbm-bar pointer-coarse:!hidden`}
          role="toolbar"
          aria-label="Message actions"
        >
          {quick.slice(0, HOVER_QUICK_COUNT).map((emoji) => (
            <button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => void toggleReaction(emoji)}>{emoji}</button>
          ))}
          <button type="button" data-reaction-trigger aria-label="Add reaction" title="Add reaction" onClick={(e) => setPickerAnchor(pickerAnchor ? null : e.currentTarget)}><SmilePlus size={16} /></button>
          {(["reply", "save", "share"] as const).map((id) => {
            const action = find(id);
            if (!action) return null;
            const Icon = action.icon;
            return (
              // No key hint here: the keys act on a selected row (Tab, ↑/↓), not the hovered one.
              <button key={id} type="button" aria-label={action.label} title={action.label} onClick={action.run}>
                <Icon size={16} />
              </button>
            );
          })}
          <DropdownMenu open={moreOpen} onOpenChange={handleMoreOpenChange} modal={false}>
            <DropdownMenuTrigger asChild>
              <button ref={moreTriggerRef} type="button" data-open={moreOpen ? "true" : undefined} aria-label="More actions">
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="nbm nbm-menu min-w-[210px]">
              {groups.map((group, index) => (
                <div key={index}>
                  {index ? <DropdownMenuSeparator /> : null}
                  {group.map((action) => {
                    const Icon = action.icon;
                    return (
                      <DropdownMenuItem key={action.id} onSelect={action.run} variant={action.destructive ? "destructive" : "default"}>
                        <Icon />
                        <span className="flex-1">{action.label}</span>
                        {action.shortcut ? <kbd className="nb-meta">{action.shortcut}</kbd> : null}
                      </DropdownMenuItem>
                    );
                  })}
                  {index === 0 && ctx.setSaved ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger><AlarmClock /> Remind me about this</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="nbm nbm-menu w-48">
                        {laterTimes("remind").map((option) => <DropdownMenuItem key={option.label} onSelect={() => remind(option.at)}>{option.label}</DropdownMenuItem>)}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setCustomRemind(new Date(Date.now() + 2 * 60 * 60_000))}>Custom time…</DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
        <DialogContent presentation="bottom-sheet" showCloseButton={false} className="nbm">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          {sheet === "remind" ? (
            <>
              <div className="flex items-center gap-1 px-2 pt-2">
                <button type="button" onClick={() => setSheet("actions")} className="inline-flex min-h-11 items-center rounded-md px-3 text-[15px] text-primary">‹ Back</button>
                <DialogTitle className="text-[15px] font-semibold">Remind me</DialogTitle>
              </div>
              <div className="px-2 pb-3 [&>button]:flex [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:rounded-md [&>button]:px-3 [&>button]:text-[15px]">
                {laterTimes("remind").map((option) => <button key={option.label} type="button" onClick={() => { setSheet(null); remind(option.at); }}>{option.label}</button>)}
                <button type="button" onClick={() => { setSheet(null); setCustomRemind(new Date(Date.now() + 2 * 60 * 60_000)); }}>Custom time…</button>
              </div>
            </>
          ) : (
            <>
              <DialogTitle className="sr-only">Message actions</DialogTitle>
              <div className="flex justify-around px-2 py-3">
                {quick.map((emoji) => (
                  <button key={emoji} type="button" className="grid size-11 place-items-center rounded-md text-xl hover:bg-muted" aria-label={`React ${emoji}`} onClick={() => { setSheet(null); void toggleReaction(emoji); }}>{emoji}</button>
                ))}
                {/* Any other emoji: the full picker. */}
                <button type="button" className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label="More reactions" onClick={() => { setSheet(null); setPickerAnchor(rowRef.current); }}><SmilePlus size={24} /></button>
              </div>
              {/* Who reacted (a phone has no hover tooltips). */}
              {message.reactions.length ? (
                <ul className="mx-4 mb-2 space-y-1 border-y border-border py-2 text-[13px]" aria-label="Reactions">
                  {message.reactions.map((r) => (
                    <li key={r.emoji} className="flex gap-2">
                      <span aria-hidden="true">{r.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{reactors.data?.[r.emoji]?.join(", ") ?? `${r.count}`}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="px-2 pb-3 [&>button]:flex [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-md [&>button]:px-3 [&>button]:text-[15px]">
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
        contentClassName="nbm nbm-dialog"
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={own ? "Delete your message?" : `Delete ${authorName}'s message?`}
        description={own ? "Replies in its thread stay. You can undo for a few seconds." : message.reply_count ? "It’s removed for everyone. Replies in its thread stay." : "It’s removed for everyone. This can’t be undone."}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (own) removeWithUndo();
          else await remove();
        }}
      />
      <TimePickerDialog
        initial={customRemind}
        title="Remind me"
        label="Remind me at"
        confirmLabel="Set reminder"
        onPick={(at) => ctx.setSaved?.(message.seq, true, at.toISOString())}
        onClose={() => setCustomRemind(null)}
      />
      {reportOpen ? (
        // The app-wide report flow (docs/trust-and-safety-concept.md): a case staff see, with the 5 messages before it.
        <ReportDialog kind="chat_message" targetId={ctx.channelId} seq={message.seq} noun="message"
          personName={message.author?.full_name || message.author?.username || null} open={reportOpen} onOpenChange={setReportOpen} />
      ) : null}
      {bugDraft && ctx.projectId ? (
        <CreateTaskModal isOpen onClose={() => setBugDraft(null)} projectId={ctx.projectId} types={["bug"]} initialType="bug" openedFrom="own" lockType
          initialTitle={bugDraft.title} initialSteps={bugDraft.steps} fromLine={`a message from ${authorName}`}
          onCreate={async ({ draft, subtasks, attachments }) => {
            const result = await reportBugFromMessage({
              channelId: ctx.channelId, seq: message.seq, title: draft.title, typeFields: draft.typeFields, description: draft.description || undefined,
              attachmentNodeIds: attachments.map((a) => a.id), subtasks: subtasks.map((t) => ({ title: t.title.trim(), completed: false })).filter((t) => t.title),
              threadRootSeq: message.thread_root_seq ?? (ctx.inThread ? null : message.seq), operationId: crypto.randomUUID(),
            });
            if (!result.success) return { success: false, error: ("message" in result && result.message) || chatErrorMessage(result.error) };
            if (!result.message.thread_root_seq) update((pages) => upsertMessage(pages, result.message));
            toast.success("Bug reported");
            return { success: true };
          }} />
      ) : null}
    </div>
  );
});
