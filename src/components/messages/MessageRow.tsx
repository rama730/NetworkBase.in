"use client";

import { memo, useRef, useState } from "react";
import { Flag, Link2, MessageSquareText, MoreHorizontal, Pencil, Pin, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteMessage, editMessage, pinMessage, react, reportMessage } from "@/app/actions/chat/messages";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useLinkPreview } from "@/hooks/useLinkPreview";
import { personName } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { applyReaction, patchPages } from "@/lib/messaging/timeline";
import { encodeMentions, tokensToDraft } from "@/lib/messaging/tokens";
import type { ChatAttachmentView, ChatMessageView } from "@/lib/messaging/types";

const QUICK = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];
const LONG_PRESS_MS = 500;

function toViewerAttachment(attachment: ChatAttachmentView): ChatAttachmentV2 {
  const url = `/api/v1/chat/attachments/${attachment.asset_id}`;
  const type = attachment.mime.startsWith("image/") ? "image" : attachment.mime.startsWith("video/") ? "video" : "file";
  return { id: attachment.asset_id, type, url, filename: attachment.name || "file", sizeBytes: attachment.size, mimeType: attachment.mime, thumbnailUrl: null, width: attachment.width, height: attachment.height };
}

function time(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function relative(value: string) {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function LinkPreview({ body }: { body: string }) {
  const url = firstLink(body);
  const preview = useLinkPreview(url);
  if (!url || !preview.data) return null;
  return <LinkPreviewCard preview={preview.data} isOwn={false} />;
}

export const MessageRow = memo(function MessageRow({ message, grouped, highlighted = false }: { message: ChatMessageView; grouped: boolean; highlighted?: boolean }) {
  const ctx = useConversationContext();
  const update = useUpdatePages(ctx.channelId);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const own = message.author_id === ctx.meId;
  const pending = message.seq < 0;
  const deleted = Boolean(message.deleted_at);
  const editing = ctx.editingSeq === message.seq;
  const canDelete = own || ctx.canAdmin;
  const canPin = ctx.canAdmin || ctx.isDm;
  const authorName = personName(message.author);

  const toggleReaction = async (emoji: string) => {
    if (pending) return;
    const on = !message.reactions.some((r) => r.emoji === emoji && r.me);
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, reactions: applyReaction(m.reactions, emoji, on, true) })));
    const result = await react({ channelId: ctx.channelId, seq: message.seq, emoji, on });
    if (!result.success) {
      update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, reactions: applyReaction(m.reactions, emoji, !on, true) })));
      toast.error(chatErrorMessage(result.error));
    }
  };
  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}/messages/${ctx.channelId}?m=${message.seq}`);
    toast.success("Link copied");
  };
  const startEdit = () => {
    setDraft(tokensToDraft(message.body, ctx.nameOf));
    ctx.setEditingSeq(message.seq);
  };
  const saveEdit = async () => {
    const body = encodeMentions(draft.trim(), ctx.people.map((p) => ({ id: p.id, name: p.full_name || p.username || "" })));
    ctx.setEditingSeq(null);
    if (!body || body === message.body) return;
    const previous = message.body;
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, body, edited_at: new Date().toISOString() })));
    const result = await editMessage({ channelId: ctx.channelId, seq: message.seq, body });
    if (!result.success) {
      update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, body: previous })));
      toast.error(chatErrorMessage(result.error));
    }
  };
  const remove = async () => {
    setConfirmDelete(false);
    const result = await deleteMessage({ channelId: ctx.channelId, seq: message.seq });
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      return;
    }
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, body: "", attachments: [], deleted_at: new Date().toISOString() })));
  };
  const togglePin = async () => {
    const result = await pinMessage({ channelId: ctx.channelId, seq: message.seq, on: !message.pinned });
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      return;
    }
    update((pages) => patchPages(pages, message.seq, (m) => ({ ...m, pinned: !m.pinned })));
  };

  if (message.kind === "system") {
    return (
      <div className="px-4 py-1 pl-[58px] text-[13px] text-muted-foreground" data-seq={message.seq}>
        <span className="font-medium text-foreground">{authorName}</span> {message.body}
        <span className="ml-2 font-mono text-[12px]">{time(message.created_at)}</span>
      </div>
    );
  }

  const actions = !pending && !deleted;
  return (
    <div
      data-seq={message.seq}
      data-testid={`chat-message-${message.seq}`}
      className={`group/msg relative px-4 ${grouped ? "pt-0.5" : "pt-3"} pb-0.5 hover:bg-muted/50 focus-within:bg-muted/50 ${highlighted ? "bg-[var(--status-warning-soft)]" : ""} ${pending ? "opacity-60" : ""}`}
      onTouchStart={() => {
        if (!actions) return;
        pressTimer.current = setTimeout(() => setSheetOpen(true), LONG_PRESS_MS);
      }}
      onTouchEnd={() => pressTimer.current && clearTimeout(pressTimer.current)}
      onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
    >
      <div className="flex gap-2.5">
        <div className="w-[34px] flex-none">
          {grouped ? (
            <span className="hidden pt-1 font-mono text-[11px] text-muted-foreground group-hover/msg:block">{time(message.created_at)}</span>
          ) : (
            <UserAvatar identity={message.author} size={34} roundedClassName="rounded-[5px]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {grouped ? null : (
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium">{authorName}</span>
              <span className="font-mono text-[12px] text-muted-foreground">{time(message.created_at)}</span>
              {message.pinned ? <Pin size={12} aria-label="Pinned" className="text-muted-foreground" /> : null}
            </div>
          )}
          {deleted ? (
            <p className="text-[15px] italic text-muted-foreground">This message was deleted.</p>
          ) : editing ? (
            <div className="my-1 space-y-2">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); }
                  if (e.key === "Escape") ctx.setEditingSeq(null);
                }}
                rows={Math.min(8, draft.split("\n").length + 1)}
                className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[15px] pointer-coarse:text-[17px]"
                aria-label="Edit message"
              />
              <div className="flex gap-2 text-[13px]">
                <button type="button" className="rounded-[5px] border border-border px-3 py-1" onClick={() => ctx.setEditingSeq(null)}>Cancel</button>
                <button type="button" className="rounded-[5px] bg-primary px-3 py-1 text-primary-foreground" onClick={() => void saveEdit()}>Save</button>
              </div>
            </div>
          ) : (
            <>
              {message.body ? <MessageBody body={message.body} nameOf={ctx.nameOf} channelNameOf={ctx.channelNameOf} meId={ctx.meId} /> : null}
              {message.edited_at ? <span className="text-[12px] text-muted-foreground">(edited)</span> : null}
              {message.attachments.length ? (
                <div className="mt-1 max-w-[520px]"><MessageAttachmentsV2 attachments={message.attachments.map(toViewerAttachment)} /></div>
              ) : null}
              {message.card ? <MessageCard card={message.card} /> : null}
              {message.body ? <LinkPreview body={message.body} /> : null}
            </>
          )}
          {message.reactions.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => void toggleReaction(r.emoji)}
                  aria-pressed={r.me}
                  aria-label={`${r.emoji} ${r.count}${r.me ? ", you reacted" : ""}`}
                  className={`inline-flex h-6 items-center gap-1 rounded-[5px] border px-1.5 text-[13px] pointer-coarse:h-9 ${r.me ? "border-primary bg-accent" : "border-border bg-card"}`}
                >
                  <span>{r.emoji}</span><span className="font-mono text-[11px]">{r.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {!ctx.inThread && message.reply_count > 0 ? (
            <button type="button" onClick={() => ctx.openThread(message.seq)} className="mt-1 inline-flex min-h-7 items-center gap-2 rounded-[5px] px-1 text-[13px] font-medium text-primary hover:bg-card hover:underline">
              {message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}
              {message.last_reply_at ? <span className="font-normal text-muted-foreground">last reply {relative(message.last_reply_at)}</span> : null}
            </button>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="absolute -top-3 right-4 z-10 hidden items-center rounded-[5px] border border-border bg-card shadow-sm group-hover/msg:flex group-focus-within/msg:flex pointer-coarse:!hidden" role="toolbar" aria-label="Message actions">
          {QUICK.slice(0, 3).map((emoji) => (
            <button key={emoji} type="button" className="grid size-8 place-items-center rounded-[5px] hover:bg-muted" aria-label={`React ${emoji}`} onClick={() => void toggleReaction(emoji)}>{emoji}</button>
          ))}
          <button type="button" data-reaction-trigger className="grid size-8 place-items-center rounded-[5px] hover:bg-muted" aria-label="Add reaction" onClick={(e) => setPickerAnchor(pickerAnchor ? null : e.currentTarget)}><SmilePlus size={16} /></button>
          {ctx.inThread ? null : (
            <button type="button" className="grid size-8 place-items-center rounded-[5px] hover:bg-muted" aria-label="Reply in thread" onClick={() => ctx.openThread(message.seq)}><MessageSquareText size={16} /></button>
          )}
          {canPin ? (
            <button type="button" className="grid size-8 place-items-center rounded-[5px] hover:bg-muted" aria-label={message.pinned ? "Unpin" : "Pin"} onClick={() => void togglePin()}><Pin size={16} /></button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="grid size-8 place-items-center rounded-[5px] hover:bg-muted" aria-label="More actions"><MoreHorizontal size={16} /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={copyLink}><Link2 size={14} /> Copy link</DropdownMenuItem>
              {own && !message.card ? <DropdownMenuItem onSelect={startEdit}><Pencil size={14} /> Edit</DropdownMenuItem> : null}
              {canDelete ? <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive"><Trash2 size={14} /> Delete</DropdownMenuItem> : null}
              {own ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setReportOpen(true)}><Flag size={14} /> Report</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      {actions ? (
        <button type="button" className="absolute right-2 top-2 hidden size-11 place-items-center rounded-[5px] text-muted-foreground pointer-coarse:grid" aria-label="Message actions" onClick={() => setSheetOpen(true)}>
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

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent presentation="bottom-sheet" showCloseButton={false}>
          <DialogTitle className="sr-only">Message actions</DialogTitle>
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          <div className="flex justify-around px-2 py-3">
            {QUICK.map((emoji) => (
              <button key={emoji} type="button" className="grid size-11 place-items-center rounded-full text-xl hover:bg-muted" aria-label={`React ${emoji}`} onClick={() => { setSheetOpen(false); void toggleReaction(emoji); }}>{emoji}</button>
            ))}
          </div>
          <div className="px-2 pb-3 [&>button]:flex [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-[5px] [&>button]:px-3 [&>button]:text-[15px]">
            {ctx.inThread ? null : <button type="button" onClick={() => { setSheetOpen(false); ctx.openThread(message.seq); }}><MessageSquareText size={18} /> Reply in thread</button>}
            <button type="button" onClick={() => { setSheetOpen(false); void navigator.clipboard?.writeText(message.body); toast.success("Copied"); }}><Link2 size={18} /> Copy text</button>
            {own && !message.card ? <button type="button" onClick={() => { setSheetOpen(false); startEdit(); }}><Pencil size={18} /> Edit</button> : null}
            {canPin ? <button type="button" onClick={() => { setSheetOpen(false); void togglePin(); }}><Pin size={18} /> {message.pinned ? "Unpin" : "Pin"}</button> : null}
            {canDelete ? <button type="button" className="text-destructive" onClick={() => { setSheetOpen(false); setConfirmDelete(true); }}><Trash2 size={18} /> Delete</button> : null}
            {own ? null : <button type="button" onClick={() => { setSheetOpen(false); setReportOpen(true); }}><Flag size={18} /> Report</button>}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete message?"
        description="This can't be undone."
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
