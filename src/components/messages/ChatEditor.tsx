"use client";

import { useEffect, useState } from "react";
import { Extension, Node as TiptapNode, type Editor } from "@tiptap/core";
import { useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Bold, Code, FileCode, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from "lucide-react";

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
    return ["span", { "data-chat-token": node.attrs.raw, class: "rounded-[3px] bg-accent px-0.5 font-medium text-primary" }, node.attrs.label];
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
        // Slack: Enter sends everywhere (code blocks too); Shift+Enter adds a line.
        Enter: () => handlers.current.onEnter?.() ?? false,
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
        "Mod-Shift-u": () => {
          handlers.current.onLink?.();
          return true;
        },
      };
    },
  });
}

/** Stored body → editor input: tokens become atoms, any other "<" stays literal text. */
export function chatDraftToHtmlish(body: string, labelOf: (raw: string) => string) {
  return body
    .replace(/<(?![@#][0-9a-f-]{36}>)/g, "&lt;")
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
  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true },
      }),
      ChatToken,
      Markdown.configure({ html: true, breaks: true, linkify: true, transformPastedText: true }),
      keys,
    ],
    content: options.content,
    onUpdate: ({ editor }) => latest.current.onUpdate?.(editor),
    editorProps: {
      attributes: {
        class: `nb-compose outline-none ${options.className ?? ""}`,
        "aria-label": options.placeholder,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
  });
}

const TOOLBAR = [
  { name: "bold", label: "Bold (⌘B)", icon: Bold, run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { name: "italic", label: "Italic (⌘I)", icon: Italic, run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { name: "strike", label: "Strikethrough (⌘⇧X)", icon: Strikethrough, run: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { name: "link", label: "Link (⌘⇧U)", icon: Link2, run: null },
  { name: "orderedList", label: "Numbered list (⌘⇧7)", icon: ListOrdered, run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { name: "bulletList", label: "Bulleted list (⌘⇧8)", icon: List, run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { name: "blockquote", label: "Quote (⌘⇧9)", icon: Quote, run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { name: "code", label: "Code (⌘⇧C)", icon: Code, run: (e: Editor) => e.chain().focus().toggleCode().run() },
  { name: "codeBlock", label: "Code block (⌘⌥⇧C)", icon: FileCode, run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
] as const;

/** Formatting buttons that apply in place and show what is active at the caret. */
export function FormatToolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => Object.fromEntries(TOOLBAR.map(({ name }) => [name, e.isActive(name)])) as Record<string, boolean>,
  });
  return (
    <div className="flex flex-wrap gap-0.5 border-b border-border px-1 py-1" role="toolbar" aria-label="Formatting">
      {TOOLBAR.map(({ name, label, icon: Icon, run }) => (
        <button
          key={name}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={active[name] ?? false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (run ? run(editor) : onLink())}
          className={`grid size-8 place-items-center rounded-[5px] hover:bg-muted hover:text-foreground pointer-coarse:size-11 ${active[name] ? "bg-muted text-foreground" : "text-muted-foreground"}`}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

/** Wrap the selection (or insert text) as a link; an empty URL removes it. */
export function applyLink(editor: Editor, url: string, text: string) {
  const href = url.trim() && !/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
  if (!href) return void editor.chain().focus().extendMarkRange("link").unsetLink().run();
  if (!/^https?:|^mailto:/i.test(href)) return;
  const { empty } = editor.state.selection;
  if (empty) {
    editor.chain().focus().insertContent({ type: "text", text: text.trim() || href, marks: [{ type: "link", attrs: { href } }] }).insertContent(" ").run();
  } else {
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }
}
