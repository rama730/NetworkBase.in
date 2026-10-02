"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign, Bold, Code, FileCode, Italic, Link2, List, ListOrdered, Paperclip, Plus, Quote, SendHorizontal, Slash, Smile, SquareCheck, Strikethrough, Type, X,
} from "lucide-react";
import { toast } from "sonner";

import { createTaskFromMessage, sendMessage } from "@/app/actions/chat/messages";
import { readChatUi, readDraft, writeChatUi, writeDraft } from "@/components/messages/chat-ui-store";
import { MentionDropdown } from "@/components/messages/parts/MentionDropdown";
import { uploadChatFile } from "@/components/messages/upload";
import { useUpdatePages } from "@/components/messages/useConversation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { insertMarkdown, upsertMessage, type MarkdownKind } from "@/lib/messaging/timeline";
import { encodeMentions } from "@/lib/messaging/tokens";
import type { ChatMessageView, ChatPerson } from "@/lib/messaging/types";
import { ATTACHMENT_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

type Upload = { id: string; name: string; progress: number; assetId: string | null; error: boolean };

type Props = {
  channelId: string;
  placeholder: string;
  people: ChatPerson[];
  /** Thread replies post with a root and no formatting toolbar or slash commands. */
  threadRootSeq?: number | null;
  allowBroadcast: boolean;
  canCreateTask: boolean;
  onTyping?: () => void;
  onEditLast?: () => void;
  onSent?: () => void;
};

const TOOLBAR: Array<{ kind: MarkdownKind; label: string; icon: typeof Bold }> = [
  { kind: "bold", label: "Bold", icon: Bold },
  { kind: "italic", label: "Italic", icon: Italic },
  { kind: "strike", label: "Strikethrough", icon: Strikethrough },
  { kind: "link", label: "Link", icon: Link2 },
  { kind: "ordered", label: "Numbered list", icon: ListOrdered },
  { kind: "bullet", label: "Bulleted list", icon: List },
  { kind: "quote", label: "Quote", icon: Quote },
  { kind: "code", label: "Code", icon: Code },
  { kind: "codeblock", label: "Code block", icon: FileCode },
];
const EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];
const MAX_HEIGHT = 160;

function personLabel(person: ChatPerson) {
  return person.full_name || person.username || "";
}

/** Plain textarea composer (D9): markdown via Aa, @mentions, /task, uploads, per-conversation drafts. */
export function Composer({ channelId, placeholder, people, threadRootSeq = null, allowBroadcast, canCreateTask, onTyping, onEditLast, onSent }: Props) {
  const { user, profile } = useAuth();
  const update = useUpdatePages(channelId);
  const draftKey = threadRootSeq ? `${channelId}:${threadRootSeq}` : channelId;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [formatting, setFormatting] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setValue(readDraft(draftKey));
    setUploads([]);
  }, [draftKey]);
  useEffect(() => setFormatting(!threadRootSeq && Boolean(readChatUi().formatting)), [threadRootSeq]);
  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const mentionable = useMemo(() => {
    const list = people.filter((p) => p.id !== user?.id).map((p) => ({ id: p.id, username: p.username, fullName: p.full_name, avatarUrl: p.avatar_url }));
    if (allowBroadcast) list.unshift({ id: "here", username: "here", fullName: "here", avatarUrl: null }, { id: "channel", username: "channel", fullName: "channel", avatarUrl: null });
    return list;
  }, [allowBroadcast, people, user?.id]);

  const change = (next: string, caret: number) => {
    setValue(next);
    writeDraft(draftKey, next);
    onTyping?.();
    const before = next.slice(0, caret);
    const match = before.match(/(^|\s)@([^\s@]{0,30})$/);
    setMention(match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null);
  };

  const applyFormat = (kind: MarkdownKind) => {
    const node = textarea.current;
    if (!node) return;
    const result = insertMarkdown(value, node.selectionStart, node.selectionEnd, kind);
    change(result.value, result.end);
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(result.start, result.end);
    });
  };

  const insertText = (text: string) => {
    const node = textarea.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    change(next, start + text.length);
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const pickMention = (participant: { id: string; username: string | null; fullName: string | null }) => {
    if (!mention) return;
    const label = participant.id === "here" || participant.id === "channel" ? participant.id : participant.fullName || participant.username || "";
    const caret = mention.start + 1 + mention.query.length;
    const next = `${value.slice(0, mention.start)}@${label} ${value.slice(caret)}`;
    setMention(null);
    change(next, mention.start + label.length + 2);
    requestAnimationFrame(() => textarea.current?.focus());
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const room = CHAT_MAX_ATTACHMENTS - uploads.length;
    for (const file of Array.from(files).slice(0, room)) {
      if (file.size > ATTACHMENT_UPLOAD_MAX_FILE_BYTES) {
        toast.error(`${file.name} is too large.`);
        continue;
      }
      const id = crypto.randomUUID();
      setUploads((list) => [...list, { id, name: file.name, progress: 0, assetId: null, error: false }]);
      uploadChatFile(channelId, file, (progress) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, progress } : u))))
        .then((assetId) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, assetId, progress: 100 } : u))))
        .catch(() => setUploads((list) => list.map((u) => (u.id === id ? { ...u, error: true } : u))));
    }
  };

  const submit = async () => {
    const text = value.trim();
    const ready = uploads.filter((u) => u.assetId).map((u) => u.assetId!);
    if (sending || (!text && !ready.length)) return;
    if (uploads.some((u) => !u.assetId && !u.error)) {
      toast.message("Wait for uploads to finish.");
      return;
    }
    if (!threadRootSeq && canCreateTask && /^\/task\s+\S/.test(text)) {
      setSending(true);
      const result = await createTaskFromMessage({ channelId, title: text.replace(/^\/task\s+/, "").slice(0, 200) });
      setSending(false);
      if (!result.success) return void toast.error(chatErrorMessage(result.error));
      update((pages) => upsertMessage(pages, result.message));
      setValue("");
      writeDraft(draftKey, "");
      onSent?.();
      return;
    }
    const body = encodeMentions(text, people.map((p) => ({ id: p.id, name: personLabel(p) })));
    if (body.length > CHAT_MAX_BODY) return void toast.error(chatErrorMessage("chat_body_too_long"));
    const clientId = crypto.randomUUID();
    const optimistic: ChatMessageView = {
      channel_id: channelId, seq: -Date.now(), author_id: user?.id ?? null,
      author: user ? { id: user.id, username: profile?.username ?? null, full_name: profile?.fullName ?? null, avatar_url: profile?.avatarUrl ?? null } : null,
      kind: "user", body, thread_root_seq: threadRootSeq, reply_count: 0, last_reply_seq: null, last_reply_at: null,
      edited_at: null, deleted_at: null, created_at: new Date().toISOString(), client_message_id: clientId,
      attachments: [], reactions: [], card: null, pinned: false,
    };
    setValue("");
    writeDraft(draftKey, "");
    setUploads([]);
    if (!threadRootSeq) update((pages) => upsertMessage(pages, optimistic));
    setSending(true);
    const result = await sendMessage({ channelId, body, clientId, threadRootSeq, assetIds: ready });
    setSending(false);
    if (!result.success) {
      if (!threadRootSeq) update((pages) => pages.map((page) => page.filter((m) => m.client_message_id !== clientId)));
      setValue(text);
      writeDraft(draftKey, text);
      toast.error(chatErrorMessage(result.error));
      return;
    }
    update((pages) => upsertMessage(pages, result.message));
    onSent?.();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) return; // MentionDropdown handles these
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "ArrowUp" && !value && onEditLast) {
      event.preventDefault();
      onEditLast();
    }
  };

  const openAttach = () => {
    if (window.matchMedia("(pointer: coarse)").matches) setSheetOpen(true);
    else fileInput.current?.click();
  };
  const canSend = Boolean(value.trim() || uploads.some((u) => u.assetId));

  return (
    <div className="nb-message-composer border-t border-border bg-card px-3 pt-2 sm:px-4">
      {uploads.length ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {uploads.map((u) => (
            <li key={u.id} className={`flex max-w-[220px] items-center gap-2 rounded-[5px] border px-2 py-1 text-[13px] ${u.error ? "border-destructive text-destructive" : "border-border"}`}>
              <Paperclip size={14} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="font-mono text-[11px]">{u.error ? "Failed" : u.assetId ? "Ready" : `${u.progress}%`}</span>
              <button type="button" aria-label={`Remove ${u.name}`} onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))} className="grid size-6 place-items-center pointer-coarse:size-11"><X size={12} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative rounded-lg border border-input bg-card focus-within:border-ring">
        {formatting ? (
          <div className="flex flex-wrap gap-0.5 border-b border-border px-1 py-1" role="toolbar" aria-label="Formatting">
            {TOOLBAR.map(({ kind, label, icon: Icon }) => (
              <button key={kind} type="button" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat(kind)} className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11">
                <Icon size={16} />
              </button>
            ))}
          </div>
        ) : null}
        {mention ? (
          <MentionDropdown query={mention.query} participants={mentionable} onSelect={pickMention} onClose={() => setMention(null)} />
        ) : null}
        <textarea
          ref={textarea}
          value={value}
          rows={2}
          maxLength={CHAT_MAX_BODY}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => change(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(e) => addFiles(e.clipboardData.files)}
          className="block max-h-[160px] w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none pointer-coarse:text-[17px]"
        />
        <div className="flex items-center gap-0.5 px-1 pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted pointer-coarse:size-11" aria-label="Add">
              <Plus size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuItem onSelect={openAttach}><Paperclip size={14} /> Upload file</DropdownMenuItem>
              {canCreateTask && !threadRootSeq ? <DropdownMenuItem onSelect={() => change("/task ", 6)}><SquareCheck size={14} /> Create task</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {threadRootSeq ? null : (
            <button type="button" aria-label="Formatting" aria-pressed={formatting} onClick={() => { setFormatting(!formatting); writeChatUi({ formatting: !formatting }); }} className={`grid size-8 place-items-center rounded-[5px] hover:bg-muted pointer-coarse:size-11 ${formatting ? "text-foreground" : "text-muted-foreground"}`}>
              <Type size={18} />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted pointer-coarse:size-11" aria-label="Emoji">
              <Smile size={18} />
            </DropdownMenuTrigger>
            {/* ponytail: quick bar + the OS emoji keyboard (L-12). upgrade: a full picker if people ask. */}
            <DropdownMenuContent side="top" align="start" className="flex gap-1 p-1">
              {EMOJI.map((emoji) => <DropdownMenuItem key={emoji} onSelect={() => insertText(emoji)} className="size-9 justify-center text-lg">{emoji}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" aria-label="Mention someone" onClick={() => insertText(value && !/\s$/.test(value) ? " @" : "@")} className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted pointer-coarse:size-11">
            <AtSign size={18} />
          </button>
          {canCreateTask && !threadRootSeq ? (
            <button type="button" aria-label="Slash commands" title="/task Title creates a task" onClick={() => change("/task ", 6)} className="grid size-8 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted pointer-coarse:size-11">
              <Slash size={18} />
            </button>
          ) : null}
          <button type="button" onClick={() => void submit()} disabled={!canSend || sending} aria-label="Send" className="ml-auto inline-flex h-8 items-center gap-1 rounded-[5px] bg-[var(--chat-accent)] px-3 text-[13px] font-medium text-white disabled:opacity-40 pointer-coarse:h-11">
            <SendHorizontal size={16} /> <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={mediaInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent presentation="bottom-sheet" showCloseButton={false}>
          <DialogTitle className="px-4 pb-1 pt-4 text-[17px]">Attach</DialogTitle>
          <div className="px-2 pb-3 [&>button]:flex [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:rounded-[5px] [&>button]:px-3 [&>button]:text-[15px]">
            <button type="button" onClick={() => { setSheetOpen(false); cameraInput.current?.click(); }}>Camera</button>
            <button type="button" onClick={() => { setSheetOpen(false); mediaInput.current?.click(); }}>Photos and videos</button>
            <button type="button" onClick={() => { setSheetOpen(false); fileInput.current?.click(); }}>Files</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
