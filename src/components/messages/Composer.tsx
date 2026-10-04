"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { ALargeSmall, BarChart3, ChevronDown, Clock, Code2, FileText, Image as ImageIcon, Paperclip, Plus, SendHorizontal, Slash, Smile, SquareCheck, X } from "lucide-react";
import { toast } from "sonner";

import { scheduleMessage } from "@/app/actions/chat/later";
import { createTaskFromMessage, sendMessage } from "@/app/actions/chat/messages";
import { applyLink, chatDraftToHtmlish, chatMarkdown, FormatToolbar, isBlank, useChatEditor } from "@/components/messages/ChatEditor";
import { readChatUi, readDraft, writeChatUi, writeDraft } from "@/components/messages/chat-ui-store";
import { MentionDropdown } from "@/components/messages/parts/MentionDropdown";
import { ReactionQuickBar } from "@/components/messages/parts/ReactionQuickBar";
import { uploadChatFile } from "@/components/messages/upload";
import { useUpdatePages } from "@/components/messages/useConversation";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { upsertMessage } from "@/lib/messaging/timeline";
import { typingLabel } from "@/lib/messaging/typing";
import { PresenceGlyph } from "@/components/presence/PresenceGlyph";
import { usePersonPresence } from "@/components/presence/usePresence";
import { isAway } from "@/lib/presence/model";
import { usePresenceUi } from "@/components/presence/presence-ui-store";
import { encodeMentions } from "@/lib/messaging/tokens";
import type { ChatMessageView, ChatPerson } from "@/lib/messaging/types";
import { ATTACHMENT_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

type Upload = {
  id: string;
  name: string;
  progress: number;
  assetId: string | null;
  error: boolean;
  previewUrl?: string | null;
  isImage?: boolean;
};

const SLASH_COMMANDS = [
  { command: "/task", group: "Create", description: "Create a project task", example: "/task Finish API documentation" },
  { command: "/poll", group: "Create", description: "Ask a question with options", example: "/poll Best time to meet? | 10am | 2pm | 4pm" },
  { command: "/code", group: "Create", description: "Insert a code block", example: "/code typescript" },
  { command: "/status", group: "You", description: "Set your status", example: "/status" },
];

type Props = {
  channelId: string;
  placeholder: string;
  people: ChatPerson[];
  /** Thread replies post with a root and no formatting toolbar or slash commands. */
  threadRootSeq?: number | null;
  allowBroadcast: boolean;
  canCreateTask: boolean;
  onOpenCanvas?: () => void;
  /** true while keys are pressed (throttled by the caller), false when the draft empties, is sent or closes. */
  onTyping?: (active: boolean) => void;
  /** Teammates typing here, shown in a fixed row under the box. */
  typingNames?: string[];
  onEditLast?: () => void;
  onSent?: () => void;
  /** Thread replies: offer "Also send to #channel" with this label. */
  alsoSendTo?: string | null;
};

/** "Send later" times, computed when picked (a menu left open stays right). */
function nextAt(daysAhead: (now: Date) => number) {
  const at = new Date();
  at.setDate(at.getDate() + daysAhead(at));
  at.setHours(9, 0, 0, 0);
  return at;
}
const SCHEDULE_TIMES = [
  { label: "In 1 hour", at: () => new Date(Date.now() + 60 * 60_000) },
  { label: "Tomorrow at 9:00", at: () => nextAt(() => 1) },
  { label: "Monday at 9:00", at: () => nextAt((now) => (8 - now.getDay()) % 7 || 7) },
];

// Clock reads for editor and submit callbacks (never called while rendering).
const clock = () => Date.now();

function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Before sending: "Aisha is on vacation until Oct 14…" for someone you mentioned who is away. */
function AwayMentionNotice({ userId, name }: { userId: string; name: string }) {
  const presence = usePersonPresence(userId);
  const status = presence.status;
  if (!status || !isAway(status)) return null;
  const until = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  return (
    <p role="status" className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--status-warning-soft)] px-3 py-2 text-[13px] leading-snug text-[var(--status-warning)]">
      {status.emoji ? <span aria-hidden="true" className="font-[system-ui] text-[15px] leading-none">{status.emoji}</span> : null}
      <span>
        <strong className="font-semibold">{name}</strong>{status.text ? ` · ${status.text}` : ""}. Notifications paused{until ? ` until ${until}` : ""}; they&apos;ll see this when they&apos;re back.
      </span>
    </p>
  );
}

/** Floats just above the composer (over the timeline's bottom spacer), so nothing moves when someone starts typing. */
function TypingIndicator({ names }: { names: string[] }) {
  // Keep the last typers while fading out, so the exit animates instead of vanishing.
  const [lastNames, setLastNames] = useState(names);
  if (names.length && names.join("\n") !== lastNames.join("\n")) setLastNames(names);
  const visible = names.length > 0;
  const label = typingLabel(visible ? names : lastNames);
  // Never typed yet: render nothing, so no fade band covers the composer's top border.
  if (!label) return null;
  return (
    <div
      data-visible={visible}
      aria-hidden={!visible}
      className="pointer-events-none absolute inset-x-3 bottom-[calc(100%+1px)] flex h-5 items-center gap-1.5 truncate bg-gradient-to-t from-card px-1 text-[12px] text-muted-foreground transition-[opacity,transform] duration-200 ease-out data-[visible=false]:translate-y-1 data-[visible=false]:opacity-0 motion-reduce:transition-none sm:inset-x-4"
      aria-live="polite"
    >
      <span className="nb-typing-dots" aria-hidden="true"><span /><span /><span /></span>
      <span className="truncate">
        {label.names.map((name, index) => (
          <span key={index}>{index ? " and " : ""}<strong className="font-semibold text-foreground">{name}</strong></span>
        ))}
        {label.names.length ? ` ${label.text}` : label.text}
      </span>
    </div>
  );
}

/** Bottom-bar button look: active shows a filled background and an underline bar, like Slack. */
function barButton(active: boolean) {
  return `relative grid size-8 place-items-center rounded-[5px] hover:bg-muted pointer-coarse:size-11 data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:after:absolute data-[state=open]:after:inset-x-1.5 data-[state=open]:after:bottom-0.5 data-[state=open]:after:h-0.5 data-[state=open]:after:rounded-full data-[state=open]:after:bg-foreground ${
    active ? "bg-muted text-foreground after:absolute after:inset-x-1.5 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-foreground" : "text-muted-foreground"
  }`;
}

function personLabel(person: ChatPerson) {
  return person.full_name || person.username || "";
}

/** Slack-style composer (WYSIWYG, markdown out): @mentions, /task, uploads, per-conversation drafts. */
export function Composer({ channelId, placeholder, people, threadRootSeq = null, allowBroadcast, canCreateTask, onOpenCanvas, onTyping, typingNames = [], onEditLast, onSent, alsoSendTo = null }: Props) {
  const { user, profile } = useAuth();
  const update = useUpdatePages(channelId);
  const draftKey = threadRootSeq ? `${channelId}:${threadRootSeq}` : channelId;
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [plain, setPlain] = useState("");
  const [blank, setBlank] = useState(true);
  const [slashForced, setSlashForced] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const menuKey = useRef<(key: "up" | "down" | "tab") => boolean>(() => false);
  const [formatting, setFormatting] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [mention, setMention] = useState<{ query: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<{ text: string; url: string } | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [restored, setRestored] = useState(false);
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  const [customSchedule, setCustomSchedule] = useState<string | null>(null);
  const submitRef = useRef<() => void>(() => undefined);
  const typedAt = useRef(0);
  const onTypingRef = useRef(onTyping);
  useEffect(() => {
    onTypingRef.current = onTyping;
  });
  // Closing the composer (tab switch, channel change) ends our typing.
  useEffect(() => () => onTypingRef.current?.(false), []);
  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);
  const slashOpenRef = useRef(false);
  const menuOpen = useRef(false);

  const uploadsRef = useRef<Upload[]>([]);

  const labelOf = (raw: string) => {
    if (raw.startsWith("<#")) return "#channel";
    const person = people.find((p) => raw === `<@${p.id}>`);
    return `@${person ? personLabel(person) || "someone" : "someone"}`;
  };

  const onEditorUpdate = (editor: Editor) => {
    const next = chatMarkdown(editor);
    setValue(next);
    setPlain(editor.getText());
    setBlank(isBlank(editor));

    // Debounced draft auto-saving (300ms) to prevent storage thrashing (Rule: 1M users optimization)
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      writeDraft(draftKey, next);
    }, 300);

    // Only real key presses count: toolbar toggles, emoji, slash and mention picks don't.
    if (!editor.getText().trim()) onTyping?.(false);
    else if (clock() - typedAt.current < 150) onTyping?.(true);
    const { $head } = editor.state.selection;
    const before = $head.parent.textBetween(0, $head.parentOffset, undefined, "\ufffc");
    const match = before.match(/(^|\s)@([^\s@]{0,30})$/);
    setMention(match ? { query: match[2]! } : null);
  };

  const editor = useChatEditor({
    content: "",
    placeholder,
    onUpdate: onEditorUpdate,
    handlers: {
      onEnter: () => {
        if (menuOpen.current) return true;
        submitRef.current();
        return true;
      },
      onMenuKey: (key) => menuKey.current(key),
      onEscape: () => {
        if (!slashOpenRef.current) return false;
        setSlashForced(false);
        if (editor?.getText() === "/") editor.commands.clearContent(true);
        return true;
      },
      onArrowUpEmpty: () => {
        if (!onEditLast) return false;
        onEditLast();
        return true;
      },
      onLink: () => openLink(),
    },
  });

  const load = (body: string) => {
    if (!editor) return;
    editor.commands.setContent(chatDraftToHtmlish(body, labelOf), { emitUpdate: false });
    setValue(body);
    setPlain(editor.getText());
    setBlank(isBlank(editor));
  };

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  useEffect(() => {
    const draft = readDraft(draftKey);
    load(draft);
    setRestored(Boolean(draft.trim()));
    transfers.current.forEach((controller) => controller.abort());
    transfers.current.clear();
    uploadsRef.current.forEach((u) => {
      if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
    });
    setUploads([]);
  }, [draftKey, editor]);

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((u) => {
        if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      });
    };
  }, []);
  useEffect(() => setFormatting(!threadRootSeq && Boolean(readChatUi().formatting)), [threadRootSeq]);

  const mentionable = useMemo(() => {
    const list = people.filter((p) => p.id !== user?.id).map((p) => ({ id: p.id, username: p.username, fullName: p.full_name, avatarUrl: p.avatar_url }));
    if (allowBroadcast) list.unshift({ id: "here", username: "here", fullName: "here", avatarUrl: null }, { id: "channel", username: "channel", fullName: "channel", avatarUrl: null });
    return list;
  }, [allowBroadcast, people, user?.id]);

  const commands = SLASH_COMMANDS.filter((cmd) => cmd.command !== "/task" || (canCreateTask && !threadRootSeq));
  const typedSlash = plain.startsWith("/") && !/\s/.test(plain) ? plain.toLowerCase() : null;
  // "/po" finds /poll; "/sta" or "/you" find /status by its description or group too.
  const matchingSlash = typedSlash !== null
    ? commands.filter((cmd) => cmd.command.startsWith(typedSlash) || `${cmd.group} ${cmd.description}`.toLowerCase().includes(typedSlash.slice(1)))
    : slashForced ? commands : [];
  const activeSlash = Math.min(slashIndex, Math.max(0, matchingSlash.length - 1));

  const pickSlash = (command: string) => {
    if (command === "/status") {
      setSlashForced(false);
      if (typedSlash !== null) clear();
      usePresenceUi.getState().setPickerOpen(true);
      return;
    }
    const rest = typedSlash !== null ? "" : plain.trim();
    setSlashForced(false);
    setSlashIndex(0);
    setText(`${command} ${rest}`.trimEnd() + " ");
  };

  const insertText = (text: string) => {
    editor?.chain().focus().insertContent(text).run();
  };

  /** Replace the message with plain text (keeps a trailing space, which markdown parsing would drop). */
  const setText = (text: string) => {
    if (!editor) return;
    editor.chain().clearContent().insertContent({ type: "text", text }).focus("end").run();
  };

  const pickMention = (participant: { id: string; username: string | null; fullName: string | null }) => {
    if (!mention || !editor) return;
    const caret = editor.state.selection.from;
    const from = caret - mention.query.length - 1;
    const broadcast = participant.id === "here" || participant.id === "channel";
    setMention(null);
    editor.chain().focus().deleteRange({ from, to: caret })
      .insertContent(broadcast
        ? `@${participant.id} `
        : [{ type: "chatToken", attrs: { raw: `<@${participant.id}>`, label: `@${participant.fullName || participant.username || "someone"}` } }, { type: "text", text: " " }])
      .run();
  };

  function openLink() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setLink({ text: editor.state.doc.textBetween(from, to, " "), url: String(editor.getAttributes("link").href ?? "") });
  }

  // In-flight transfers, so removing a tile (or leaving) really cancels it (UPL-03).
  const transfers = useRef(new Map<string, AbortController>());
  useEffect(() => () => transfers.current.forEach((controller) => controller.abort()), []);

  const removeUpload = (id: string) => {
    transfers.current.get(id)?.abort();
    transfers.current.delete(id);
    setUploads((list) => {
      const item = list.find((x) => x.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return list.filter((x) => x.id !== id);
    });
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
      const isImage = file.type.startsWith("image/");
      const previewUrl = isImage ? URL.createObjectURL(file) : null;
      setUploads((list) => [...list, { id, name: file.name, progress: 0, assetId: null, error: false, previewUrl, isImage }]);
      const controller = new AbortController();
      transfers.current.set(id, controller);
      // Same percent → same list, so React skips the re-render (UPL-02).
      const onProgress = (progress: number) => setUploads((list) => (list.some((u) => u.id === id && u.progress !== progress)
        ? list.map((u) => (u.id === id ? { ...u, progress } : u))
        : list));
      uploadChatFile(channelId, file, onProgress, controller.signal)
        .then((assetId) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, assetId, progress: 100 } : u))))
        .catch(() => {
          if (!controller.signal.aborted) setUploads((list) => list.map((u) => (u.id === id ? { ...u, error: true } : u)));
        })
        .finally(() => transfers.current.delete(id));
    }
  };

  const clear = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    onTyping?.(false);
    editor?.commands.clearContent(false);
    setValue("");
    setPlain("");
    setBlank(true);
    setSlashForced(false);
    setRestored(false);
    writeDraft(draftKey, "");
  };

  /** Send later: the text only (uploads send now), queued for the chat-due job. */
  const schedule = async (at: Date) => {
    const text = plain.trim() ? value.trim() : "";
    if (!text || sending) return;
    if (uploads.length) return void toast.message("Scheduled messages can't carry attachments yet. Send files now, or remove them.");
    const body = encodeMentions(text, people.map((p) => ({ id: p.id, name: personLabel(p) })));
    if (body.length > CHAT_MAX_BODY) return void toast.error(chatErrorMessage("chat_body_too_long"));
    setSending(true);
    const result = await scheduleMessage({ channelId, body, sendAt: at.toISOString(), threadRootSeq });
    setSending(false);
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    clear();
    toast.success(`Scheduled for ${at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`, {
      action: { label: "View", onClick: () => window.location.assign("/messages/drafts") },
    });
  };

  const submit = async () => {
    let text = plain.trim() ? value.trim() : "";
    const ready = uploads.filter((u) => u.assetId).map((u) => u.assetId!);
    if (sending || (!plain.trim() && !ready.length)) return;
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
      clear();
      onSent?.();
      return;
    }
    if (/^\/status(\s|$)/i.test(text)) {
      clear();
      usePresenceUi.getState().setPickerOpen(true);
      return;
    }
    const draft = text;
    if (/^\/poll(\s+|$)/i.test(text)) {
      const raw = text.replace(/^\/poll\s*/i, "").trim();
      if (!raw) {
        toast.message("Usage: /poll Question | Option 1 | Option 2");
        return;
      }
      const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
      const emojiList = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
      if (parts.length > 1) {
        text = `📊 **Poll: ${parts[0]}**\n\n` + parts.slice(1).map((opt, i) => `${emojiList[i] ?? "🔹"} ${opt}`).join("\n") + "\n\n*React with the numbers above to vote!*";
      } else {
        text = `📊 **Poll: ${raw}**\n\n👍 Yes\n👎 No\n🤷 Maybe\n\n*React below to vote!*`;
      }
    } else if (/^\/code(\s+|$)/i.test(text)) {
      const lang = text.replace(/^\/code\s*/i, "").trim() || "typescript";
      text = "```" + lang + "\n// Write your code here\n```";
    }
    const body = encodeMentions(text, people.map((p) => ({ id: p.id, name: personLabel(p) })));
    if (body.length > CHAT_MAX_BODY) return void toast.error(chatErrorMessage("chat_body_too_long"));
    const clientId = crypto.randomUUID();
    const optimistic: ChatMessageView = {
      channel_id: channelId, seq: -clock(), author_id: user?.id ?? null,
      author: user ? { id: user.id, username: profile?.username ?? null, full_name: profile?.fullName ?? null, avatar_url: profile?.avatarUrl ?? null } : null,
      kind: "user", body, thread_root_seq: threadRootSeq, reply_count: 0, last_reply_seq: null, last_reply_at: null,
      edited_at: null, deleted_at: null, created_at: new Date().toISOString(), client_message_id: clientId,
      attachments: [], reactions: [], card: null, pinned: false,
    };
    clear();
    setUploads([]);
    if (!threadRootSeq) update((pages) => upsertMessage(pages, optimistic));
    setSending(true);
    const result = await sendMessage({ channelId, body, clientId, threadRootSeq, assetIds: ready, alsoToChannel: Boolean(threadRootSeq && alsoToChannel) });
    setSending(false);
    if (!result.success) {
      if (!threadRootSeq) update((pages) => pages.map((page) => page.filter((m) => m.client_message_id !== clientId)));
      load(draft);
      writeDraft(draftKey, draft);
      toast.error(chatErrorMessage(result.error));
      return;
    }
    update((pages) => upsertMessage(pages, result.message));
    onSent?.();
  };
  useEffect(() => {
    submitRef.current = () => {
      if (matchingSlash.length) pickSlash(matchingSlash[activeSlash]!.command);
      else void submit();
    };
    menuOpen.current = Boolean(mention);
    slashOpenRef.current = matchingSlash.length > 0;
    menuKey.current = (key) => {
      if (!matchingSlash.length) return false;
      if (key === "tab") pickSlash(matchingSlash[activeSlash]!.command);
      else setSlashIndex((activeSlash + (key === "down" ? 1 : matchingSlash.length - 1)) % matchingSlash.length);
      return true;
    };
  });

  const openAttach = () => {
    if (window.matchMedia("(pointer: coarse)").matches) setSheetOpen(true);
    else fileInput.current?.click();
  };
  const canSend = Boolean(plain.trim() || uploads.some((u) => u.assetId));
  const mentionedIds = useMemo(() => Array.from(new Set(Array.from(value.matchAll(/<@([0-9a-f-]{36})>/g), (match) => match[1]!))).filter((id) => id !== user?.id).slice(0, 5), [user?.id, value]);

  return (
    <div className="nb-message-composer relative border-t border-border bg-card px-3 pt-2 sm:px-4">
      <TypingIndicator names={typingNames} />
      {uploads.length ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {uploads.map((u) => (
            u.isImage && u.previewUrl ? (
              <li key={u.id} className="relative flex size-20 flex-none overflow-hidden rounded-md border border-border bg-muted">
                <img src={u.previewUrl} alt={u.name} className="size-full object-cover" />
                {u.progress < 100 && !u.error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
                    <span className="font-mono text-[11px] font-semibold">{u.progress}%</span>
                    <div className="mt-1 h-1 w-12 overflow-hidden rounded-full bg-white/30">
                      <div className="h-full bg-primary transition-all duration-150" style={{ width: `${u.progress}%` }} />
                    </div>
                  </div>
                ) : null}
                {u.error ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-destructive/80 text-[11px] font-semibold text-destructive-foreground">
                    Failed
                  </div>
                ) : null}
                <button type="button" aria-label={`Remove ${u.name}`} onClick={() => removeUpload(u.id)} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white hover:bg-black">
                  <X size={12} />
                </button>
              </li>
            ) : (
              <li key={u.id} className={`flex max-w-[220px] items-center gap-2 rounded-[5px] border px-2 py-1 text-[13px] ${u.error ? "border-destructive text-destructive" : "border-border"}`}>
                <Paperclip size={14} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                <span className="font-mono text-[11px]">{u.error ? "Failed" : u.assetId ? "Ready" : `${u.progress}%`}</span>
                <button type="button" aria-label={`Remove ${u.name}`} onClick={() => removeUpload(u.id)} className="grid size-6 place-items-center pointer-coarse:size-11"><X size={12} /></button>
              </li>
            )
          ))}
        </ul>
      ) : null}
      {mentionedIds.map((id) => <AwayMentionNotice key={id} userId={id} name={labelOf(`<@${id}>`).slice(1)} />)}
      {restored && !blank ? (
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="rounded-[3px] bg-muted px-1.5 py-0.5 font-medium text-foreground">Draft</span>
          <span>Restored from earlier.</span>
          <button type="button" onClick={clear} className="font-medium text-primary hover:underline">Discard</button>
        </div>
      ) : null}
      <div className="relative rounded-lg border border-input bg-card focus-within:border-ring">
        {matchingSlash.length > 0 ? (
          <div className="absolute bottom-full left-0 z-30 mb-1 w-80 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md" role="listbox" aria-label="Slash commands">
            <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
              <span>Slash commands</span>
              <span className="font-normal normal-case">↑↓ to move · ↵ to pick · esc</span>
            </div>
            {matchingSlash.map((cmd, index) => (
              <div key={cmd.command}>
              {index === 0 || matchingSlash[index - 1]!.group !== cmd.group ? <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-muted-foreground">{cmd.group}</p> : null}
              <button
                key={cmd.command}
                type="button"
                role="option"
                aria-selected={index === activeSlash}
                onMouseEnter={() => setSlashIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSlash(cmd.command);
                }}
                className={`flex w-full flex-col items-start rounded-[4px] px-2 py-1.5 text-left text-[13px] ${index === activeSlash ? "bg-accent text-accent-foreground" : ""}`}
              >
                <span><span className="font-mono font-medium text-primary">{cmd.command}</span> <span className="text-muted-foreground">{cmd.description}</span></span>
                <span className="font-mono text-[11px] text-muted-foreground">{cmd.example}</span>
              </button>
              </div>
            ))}
          </div>
        ) : null}
        {formatting && editor ? <FormatToolbar editor={editor} onLink={openLink} /> : null}
        {mention ? (
          <MentionDropdown query={mention.query} participants={mentionable} onSelect={pickMention} onClose={() => setMention(null)} />
        ) : null}
        <div
          className="app-scroll app-scroll-y relative max-h-[160px] px-3 py-2"
          onKeyDownCapture={(e) => {
            if (!e.metaKey && !e.ctrlKey && (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Process" || e.key === "Unidentified")) typedAt.current = Date.now();
          }}
          onClick={() => editor?.commands.focus()}
          onPasteCapture={(e) => {
            if (!e.clipboardData.files.length) return;
            e.preventDefault();
            e.stopPropagation();
            addFiles(e.clipboardData.files);
          }}
        >
          {/* Placeholder by text, not CSS decoration: shows whenever nothing is typed, in both themes. */}
          {blank ? <span aria-hidden="true" className="pointer-events-none absolute left-3 top-2 truncate text-[15px] text-muted-foreground pointer-coarse:text-[17px]">{placeholder}</span> : null}
          <EditorContent editor={editor} />
        </div>
        <div className="flex items-center gap-0.5 px-1 pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger className={barButton(false)} aria-label="Add attachment or action" title="Add attachment or action">
              <Plus size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56 p-1">
              <DropdownMenuItem onSelect={openAttach} className="gap-2.5 cursor-pointer">
                <Paperclip size={14} className="text-muted-foreground" />
                <span>Upload file</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => mediaInput.current?.click()} className="gap-2.5 cursor-pointer">
                <ImageIcon size={14} className="text-muted-foreground" />
                <span>Photos and videos</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  editor?.chain().focus().insertContent("```\n\n```").run();
                }}
                className="gap-2.5 cursor-pointer"
              >
                <Code2 size={14} className="text-muted-foreground" />
                <span>Code snippet</span>
              </DropdownMenuItem>
              {onOpenCanvas && !threadRootSeq ? (
                <DropdownMenuItem onSelect={onOpenCanvas} className="gap-2.5 cursor-pointer">
                  <FileText size={14} className="text-muted-foreground" />
                  <span>Canvas</span>
                </DropdownMenuItem>
              ) : null}
              {canCreateTask && !threadRootSeq ? (
                <DropdownMenuItem onSelect={() => setText("/task ")} className="gap-2.5 cursor-pointer">
                  <SquareCheck size={14} className="text-muted-foreground" />
                  <span>Create task</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setText("/poll ")} className="gap-2.5 cursor-pointer">
                <BarChart3 size={14} className="text-muted-foreground" />
                <span>Poll</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {threadRootSeq ? null : (
            <button type="button" aria-label={formatting ? "Hide formatting" : "Show formatting"} title={formatting ? "Hide formatting" : "Show formatting"} aria-pressed={formatting} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFormatting(!formatting); writeChatUi({ formatting: !formatting }); }} className={barButton(formatting)}>
              <ALargeSmall size={18} />
            </button>
          )}
          <button
            type="button"
            data-reaction-trigger
            aria-label="Emoji"
            title="Emoji (⌃⌘Space for more)"
            aria-expanded={Boolean(emojiAnchor)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget)}
            className={barButton(Boolean(emojiAnchor))}
          >
            <Smile size={18} />
          </button>
          <button type="button" aria-label="Mention someone" title="Mention someone" aria-pressed={Boolean(mention)} onMouseDown={(e) => e.preventDefault()} onClick={() => insertText(plain && !/\s$/.test(plain) ? " @" : "@")} className={barButton(Boolean(mention))}>
            <PresenceGlyph kind="at" className="size-[19px]" />
          </button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            aria-label="Slash commands"
            title="Slash commands"
            aria-pressed={matchingSlash.length > 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (matchingSlash.length) {
                setSlashForced(false);
                if (plain === "/") editor?.commands.clearContent(true);
                return;
              }
              setSlashIndex(0);
              if (blank) setText("/");
              else setSlashForced(true);
              editor?.commands.focus();
            }}
            className={barButton(matchingSlash.length > 0)}
          >
            <Slash size={18} />
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend || sending}
            aria-label="Send"
            title={canSend ? "Send (Enter) · Shift+Enter for new line" : "Type a message to send"}
            className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-l-[5px] px-3.5 text-[13px] font-medium transition-colors shadow-2xs pointer-coarse:h-11 ${
              canSend && !sending
                ? "bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
            }`}
          >
            <SendHorizontal size={15} /> <span className="hidden sm:inline">Send</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!plain.trim() || sending}
              aria-label="Schedule message"
              title="Send later"
              className="-ml-px inline-flex h-8 items-center rounded-r-[5px] border-l border-primary-foreground/20 bg-primary px-1.5 text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-50 pointer-coarse:h-11"
            >
              <ChevronDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-56">
              <DropdownMenuLabel className="flex items-center gap-2"><Clock size={14} /> Schedule message</DropdownMenuLabel>
              {SCHEDULE_TIMES.map((option) => (
                <DropdownMenuItem key={option.label} onSelect={() => void schedule(option.at())}>
                  <span className="flex-1">{option.label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCustomSchedule(localInput(new Date(clock() + 2 * 60 * 60_000)))}>Custom time…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {threadRootSeq && alsoSendTo ? (
        <label className="mt-1.5 flex w-fit items-center gap-2 text-[13px] text-muted-foreground">
          <input type="checkbox" checked={alsoToChannel} onChange={(e) => setAlsoToChannel(e.target.checked)} className="accent-[var(--primary)]" />
          Also send to {alsoSendTo}
        </label>
      ) : null}
      <div className="h-2" aria-hidden="true" />
      {emojiAnchor ? (
        <ReactionQuickBar
          anchor={emojiAnchor}
          onReact={(emoji) => { setEmojiAnchor(null); insertText(emoji); }}
          onClose={() => setEmojiAnchor(null)}
        />
      ) : null}
      <Dialog open={customSchedule !== null} onOpenChange={(open) => !open && setCustomSchedule(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Schedule message</DialogTitle>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (customSchedule) void schedule(new Date(customSchedule));
              setCustomSchedule(null);
            }}
          >
            <label className="block text-[13px] font-medium">Send at
              <input type="datetime-local" required value={customSchedule ?? ""} onChange={(e) => setCustomSchedule(e.target.value)} className="mt-1 h-10 w-full rounded-[5px] border border-input bg-background px-3 text-[14px]" />
            </label>
            <DialogFooter>
              <button type="button" onClick={() => setCustomSchedule(null)} className="h-9 rounded-[5px] border border-border px-3 text-[13px]">Cancel</button>
              <button type="submit" className="h-9 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground">Schedule</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={mediaInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <Dialog open={link !== null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Add link</DialogTitle>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (editor && link) applyLink(editor, link.url, link.text);
              setLink(null);
            }}
          >
            <label className="block text-[13px] font-medium">Text
              <input value={link?.text ?? ""} onChange={(e) => setLink((l) => l && { ...l, text: e.target.value })} className="mt-1 h-9 w-full rounded-[5px] border border-input bg-background px-3 text-[14px] outline-none focus:border-ring" />
            </label>
            <label className="block text-[13px] font-medium">Link
              <input autoFocus type="url" inputMode="url" placeholder="https://" value={link?.url ?? ""} onChange={(e) => setLink((l) => l && { ...l, url: e.target.value })} className="mt-1 h-9 w-full rounded-[5px] border border-input bg-background px-3 text-[14px] outline-none focus:border-ring" />
            </label>
            <DialogFooter>
              <button type="button" onClick={() => setLink(null)} className="h-9 rounded-[5px] border border-border px-3 text-[13px]">Cancel</button>
              <button type="submit" className="h-9 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground">Save</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
