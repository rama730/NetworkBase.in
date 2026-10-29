"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EditorContent, type Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { ALargeSmall, BarChart3, Camera, ChevronDown, Code2, FileText, Hash, Image as ImageIcon, Paperclip, Plus, SendHorizontal, Slash, Smile, SquareCheck, X } from "lucide-react";
import { toast, feedbackError, feedbackDate } from "@/lib/feedback";

import { scheduleMessage } from "@/app/actions/chat/later";
import { createTaskFromMessage, sendMessage } from "@/app/actions/chat/messages";
import { applyLink, chatDraftToHtmlish, chatMarkdown, FormatToolbar, isBlank, linkAtCaret, useChatEditor } from "@/components/messages/ChatEditor";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { readChatUi, readDraft, writeChatUi, writeDraft } from "@/components/messages/chat-ui-store";
import { ComposerMenu, type ComposerMenuItem } from "@/components/messages/parts/ComposerMenu";
import { matchMentions, MentionDropdown, openCombobox } from "@/components/messages/parts/MentionDropdown";
import { SuggestList, type Suggestion } from "@/components/messages/parts/SuggestList";
import { ReactionQuickBar } from "@/components/messages/parts/ReactionQuickBar";
import { TimePickerDialog } from "@/components/messages/parts/TimePickerDialog";
import { LOAD_DRAFT_EVENT, failSend, type LoadDraftDetail } from "@/components/messages/failed-sends";
import { DROP_EVENT, DropOverlay, draftKeyOf, useFileDrop, type DropDetail } from "@/components/messages/useFileDrop";
import { isMac, keyLabel } from "@/components/messages/keys";
import { fileProblem, uploadChatFile, uploadReason, uploadRefused } from "@/components/messages/upload";
import { useUpdatePages } from "@/components/messages/useConversation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { formatChatTime } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { readMediaDimensions } from "@/lib/messaging/media-metadata";
import { pollBody } from "@/lib/messaging/poll";
import { emojiForShortcode, searchEmoji } from "@/lib/messaging/emoji";
import { isVisible } from "@/lib/messaging/channel-view";
import { laterTimes } from "@/lib/messaging/reminders";
import { keepLocalPreviews, upsertMessage } from "@/lib/messaging/timeline";
import { queryKeys } from "@/lib/query-keys";
import { typingLabel } from "@/lib/messaging/typing";
import { PresenceGlyph } from "@/components/presence/PresenceGlyph";
import { usePersonPresence } from "@/components/presence/usePresence";
import { isAway } from "@/lib/presence/model";
import { usePresenceUi } from "@/components/presence/presence-ui-store";
import { encodeMentions } from "@/lib/messaging/tokens";
import type { ChatMessageView, ChatPerson } from "@/lib/messaging/types";
import { DEFAULT_ATTACHMENT_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

type Upload = {
  id: string;
  name: string;
  progress: number;
  assetId: string | null;
  error: boolean;
  /** Why it failed, shown on the tile. */
  reason?: string;
  /** The server refused the file itself: Retry can't help, only Remove. */
  refused?: boolean;
  previewUrl?: string | null;
  isImage?: boolean;
  /** Read on the device, so your own photo lands at its real shape (no square-to-shape jump). */
  width?: number | null;
  height?: number | null;
  /** Kept so a failed upload can be retried. */
  file?: File;
};

const SLASH_COMMANDS = [
  { command: "/task", group: "Create", description: "Create a project task", example: "/task Finish API documentation" },
  { command: "/poll", group: "Create", description: "Ask a question with options", example: "/poll Best time to meet? | 10am | 2pm | 4pm" },
  { command: "/code", group: "Create", description: "Code block", example: "/code typescript" },
  { command: "/status", group: "You", description: "Set your status", example: "/status In a meeting" },
];

/** A message that is a command (/task, /poll, /status): never scheduled, it would post as plain text. */
const isCommand = (text: string) => /^\/(task|poll|status|code)(\s|$)/i.test(text);

type SendResult = { success: true; message?: ChatMessageView } | { success: false; error: string };

type Props = {
  channelId: string;
  placeholder: string;
  people: ChatPerson[];
  /** Thread replies post with a root. They get the formatting toolbar and the slash commands, except /task. */
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
  /** Historical thread windows load the latest replies before posting. */
  beforeSend?: () => Promise<void>;
  /** Thread replies: offer "Also send to #channel" with this label. */
  alsoSendTo?: string | null;
  /** New message: no conversation exists yet, so the caller sends the text (no files or scheduling until it does). */
  send?: (body: string) => Promise<SendResult>;
  /**
   * Focus the box once it's ready: true = with a mouse or keyboard only (never on touch, where it
   * would pop the keyboard); "always" = an explicit tap asked for it (Inbox Reply).
   */
  autoFocus?: boolean | "always";
};

// Clock reads for editor and submit callbacks (never called while rendering).
const clock = () => Date.now();
// Drafts typed on this page already: coming back to one isn't "restored from earlier" (a reload is).
const draftsThisPage = new Set<string>();

/** Before sending: who you mentioned is away, on one line ("Away: Aisha · on vacation until Oct 14"). */
function AwayName({ userId, name }: { userId: string; name: string }) {
  const presence = usePersonPresence(userId);
  const status = presence.status;
  if (!status || !isAway(status)) return null;
  const until = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  return (
    <span data-away className="nb-tag">
      {status.emoji ? <span aria-hidden="true" className="font-[system-ui]">{status.emoji}</span> : null}
      <strong className="font-semibold text-foreground">{name}</strong>
      {status.text || until ? <span>{[status.text, until ? `until ${until}` : null].filter(Boolean).join(" ")}</span> : null}
    </span>
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
      className="pointer-events-none absolute inset-x-3 bottom-[calc(100%+1px)] flex h-5 items-center gap-1.5 truncate bg-gradient-to-t from-card px-1 text-[12px] text-muted-foreground transition-[opacity,transform] duration-[180ms] ease-out data-[visible=false]:translate-y-1 data-[visible=false]:opacity-0 motion-reduce:transition-none sm:inset-x-4"
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
  return `nb-icon-button relative size-8 pointer-coarse:size-11 data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:after:absolute data-[state=open]:after:inset-x-1.5 data-[state=open]:after:bottom-0.5 data-[state=open]:after:h-0.5 data-[state=open]:after:rounded-full data-[state=open]:after:bg-foreground ${
    active ? "bg-muted text-foreground after:absolute after:inset-x-1.5 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-foreground" : ""
  }`;
}

function personLabel(person: ChatPerson) {
  return person.full_name || person.username || "";
}

/** The text before the caret in this paragraph (a line break or a token counts as a word gap). */
function textBeforeCaret(editor: Editor) {
  const { $head } = editor.state.selection;
  return $head.parent.textBetween(0, $head.parentOffset, undefined, "\n");
}

/** "@ann" before the caret. */
function mentionQuery(editor: Editor) {
  const match = textBeforeCaret(editor).match(/(^|\s)@([^\s@]{0,30})$/);
  return match ? match[2]! : null;
}

/** The next quarter hour, two hours from now: a tidy starting point for a custom time. */
function customDefault() {
  const at = new Date(clock() + 2 * 60 * 60_000);
  at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15, 0, 0);
  return at;
}

/** Slack-style composer (WYSIWYG, markdown out): @mentions, /task, uploads, per-conversation drafts. */
export function Composer({ channelId, placeholder, people, threadRootSeq = null, allowBroadcast, canCreateTask, onOpenCanvas, onTyping, typingNames = [], onEditLast, onSent, beforeSend, alsoSendTo = null, send, autoFocus = false }: Props) {
  const { user, profile } = useAuth();
  const shell = useChatShell();
  const update = useUpdatePages(channelId);
  const queryClient = useQueryClient();
  const router = useRouter();
  const draftKey = draftKeyOf(channelId, threadRootSeq);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [plain, setPlain] = useState("");
  const [blank, setBlank] = useState(true);
  const [slashForced, setSlashForced] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const menuKey = useRef<(key: "up" | "down" | "tab") => boolean>(() => false);
  // Read once on mount, so the toolbar doesn't pop in after the first paint.
  const [formatting, setFormatting] = useState(() => (typeof window === "undefined" ? false : Boolean(readChatUi().formatting)));
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [mention, setMention] = useState<{ query: string } | null>(null);
  // "#des" suggests channels, ":tad" suggests emoji (round 3 #258, #259).
  const [suggest, setSuggest] = useState<{ kind: "channel" | "emoji"; query: string } | null>(null);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const suggestOpenRef = useRef(false);
  const [sending, setSending] = useState(false);
  // Send pressed while files upload: it goes out by itself when they finish (like Slack).
  const [queued, setQueued] = useState(false);
  const [link, setLink] = useState<{ text: string; url: string; error?: string } | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [restored, setRestored] = useState(false);
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  const [customSchedule, setCustomSchedule] = useState<Date | null>(null);
  const [uploadNews, setUploadNews] = useState("");
  const submitRef = useRef<() => void>(() => undefined);
  const typedAt = useRef(0);
  const onTypingRef = useRef(onTyping);
  useEffect(() => {
    onTypingRef.current = onTyping;
  });
  // Closing the composer (tab switch, channel change) ends our typing.
  useEffect(() => () => onTypingRef.current?.(false), []);
  const slashOpenRef = useRef(false);
  const menuOpen = useRef(false);

  const uploadsRef = useRef<Upload[]>([]);
  const channelNames = useMemo(() => new Map((shell.data?.channels ?? []).filter((c) => c.name).map((c) => [c.id, c.name!])), [shell.data?.channels]);

  const labelOf = (raw: string) => {
    if (raw.startsWith("<#")) return `#${channelNames.get(raw.slice(2, -1)) ?? "channel"}`;
    const person = people.find((p) => raw === `<@${p.id}>`);
    return `@${person ? personLabel(person) || "someone" : "someone"}`;
  };

  const onEditorUpdate = (editor: Editor) => {
    const next = chatMarkdown(editor);
    setValue(next);
    setPlain(editor.getText());
    setBlank(isBlank(editor));
    // Saved on every change (one localStorage write): leaving the conversation never loses the last keys.
    writeDraft(draftKey, next);
    draftsThisPage.add(draftKey);

    const typed = clock() - typedAt.current < 150;
    // Only real key presses count: toolbar toggles, emoji, slash and mention picks don't.
    if (!editor.getText().trim()) onTyping?.(false);
    else if (typed) onTyping?.(true);
    // The slash button opened the list over your text; typing on closes it again.
    if (typed && slashForced) setSlashForced(false);
    const query = mentionQuery(editor);
    setMention(query === null ? null : { query });
    const before = textBeforeCaret(editor);
    // A full ":tada:" just typed becomes the emoji (next frame, outside this update).
    const shortcode = typed ? before.match(/(^|\s):([a-z0-9_+-]{1,30}):$/i) : null;
    const emoji = shortcode ? emojiForShortcode(shortcode[2]!) : null;
    if (emoji) {
      const to = editor.state.selection.from;
      const from = to - shortcode![2]!.length - 2;
      requestAnimationFrame(() => editor.chain().deleteRange({ from, to }).insertContent(emoji).run());
      return setSuggest(null);
    }
    const channel = before.match(/(^|\s)#([\w-]{0,40})$/);
    const partial = before.match(/(^|\s):([a-z0-9_+-]{2,30})$/i);
    setSuggest(channel ? { kind: "channel", query: channel[2]! } : partial ? { kind: "emoji", query: partial[2]! } : null);
    setSuggestIndex(0);
  };

  const editor = useChatEditor({
    content: "",
    placeholder,
    className: "min-h-[2.75em]",
    onUpdate: onEditorUpdate,
    handlers: {
      onEnter: () => {
        if (menuOpen.current) return true;
        submitRef.current();
        return true;
      },
      onMenuKey: (key) => menuKey.current(key),
      onEscape: () => {
        if (suggestOpenRef.current) {
          setSuggest(null);
          return true;
        }
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
    // "Restored from earlier" only for a draft from before this page load, not one you left a minute ago.
    setRestored(Boolean(draft.trim()) && !draftsThisPage.has(draftKey));
    transfers.current.forEach((controller) => controller.abort());
    transfers.current.clear();
    uploadsRef.current.forEach((u) => {
      if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
    });
    setUploads([]);
  }, [draftKey, editor]);

  // Mentions in a restored draft read "@someone" until the member list arrives; then they get their names.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !people.length) return;
    const { tr } = editor.state;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "chatToken" || node.attrs.label !== "@someone") return;
      const label = labelOf(node.attrs.raw);
      if (label !== "@someone") tr.setNodeMarkup(pos, undefined, { ...node.attrs, label });
    });
    if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
  }, [editor, people]);

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((u) => {
        if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      });
    };
  }, []);
  useEffect(() => {
    if (!autoFocus || !editor || editor.isDestroyed) return;
    if (autoFocus === "always" || window.matchMedia("(pointer: fine)").matches) editor.commands.focus("end");
  }, [autoFocus, editor]);

  // Phones: toasts sit just above this composer, whatever its height (not a fixed 96px).
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--nb-composer-height", `${box.offsetHeight}px`));
    observer.observe(box);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--nb-composer-height");
    };
  }, []);

  const mentionable = useMemo(() => {
    const list: { id: string; username: string | null; fullName: string | null; avatarUrl: string | null; hint?: string }[] = people.filter((p) => p.id !== user?.id).map((p) => ({ id: p.id, username: p.username, fullName: p.full_name, avatarUrl: p.avatar_url }));
    if (allowBroadcast) {
      // After the people (matchMentions ranks them last too): "@h" finds Hana before @here.
      list.push(
        { id: "here", username: "here", fullName: "here", avatarUrl: null, hint: "Notify everyone online" },
        { id: "channel", username: "channel", fullName: "channel", avatarUrl: null, hint: "Notify everyone in this conversation" },
      );
    }
    return list;
  }, [allowBroadcast, people, user?.id]);
  const encode = (text: string) => encodeMentions(text, people.map((p) => ({ id: p.id, name: personLabel(p) })), { broadcast: allowBroadcast });

  const commands = SLASH_COMMANDS.filter((cmd) => cmd.command !== "/task" || (canCreateTask && !threadRootSeq));
  const typedSlash = plain.startsWith("/") && !/\s/.test(plain) ? plain.toLowerCase() : null;
  // "/po" finds /poll; "/sta" or "/you" find /status by its description or group too.
  const matchingSlash = typedSlash !== null
    ? commands.filter((cmd) => cmd.command.startsWith(typedSlash) || `${cmd.group} ${cmd.description}`.toLowerCase().includes(typedSlash.slice(1)))
    : slashForced ? commands : [];
  const activeSlash = Math.min(slashIndex, Math.max(0, matchingSlash.length - 1));

  /**
   * One code-block behavior for the + menu, the toolbar, ⌘⌥⇧C and /code: toggle a code block at the
   * caret. A typed "/code" (or "/code lang") is replaced by the block; anything else stays.
   */
  const startCodeBlock = (language: string | null) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (/^\/code(\s+\S*)?$/i.test(editor.getText().trim())) chain.clearContent();
    chain.toggleCodeBlock(language ? { language } : undefined).run();
  };

  const pickSlash = (command: string) => {
    setSlashForced(false);
    setSlashIndex(0);
    if (command === "/code") return startCodeBlock(null);
    if (command === "/status") {
      if (typedSlash !== null) clear();
      usePresenceUi.getState().setPickerOpen(true);
      return;
    }
    // The command goes in front of what you wrote (formatting and mentions kept).
    if (typedSlash !== null) setText(`${command} `);
    else prefix(`${command} `);
  };

  const insertText = (text: string) => {
    editor?.chain().focus().insertContent(text).run();
  };

  /** Replace the message with plain text (keeps a trailing space, which markdown parsing would drop). */
  const setText = (text: string) => {
    if (!editor) return;
    editor.chain().clearContent().insertContent({ type: "text", text }).focus("end").run();
  };
  /** Put text before what's typed: "+ → Poll" on a written question keeps it. */
  const prefix = (text: string) => {
    if (!editor) return;
    if (blank) return setText(text);
    editor.chain().focus("start").insertContent({ type: "text", text }).focus("end").run();
  };

  const pickMention = (participant: { id: string; username: string | null; fullName: string | null }) => {
    if (!editor) return;
    // Matched again at pick time: the caret may have moved since the list opened.
    const query = mentionQuery(editor);
    setMention(null);
    if (query === null) return;
    const caret = editor.state.selection.from;
    const from = caret - query.length - 1;
    const broadcast = participant.id === "here" || participant.id === "channel";
    editor.chain().focus().deleteRange({ from, to: caret })
      .insertContent(broadcast
        ? `@${participant.id} `
        : [{ type: "chatToken", attrs: { raw: `<@${participant.id}>`, label: `@${participant.fullName || participant.username || "someone"}` } }, { type: "text", text: " " }])
      .run();
  };

  // Channels you're in whose name matches (prefix first); emoji by name.
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!suggest) return [];
    if (suggest.kind === "emoji") return searchEmoji(suggest.query, 6).map((e) => ({ id: e.emoji, label: `:${e.name}:`, icon: e.emoji }));
    const q = suggest.query.toLowerCase();
    return (shell.data?.channels ?? [])
      .filter((c) => c.name && isVisible(c) && c.name.includes(q))
      .sort((a, b) => Number(!a.name!.startsWith(q)) - Number(!b.name!.startsWith(q)) || a.name!.localeCompare(b.name!))
      .slice(0, 6)
      .map((c) => ({ id: c.id, label: `#${c.name}`, icon: <Hash size={14} /> }));
  }, [shell.data?.channels, suggest]);
  const activeSuggest = Math.min(suggestIndex, Math.max(0, suggestions.length - 1));

  const pickSuggestion = (item: Suggestion) => {
    if (!editor || !suggest) return;
    const caret = editor.state.selection.from;
    // Matched again at pick time: the caret may have moved since the list opened.
    const match = textBeforeCaret(editor).match(suggest.kind === "channel" ? /#([\w-]{0,40})$/ : /:([a-z0-9_+-]{2,30})$/i);
    setSuggest(null);
    if (!match) return;
    const from = caret - match[0].length;
    editor.chain().focus().deleteRange({ from, to: caret })
      .insertContent(suggest.kind === "channel"
        ? [{ type: "chatToken", attrs: { raw: `<#${item.id}>`, label: item.label } }, { type: "text", text: " " }]
        : `${item.id} `)
      .run();
  };

  function openLink() {
    if (!editor) return;
    setLink(linkAtCaret(editor));
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

  const startUpload = (id: string, file: File) => {
      const controller = new AbortController();
      transfers.current.set(id, controller);
      // Same percent → same list, so React skips the re-render (UPL-02).
      const onProgress = (progress: number) => setUploads((list) => (list.some((u) => u.id === id && u.progress !== progress)
        ? list.map((u) => (u.id === id ? { ...u, progress } : u))
        : list));
      uploadChatFile(channelId, file, onProgress, controller.signal)
        .then((assetId) => {
          setUploads((list) => list.map((u) => (u.id === id ? { ...u, assetId, progress: 100 } : u)));
          setUploadNews(`${file.name} uploaded`);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const reason = uploadReason(error);
          setUploads((list) => list.map((u) => (u.id === id ? { ...u, error: true, reason, refused: uploadRefused(error) } : u)));
          setUploadNews(`${file.name} didn’t upload: ${reason}`);
        })
        .finally(() => transfers.current.delete(id));
  };
  const retryUpload = (u: Upload) => {
    if (!u.file || u.refused) return;
    setUploads((list) => list.map((x) => (x.id === u.id ? { ...x, error: false, reason: undefined, progress: 0 } : x)));
    startUpload(u.id, u.file);
  };

  const addFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    if (send) return void toast.message("Add files once the conversation has started");
    const room = CHAT_MAX_ATTACHMENTS - uploads.length;
    const picked = Array.from(files);
    if (picked.length > room) toast.warning(`Up to ${CHAT_MAX_ATTACHMENTS} files per message; ${picked.length - Math.max(room, 0)} skipped.`);
    for (const file of picked.slice(0, Math.max(room, 0))) {
      const problem = fileProblem(file, DEFAULT_ATTACHMENT_UPLOAD_MAX_FILE_BYTES);
      if (problem) {
        toast.error(feedbackError(problem, "Action couldn’t finish"));
        continue;
      }
      const id = crypto.randomUUID();
      const isImage = file.type.startsWith("image/");
      const previewUrl = isImage ? URL.createObjectURL(file) : null;
      setUploads((list) => [...list, { id, name: file.name, progress: 0, assetId: null, error: false, previewUrl, isImage, file }]);
      if (isImage || file.type.startsWith("video/")) {
        void readMediaDimensions(file).then((size) => {
          if (size) setUploads((list) => list.map((u) => (u.id === id ? { ...u, width: size.width, height: size.height } : u)));
        });
      }
      startUpload(id, file);
    }
  };

  // Files dropped here, or on the timeline / thread list above (same draft key).
  const addFilesRef = useRef(addFiles);
  useEffect(() => { addFilesRef.current = addFiles; });
  const drop = useFileDrop((files) => addFiles(files));
  useEffect(() => {
    const onDrop = (event: Event) => {
      const detail = (event as CustomEvent<DropDetail>).detail;
      if (detail?.draftKey === draftKey) addFilesRef.current(detail.files);
    };
    window.addEventListener(DROP_EVENT, onDrop);
    return () => window.removeEventListener(DROP_EVENT, onDrop);
  }, [draftKey]);
  // "Edit" on a failed send puts its text back here (below anything already typed).
  const loadRef = useRef<(body: string) => void>(() => undefined);
  useEffect(() => {
    loadRef.current = (body: string) => {
      const next = value.trim() ? `${value.trim()}\n\n${body}` : body;
      load(next);
      writeDraft(draftKey, next);
      editor?.commands.focus("end");
    };
  });
  useEffect(() => {
    const onLoad = (event: Event) => {
      const detail = (event as CustomEvent<LoadDraftDetail>).detail;
      if (detail?.draftKey === draftKey) loadRef.current(detail.body);
    };
    window.addEventListener(LOAD_DRAFT_EVENT, onLoad);
    return () => window.removeEventListener(LOAD_DRAFT_EVENT, onLoad);
  }, [draftKey]);

  const clear = () => {
    onTyping?.(false);
    if (editor && !editor.isDestroyed) {
      // A fresh editor state: ⌘Z can't bring back (and resend) what was just sent.
      const { schema, plugins } = editor.state;
      editor.view.updateState(EditorState.create({ schema, plugins }));
    }
    setValue("");
    setPlain("");
    setBlank(true);
    setSlashForced(false);
    setRestored(false);
    setAlsoToChannel(false);
    setMention(null);
    writeDraft(draftKey, "");
  };

  /** Discard the restored draft, with Undo. */
  const discardDraft = () => {
    const kept = value;
    clear();
    toast("Draft discarded", {
      action: {
        label: "Undo",
        onClick: () => {
          load(kept);
          writeDraft(draftKey, kept);
          setRestored(true);
        },
      },
    });
  };

  // Scheduling waits for text, takes no files or commands, and no channel copy of a thread reply.
  const scheduleBlocked = !plain.trim()
    ? "Type a message to schedule it"
    : uploads.length ? "Scheduled messages can’t carry files yet"
    : isCommand(plain.trim()) ? "Commands can’t be scheduled"
    : alsoToChannel ? "Clear \"Also send\" to schedule a reply"
    : null;

  /** Send later: the text only, queued for the chat-due job. */
  const schedule = async (at: Date) => {
    if (scheduleBlocked) return void toast.message(scheduleBlocked);
    if (sending) return;
    const body = encode(value.trim());
    if (body.length > CHAT_MAX_BODY) return void toast.error(chatErrorMessage("chat_body_too_long"));
    setSending(true);
    const result = await scheduleMessage({ channelId, body, sendAt: at.toISOString(), threadRootSeq });
    setSending(false);
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    clear();
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.scheduled() });
    toast.success("Message scheduled", { description: feedbackDate(at),
      action: { label: "View", onClick: () => router.push("/messages/drafts") },
    });
  };

  const submit = async () => {
    let text = plain.trim() ? value.trim() : "";
    if (!plain.trim() && !uploads.some((u) => u.assetId || (!u.error && !u.assetId))) return;
    if (uploads.some((u) => u.error)) {
      toast.error("A file didn’t upload", { description: "Retry it or remove it, then send." });
      return;
    }
    if (uploads.some((u) => !u.assetId)) {
      setQueued(true);
      return;
    }
    const ready = uploads.filter((u) => u.assetId);
    if (!threadRootSeq && canCreateTask && /^\/task\s+\S/.test(text)) {
      if (sending) return;
      setSending(true);
      const result = await createTaskFromMessage({ channelId, title: text.replace(/^\/task\s+/, "").slice(0, 200), operationId: crypto.randomUUID() });
      setSending(false);
      if (!result.success) return void toast.error(chatErrorMessage(result.error));
      update((pages) => upsertMessage(pages, result.message));
      clear();
      onSent?.();
      return;
    }
    const status = text.match(/^\/status(?:\s+([\s\S]*))?$/i);
    if (status) {
      clear();
      usePresenceUi.getState().setPickerOpen(true, status[1]?.trim() || null);
      return;
    }
    // "/code" or "/code typescript" opens a code block; "/code review done" is just a message.
    const code = text.match(/^\/code(?:\s+([\w+#.-]{1,20}))?$/i);
    if (code) return startCodeBlock(code[1] ?? null);
    const draft = text;
    if (/^\/poll(\s+|$)/i.test(text)) {
      const poll = pollBody(text);
      if (!poll) return void toast.message("Usage: /poll Question | Option 1 | Option 2");
      text = poll;
    }
    const body = encode(text);
    if (body.length > CHAT_MAX_BODY) return void toast.error(chatErrorMessage("chat_body_too_long"));
    if (send) {
      if (sending) return;
      clear();
      setSending(true);
      const result = await send(body).catch(() => ({ success: false as const, error: "chat_network" })).finally(() => setSending(false));
      if (!result.success) {
        load(draft);
        writeDraft(draftKey, draft);
        toast.error(chatErrorMessage(result.error));
        return;
      }
      onSent?.();
      return;
    }
    if (beforeSend) {
      if (sending) return;
      setSending(true);
      editor?.setEditable(false);
      try { await beforeSend(); }
      catch { toast.error("Couldn’t load the latest replies", { description: "Your draft is still here." }); return; }
      finally { setSending(false); editor?.setEditable(true); }
    }
    const clientId = crypto.randomUUID();
    // Files show at once from their on-device previews (at their real shape); the server's copy replaces them when it lands.
    const assetIds = ready.map((u) => u.assetId!);
    const localAttachments = ready.map((u, idx) => ({
      idx, asset_id: u.assetId!, name: u.name, mime: u.file?.type || "application/octet-stream", size: u.file?.size ?? 0,
      width: u.width ?? null, height: u.height ?? null, local_url: u.previewUrl ?? undefined,
    }));
    const optimistic: ChatMessageView = {
      channel_id: channelId, seq: -clock(), author_id: user?.id ?? null,
      author: user ? { id: user.id, username: profile?.username ?? null, full_name: profile?.fullName ?? null, avatar_url: profile?.avatarUrl ?? null } : null,
      kind: "user", body, thread_root_seq: threadRootSeq, reply_count: 0, last_reply_seq: null, last_reply_at: null,
      edited_at: null, deleted_at: null, created_at: new Date().toISOString(), client_message_id: clientId,
      attachments: localAttachments, reactions: [], card: null, pinned: false,
    };
    // The box clears at once. A failure leaves the message in place as "Not sent · Retry"; when
    // it isn't on screen (a reply from the Inbox), the text comes back to the box instead.
    const sentAlso = Boolean(threadRootSeq && alsoToChannel);
    const threadKey = threadRootSeq ? queryKeys.chat.thread(channelId, threadRootSeq) : null;
    const putInThread = (map: (replies: ChatMessageView[]) => ChatMessageView[]) => {
      if (threadKey) queryClient.setQueryData<{ replies: ChatMessageView[] }>(threadKey, (t) => (t ? { ...t, replies: map(t.replies) } : t));
    };
    clear();
    setUploads([]);
    if (threadKey) putInThread((replies) => [...replies, optimistic]);
    else update((pages) => upsertMessage(pages, optimistic));
    onSent?.();
    const result = await sendMessage({ channelId, body, clientId, threadRootSeq, assetIds, alsoToChannel: sentAlso })
      .catch(() => ({ success: false as const, error: "chat_network" }));
    if (!result.success) {
      const shown = failSend(queryClient, clientId, { channelId, threadRootSeq, body, assetIds, alsoToChannel: sentAlso });
      if (shown) return void toast.error(chatErrorMessage(result.error));
      if (!editor?.getText().trim()) {
        load(draft);
        writeDraft(draftKey, draft);
      }
      toast.error(feedbackError(`${chatErrorMessage(result.error)} Your message is back in the box.`, "Action couldn’t finish"));
      return;
    }
    if (threadKey) putInThread((replies) => replies.map((m) => (m.client_message_id === clientId ? keepLocalPreviews(result.message, m) : m)));
    else update((pages) => upsertMessage(pages, result.message));
    // The channel copy of a thread reply: say where it went, only if it really did.
    if (sentAlso && alsoSendTo) {
      if ("alsoSent" in result && result.alsoSent) toast.success(`Also sent to ${alsoSendTo}`);
      else toast.warning(`The reply was sent, but not the copy to ${alsoSendTo}`);
    }
  };
  // Screen readers follow the highlighted command while focus stays in the editor (like @mentions).
  useEffect(() => {
    const input = editor && !editor.isDestroyed ? editor.view.dom : null;
    if (!input || !matchingSlash.length) return;
    return openCombobox(input, `${draftKey}-slash`, `${draftKey}-slash-${activeSlash}`);
  }, [activeSlash, draftKey, editor, matchingSlash.length]);
  useEffect(() => {
    const input = editor && !editor.isDestroyed ? editor.view.dom : null;
    if (!input || !suggestions.length) return;
    return openCombobox(input, `${draftKey}-suggest`, `${draftKey}-suggest-${activeSuggest}`);
  }, [activeSuggest, draftKey, editor, suggestions.length]);
  useEffect(() => {
    submitRef.current = () => {
      if (matchingSlash.length) pickSlash(matchingSlash[activeSlash]!.command);
      else if (suggestions.length) pickSuggestion(suggestions[activeSuggest]!);
      else void submit();
    };
    menuOpen.current = Boolean(mention && matchMentions(mentionable, mention.query).length);
    slashOpenRef.current = matchingSlash.length > 0;
    suggestOpenRef.current = suggestions.length > 0;
    menuKey.current = (key) => {
      if (!matchingSlash.length && suggestions.length) {
        if (key === "tab") pickSuggestion(suggestions[activeSuggest]!);
        else setSuggestIndex((activeSuggest + (key === "down" ? 1 : suggestions.length - 1)) % suggestions.length);
        return true;
      }
      if (!matchingSlash.length) return false;
      if (key === "tab") pickSlash(matchingSlash[activeSlash]!.command);
      else setSlashIndex((activeSlash + (key === "down" ? 1 : matchingSlash.length - 1)) % matchingSlash.length);
      return true;
    };
  });

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const uploading = uploads.filter((u) => !u.assetId && !u.error);
  const uploadPercent = uploading.length ? Math.round(uploading.reduce((sum, u) => sum + u.progress, 0) / uploading.length) : 100;
  // The server counts the encoded body (mentions as tokens), so the counter does too.
  const length = value.length > CHAT_MAX_BODY * 0.8 ? encode(value).length : value.length;
  const tooLong = length > CHAT_MAX_BODY;
  const failedFile = uploads.some((u) => u.error);
  const canSend = Boolean(plain.trim() || uploads.length) && !failedFile && !tooLong && !queued;
  const sendBlockedReason = tooLong ? `Shorten it to ${CHAT_MAX_BODY.toLocaleString()} characters` : failedFile ? "Retry or remove the failed file" : queued ? "Sends when the upload finishes" : "Type a message to send";
  // Queued while files uploaded: send as soon as the last one is ready (or stop if one failed).
  useEffect(() => {
    if (!queued) return;
    if (failedFile) return setQueued(false);
    if (uploading.length) return;
    setQueued(false);
    void submit();
  });
  // A counter only near the limit; the editor points at it so a screen reader hears the count.
  const nearLimit = length > CHAT_MAX_BODY * 0.9;
  useEffect(() => {
    const input = editor && !editor.isDestroyed ? editor.view.dom : null;
    if (!input || !nearLimit) return;
    input.setAttribute("aria-describedby", `${draftKey}-count`);
    return () => input.removeAttribute("aria-describedby");
  }, [draftKey, editor, nearLimit]);
  const slashHint = /^\/(task|poll|status) $/i.test(plain) ? SLASH_COMMANDS.find((cmd) => plain.toLowerCase().startsWith(cmd.command))?.example ?? null : null;
  const mentionedIds = useMemo(() => Array.from(new Set(Array.from(value.matchAll(/<@([0-9a-f-]{36})>/g), (match) => match[1]!))).filter((id) => id !== user?.id).slice(0, 5), [user?.id, value]);
  const sendHint = coarse ? "Send" : `Send (${keyLabel("enter")}) · ${keyLabel("shift+enter")} for a new line`;

  const addItems: ComposerMenuItem[] = [
    ...(send ? [] : [
      { label: "Upload file", icon: Paperclip, onSelect: () => fileInput.current?.click() },
      { label: "Photos and videos", icon: ImageIcon, onSelect: () => mediaInput.current?.click() },
      ...(coarse ? [{ label: "Camera", icon: Camera, onSelect: () => cameraInput.current?.click() }] : []),
    ]),
    { label: "Code block", icon: Code2, onSelect: () => startCodeBlock(null) },
    ...(onOpenCanvas && !threadRootSeq ? [{ label: "Open canvas", icon: FileText, onSelect: onOpenCanvas }] : []),
    ...(canCreateTask && !threadRootSeq ? [{ label: "Create task", icon: SquareCheck, onSelect: () => prefix("/task ") }] : []),
    { label: "Poll", icon: BarChart3, onSelect: () => prefix("/poll ") },
  ];
  const scheduleItems: ComposerMenuItem[] = [
    ...laterTimes("schedule").map((option) => ({ label: option.label, onSelect: () => void schedule(option.at()) })),
    { label: "Custom time…", onSelect: () => setCustomSchedule(customDefault()), separatorBefore: true },
  ];

  return (
    <div ref={boxRef} className="nb-message-composer relative border-t border-border bg-card px-3 pt-2 sm:px-4" {...(send ? {} : drop.handlers)}>
      {send ? null : <DropOverlay show={drop.dragging} />}
      <TypingIndicator names={typingNames} />
      <p className="sr-only" aria-live="polite">{uploadNews}</p>
      {uploads.length ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {uploads.map((u) => (
            u.isImage && u.previewUrl ? (
              <li key={u.id} className="relative flex size-20 flex-none overflow-hidden rounded-md border border-border bg-muted">
                <img src={u.previewUrl} alt={u.name} className="size-full object-cover" />
                {u.progress < 100 && !u.error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-foreground/50 text-background">
                    <span className="nb-meta text-background">{u.progress}%</span>
                    <div className="mt-1 h-1 w-12 overflow-hidden rounded-full bg-background/30">
                      <div className="h-full bg-primary transition-[width] duration-[130ms]" style={{ width: `${u.progress}%` }} />
                    </div>
                  </div>
                ) : null}
                {u.error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-destructive/85 px-1 text-center text-[11px] font-semibold leading-tight text-destructive-foreground">
                    <span className="line-clamp-2">{u.reason ?? "Upload failed"}</span>
                    {u.refused ? null : <button type="button" onClick={() => retryUpload(u)} className="underline pointer-coarse:min-h-8" aria-label={`Retry ${u.name}`}>Retry</button>}
                  </div>
                ) : null}
                <button type="button" aria-label={`Remove ${u.name}`} onClick={() => removeUpload(u.id)} className="absolute right-1 top-1 grid size-6 place-items-center rounded-sm bg-foreground/70 text-background hover:bg-foreground pointer-coarse:size-8">
                  <X size={14} />
                </button>
              </li>
            ) : (
              <li key={u.id} className={`flex max-w-[260px] items-center gap-2 rounded-md border px-2 py-1 text-[13px] ${u.error ? "border-destructive text-destructive" : "border-border"}`}>
                <Paperclip size={14} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.error ? (
                  <>
                    <span className="max-w-[96px] truncate text-[11px]" title={u.reason}>{u.reason ?? "Upload failed"}</span>
                    {u.refused ? null : <button type="button" onClick={() => retryUpload(u)} className="nb-meta text-destructive underline pointer-coarse:min-h-11" aria-label={`Retry ${u.name}`}>Retry</button>}
                  </>
                ) : (
                  <span className="nb-meta">{u.assetId ? "Ready" : `${u.progress}%`}</span>
                )}
                <button type="button" aria-label={`Remove ${u.name}`} onClick={() => removeUpload(u.id)} className="nb-icon-button size-6 pointer-coarse:size-11"><X size={14} /></button>
              </li>
            )
          ))}
        </ul>
      ) : null}
      {mentionedIds.length ? (
        <p role="status" className="mb-2 hidden flex-wrap items-center gap-1.5 rounded-md bg-[var(--status-warning-soft)] px-3 py-1.5 text-[13px] text-[var(--status-warning)] has-[[data-away]]:flex">
          <span>Away (they’ll see this when they’re back):</span>
          {mentionedIds.map((id) => <AwayName key={id} userId={id} name={labelOf(`<@${id}>`).slice(1)} />)}
        </p>
      ) : null}
      {restored && !blank ? (
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="nb-status" data-status="draft">Draft</span>
          <span>Restored from earlier.</span>
          <Button type="button" variant="link" size="sm" onClick={discardDraft} className="h-auto px-0 pointer-coarse:min-h-11">Discard</Button>
        </div>
      ) : null}
      {slashHint ? <p className="nb-meta mb-1 px-1">e.g. {slashHint}</p> : null}
      <div className="relative rounded-md border border-input bg-card focus-within:border-ring">
        {matchingSlash.length > 0 ? (
          <div className="absolute bottom-full left-0 z-30 mb-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <div className="flex items-center justify-between px-2 py-1" aria-hidden="true">
              <span className="nb-micro">Slash commands</span>
              <span className="nb-meta pointer-coarse:hidden">↑↓ move · ↵ pick · esc</span>
            </div>
            <div id={`${draftKey}-slash`} role="listbox" aria-label="Slash commands">
            {[...new Set(matchingSlash.map((cmd) => cmd.group))].map((group) => (
              <div key={group} role="group" aria-label={group}>
              <p className="nb-micro px-2 pb-0.5 pt-1.5" aria-hidden="true">{group}</p>
              {matchingSlash.map((cmd, index) => cmd.group !== group ? null : (
              <button
                key={cmd.command}
                id={`${draftKey}-slash-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === activeSlash}
                onMouseEnter={() => setSlashIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSlash(cmd.command);
                }}
                className={`flex min-h-[34px] w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-[13px] pointer-coarse:min-h-11 ${index === activeSlash ? "bg-accent text-accent-foreground" : ""}`}
              >
                <span><span className="font-mono font-medium text-primary">{cmd.command}</span> <span className="text-muted-foreground">{cmd.description}</span></span>
                <span className="nb-meta">{cmd.example}</span>
              </button>
              ))}
              </div>
            ))}
            </div>
          </div>
        ) : null}
        {formatting && editor ? <FormatToolbar editor={editor} onLink={openLink} /> : null}
        <SuggestList
          id={`${draftKey}-suggest`}
          label={suggest?.kind === "channel" ? "Channels" : "Emoji"}
          items={suggestions}
          active={activeSuggest}
          onPick={pickSuggestion}
          onHover={setSuggestIndex}
        />
        {mention ? (
          <MentionDropdown query={mention.query} participants={mentionable} onSelect={pickMention} onClose={() => setMention(null)} getInput={() => (editor && !editor.isDestroyed ? editor.view.dom : null)} />
        ) : null}
        <div
          className="app-scroll app-scroll-y relative max-h-[160px] px-3 py-2"
          onKeyDownCapture={(e) => {
            if (!e.metaKey && !e.ctrlKey && (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Process" || e.key === "Unidentified")) typedAt.current = Date.now();
          }}
          onClick={() => editor?.commands.focus()}
          onPasteCapture={(e) => {
            // Only a real file paste attaches: copied cells (Sheets, Excel, Word) carry an image AND their text, and the text wins.
            if (!e.clipboardData.files.length || e.clipboardData.types.includes("text/plain")) return;
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
          <ComposerMenu
            title="Add"
            trigger={<Plus size={18} />}
            items={addItems}
            triggerProps={{ className: barButton(false), "aria-label": "Add attachment or action", title: "Add attachment or action" }}
          />
          <button type="button" aria-label="Formatting" title="Formatting" aria-pressed={formatting} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFormatting(!formatting); writeChatUi({ formatting: !formatting }); }} className={barButton(formatting)}>
            <ALargeSmall size={18} />
          </button>
          <button
            type="button"
            data-reaction-trigger
            aria-label="Emoji"
            aria-haspopup="dialog"
            title={isMac() ? "Emoji (⌃⌘Space for more)" : "Emoji"}
            aria-expanded={Boolean(emojiAnchor)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget)}
            className={barButton(Boolean(emojiAnchor))}
          >
            <Smile size={18} />
          </button>
          <button type="button" aria-label="Mention someone" title="Mention someone" onMouseDown={(e) => e.preventDefault()} onClick={() => insertText(plain && !/\s$/.test(plain) ? " @" : "@")} className={barButton(Boolean(mention))}>
            <PresenceGlyph kind="at" className="size-[18px]" />
          </button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            aria-label="Slash commands"
            title="Slash commands"
            aria-expanded={matchingSlash.length > 0}
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
          {nearLimit ? (
            <span id={`${draftKey}-count`} aria-live="polite" className={`nb-meta ml-auto ${tooLong ? "text-destructive" : ""}`}>
              {length.toLocaleString()}/{CHAT_MAX_BODY.toLocaleString()}<span className="sr-only"> characters</span>
            </span>
          ) : null}
          {/* aria-disabled (not disabled): keyboard and screen-reader users can still reach it and hear why. */}
          <button
            type="button"
            onClick={() => canSend && void submit()}
            aria-disabled={!canSend}
            aria-describedby={canSend ? undefined : `${draftKey}-send-why`}
            aria-label={queued ? `Sending when the upload finishes, ${uploadPercent}%` : "Send"}
            title={canSend ? sendHint : sendBlockedReason}
            className={`${nearLimit ? "ml-2" : "ml-auto"} inline-flex h-8 items-center gap-1.5 ${send ? "rounded-md" : "rounded-l-md"} bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-colors duration-[130ms] pointer-coarse:h-11 ${
              canSend ? "cursor-pointer hover:bg-[var(--primary-hover)]" : "cursor-not-allowed opacity-50"
            }`}
          >
            <SendHorizontal size={16} /> <span className={queued ? "" : "hidden sm:inline"}>{queued ? `Sending at ${uploadPercent}%` : "Send"}</span>
          </button>
          <span id={`${draftKey}-send-why`} className="sr-only">{sendBlockedReason}</span>
          {send ? null : (
            <ComposerMenu
              title="Schedule message"
              trigger={<ChevronDown size={16} />}
              items={scheduleItems}
              align="end"
              disabled={Boolean(scheduleBlocked) || sending}
              triggerProps={{
                "aria-label": scheduleBlocked ? `Schedule message (${scheduleBlocked})` : "Schedule message",
                title: scheduleBlocked ?? "Schedule message",
                className: `-ml-px inline-flex h-8 items-center rounded-r-md border-l border-primary-foreground/20 bg-primary px-2 text-primary-foreground pointer-coarse:h-11 pointer-coarse:px-3.5 ${scheduleBlocked || sending ? "cursor-not-allowed opacity-50" : "hover:bg-[var(--primary-hover)]"}`,
              }}
            />
          )}
        </div>
      </div>
      {threadRootSeq && alsoSendTo ? (
        <label className="mt-1.5 flex w-fit items-center gap-2 text-[13px] text-muted-foreground pointer-coarse:min-h-11">
          <input type="checkbox" checked={alsoToChannel} onChange={(e) => setAlsoToChannel(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Also send to {alsoSendTo}
        </label>
      ) : null}
      {emojiAnchor ? (
        <ReactionQuickBar
          anchor={emojiAnchor}
          onReact={(emoji) => { setEmojiAnchor(null); insertText(emoji); }}
          onClose={() => setEmojiAnchor(null)}
          returnFocus={() => editor?.commands.focus()}
          verb="Insert"
        />
      ) : null}
      <TimePickerDialog
        initial={customSchedule}
        title="Schedule message"
        label="Send at"
        confirmLabel="Schedule"
        onPick={(at) => void schedule(at)}
        onClose={() => setCustomSchedule(null)}
      />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={mediaInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <Dialog open={link !== null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogTitle>{link?.url ? "Edit link" : "Add link"}</DialogTitle>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!editor || !link) return setLink(null);
              // An address we can't link keeps the dialog open and says why (never dropped silently).
              if (!applyLink(editor, link.url, link.text)) return setLink({ ...link, error: "Use a web address (https://…) or an email (mailto:…)." });
              setLink(null);
            }}
          >
            <label className="block text-[13px] font-medium">Text
              <Input value={link?.text ?? ""} onChange={(e) => setLink((l) => l && { ...l, text: e.target.value })} className="mt-1" />
            </label>
            <label className="block text-[13px] font-medium">Link
              <Input
                autoFocus
                type="text"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="example.com"
                aria-invalid={Boolean(link?.error)}
                aria-describedby={link?.error ? `${draftKey}-link-error` : undefined}
                value={link?.url ?? ""}
                onChange={(e) => setLink((l) => l && { ...l, url: e.target.value, error: undefined })}
                className="mt-1"
              />
            </label>
            {link?.error ? <p id={`${draftKey}-link-error`} role="alert" className="text-[13px] text-destructive">{link.error}</p> : null}
            <DialogFooter paper>
              {editor?.isActive("link") ? (
                <Button type="button" variant="ghost" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLink(null); }} className="mr-auto text-destructive">Remove link</Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setLink(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
