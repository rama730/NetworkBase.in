"use client";

import { normalizeSafeExternalUrl, sameOriginPath } from "@/lib/messaging/safe-links";
import { useEffect, useRef, useState } from "react";
import { Extension, Node as TiptapNode, type Editor } from "@tiptap/core";
import { useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Bold, Code, FileCode, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";

import { keyLabel, rovingTabKey } from "@/components/messages/keys";

/**
 * The message editor (composer and inline edit): formatting shows as you type,
 * like Slack, and the output is the same markdown the timeline already renders.
 * Mentions are atoms that serialize to their <@id> token.
 */
const ChatToken = TiptapNode.create({
  name: "chatToken",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { raw: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-chat-token]", getAttrs: (el) => ({ raw: (el as HTMLElement).getAttribute("data-chat-token"), label: (el as HTMLElement).textContent }) }];
  },
  renderHTML({ node }) {
    return ["span", { "data-chat-token": node.attrs.raw, class: "rounded-sm bg-accent px-0.5 font-medium text-primary" }, node.attrs.label];
  },
  renderText({ node }) {
    return node.attrs.label;
  },
  addStorage() {
    return { markdown: { serialize(state: { write: (text: string) => void }, node: { attrs: { raw: string } }) { state.write(node.attrs.raw); }, parse: {} } };
  },
});

type Handlers = {
  /** Enter without Shift. Return true when handled (sent). */
  onEnter?: () => boolean;
  onArrowUpEmpty?: () => boolean;
  /** Up/Down/Tab while a suggestion menu is open. Return true when handled. */
  onMenuKey?: (key: "up" | "down" | "tab") => boolean;
  onEscape?: () => boolean;
  /** ⌘⇧U */
  onLink?: () => void;
};

function slackKeys(handlers: { current: Handlers }) {
  return Extension.create({
    name: "slackKeys",
    addKeyboardShortcuts() {
      return {
        // Slack: Enter sends everywhere (code blocks too); Shift+Enter adds a line. On a touch
        // keyboard (no Shift+Enter) Enter adds a line and the Send button sends, like Slack's apps.
        Enter: () => (isTouch() ? false : handlers.current.onEnter?.() ?? false),
        "Shift-Enter": ({ editor }) => {
          if (editor.isActive("codeBlock")) return editor.commands.newlineInCode();
          if (editor.isActive("listItem")) return editor.commands.splitListItem("listItem");
          return editor.commands.setHardBreak();
        },
        ArrowUp: ({ editor }) => handlers.current.onMenuKey?.("up") || (editor.isEmpty ? handlers.current.onArrowUpEmpty?.() ?? false : false),
        ArrowDown: () => handlers.current.onMenuKey?.("down") ?? false,
        Tab: () => handlers.current.onMenuKey?.("tab") ?? false,
        Escape: () => handlers.current.onEscape?.() ?? false,
        "Mod-Shift-x": ({ editor }) => editor.commands.toggleStrike(),
        "Mod-Shift-c": ({ editor }) => editor.commands.toggleCode(),
        "Mod-Alt-Shift-c": ({ editor }) => editor.commands.toggleCodeBlock(),
        "Mod-Shift-9": ({ editor }) => editor.commands.toggleBlockquote(),
        // Only where there's a link dialog (the composer); the edit box lets the key through.
        "Mod-Shift-u": () => {
          if (!handlers.current.onLink) return false;
          handlers.current.onLink();
          return true;
        },
      };
    },
  });
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Stored body → editor input: tokens become atoms, autolinks (<https://…>) stay links,
 * and any other "<" stays literal text.
 */
export function chatDraftToHtmlish(body: string, labelOf: (raw: string) => string) {
  return body
    .replace(/<(?![@#][0-9a-f-]{36}>)(?!(?:https?|mailto):[^>\s]+>)/g, "&lt;")
    .replace(/<([@#])([0-9a-f-]{36})>/g, (raw) => `<span data-chat-token="${raw}">${labelOf(raw).replace(/[<&]/g, "")}</span>`);
}

/** Editor → body markdown, minus the serializer's needless escapes. */
export function cleanChatMarkdown(markdown: string) {
  return markdown
    .replace(/\\\n/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/(\w)\\_(?=\w)/g, "$1_")
    .trim();
}

/** Nothing typed: only empty paragraphs (a list, quote or code block counts as content). */
export function isBlank(editor: Editor) {
  let blank = true;
  editor.state.doc.forEach((node) => {
    if (node.type.name !== "paragraph" || node.childCount > 0) blank = false;
  });
  return blank;
}

export function chatMarkdown(editor: Editor) {
  return cleanChatMarkdown((editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? editor.getText());
}

export function useChatEditor(options: {
  content: string;
  placeholder: string;
  onUpdate?: (editor: Editor) => void;
  handlers: Handlers;
  className?: string;
}) {
  // Latest callbacks for the editor, which is built once.
  const [latest] = useState(() => ({ current: { handlers: options.handlers, onUpdate: options.onUpdate } }));
  const [keys] = useState(() => slackKeys({ get current() { return latest.current.handlers; } }));
  useEffect(() => {
    latest.current = { handlers: options.handlers, onUpdate: options.onUpdate };
  });
  const attributes = (placeholder: string) => ({
    class: `nb-compose outline-none ${options.className ?? ""}`,
    "aria-label": placeholder,
    "aria-multiline": "true",
    role: "textbox",
    // The phone keyboard's return key: a new line there, Send on a keyboard with Shift+Enter.
    enterkeyhint: isTouch() ? "enter" : "send",
  });
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", isAllowedUri: (url) => Boolean(sameOriginPath(url, typeof window === "undefined" ? "https://networkbase.in" : window.location.origin) || normalizeSafeExternalUrl(url)) },
      }),
      ChatToken,
      // Pasted text stays the text you copied (no markdown or HTML parsing): "<Button>", "*.txt"
      // and "# title" arrive as typed. Pasted rich content (HTML) still keeps its formatting.
      Markdown.configure({ html: true, breaks: true, linkify: true, transformPastedText: false }),
      keys,
    ],
    content: options.content,
    onUpdate: ({ editor }) => latest.current.onUpdate?.(editor),
    editorProps: { attributes: attributes(options.placeholder) },
  });
  // The accessible name follows the placeholder (New message changes it as people are added).
  const named = useRef(options.placeholder);
  useEffect(() => {
    if (!editor || editor.isDestroyed || named.current === options.placeholder) return;
    named.current = options.placeholder;
    editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: attributes(options.placeholder) } });
  });
  return editor;
}

const TOOLBAR = [
  { name: "bold", label: "Bold", keys: "mod+b", icon: Bold, run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { name: "italic", label: "Italic", keys: "mod+i", icon: Italic, run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { name: "strike", label: "Strikethrough", keys: "mod+shift+x", icon: Strikethrough, run: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { name: "link", label: "Link", keys: "mod+shift+u", icon: Link2, run: null },
  { name: "orderedList", label: "Numbered list", keys: "mod+shift+7", icon: ListOrdered, run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { name: "bulletList", label: "Bulleted list", keys: "mod+shift+8", icon: List, run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { name: "blockquote", label: "Quote", keys: "mod+shift+9", icon: Quote, run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { name: "code", label: "Code", keys: "mod+shift+c", icon: Code, run: (e: Editor) => e.chain().focus().toggleCode().run() },
  { name: "codeBlock", label: "Code block", keys: "mod+alt+shift+c", icon: FileCode, run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
] as const;

/** Formatting buttons that apply in place and show what is active at the caret. One Tab stop; ←/→ move. */
export function FormatToolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => Object.fromEntries(TOOLBAR.map(({ name }) => [name, e.isActive(name)])) as Record<string, boolean>,
  });
  const [current, setCurrent] = useState(0);
  return (
    <div
      className="flex flex-wrap gap-0.5 border-b border-border px-1 py-1"
      role="toolbar"
      aria-label="Formatting"
      onKeyDown={(event) => {
        const next = rovingTabKey(event, current, TOOLBAR.length);
        if (next === null) return;
        setCurrent(next);
        (event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
      }}
    >
      {TOOLBAR.map(({ name, label, keys, icon: Icon, run }, index) => (
        <button
          key={name}
          type="button"
          tabIndex={index === current ? 0 : -1}
          aria-label={label}
          aria-keyshortcuts={keys.replace("mod", "Meta")}
          title={`${label} (${keyLabel(keys)})`}
          aria-pressed={active[name] ?? false}
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => setCurrent(index)}
          onClick={() => (run ? run(editor) : onLink())}
          className={`nb-icon-button size-8 pointer-coarse:size-11 ${active[name] ? "bg-muted text-foreground" : ""}`}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

/** The link under the caret (or the selection) and its text, for the link dialog. */
export function linkAtCaret(editor: Editor) {
  // Inside an existing link: edit that whole link, not a new one at the caret.
  if (editor.isActive("link")) editor.chain().extendMarkRange("link").run();
  const { from, to } = editor.state.selection;
  return { text: editor.state.doc.textBetween(from, to, " "), url: String(editor.getAttributes("link").href ?? "") };
}

/**
 * Put a link on the selection (or at the caret), with the text as typed in the dialog; an
 * empty URL removes it. False when the address isn't one we can link (the dialog says so).
 */
export function applyLink(editor: Editor, url: string, text: string) {
  if (!url.trim()) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return true;
  }
  const href = sameOriginPath(url.trim(), typeof window === "undefined" ? "https://networkbase.in" : window.location.origin) ?? normalizeSafeExternalUrl(url);
  if (!href) return false;
  const { empty, from, to } = editor.state.selection;
  const label = text.trim() || (empty ? href : editor.state.doc.textBetween(from, to, " "));
  // Replaces the selection (an edited link included), so it's never a second copy.
  const chain = editor.chain().focus().insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] });
  (empty ? chain.insertContent(" ") : chain).run();
  return true;
}
