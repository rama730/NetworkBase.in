"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";

import { chatDraftToHtmlish, chatMarkdown, useChatEditor } from "@/components/messages/ChatEditor";
import { matchMentions, MentionDropdown } from "@/components/messages/parts/MentionDropdown";
import { Button } from "@/components/ui/button";
import { CHAT_MAX_BODY } from "@/lib/messaging/constants";
import type { ChatPerson } from "@/lib/messaging/types";

/** Inline edit with the composer's editor: Enter saves, Escape cancels, @ suggests people like the composer. */
export function EditBox({ body, labelOf, onSave, onCancel, people = [] }: {
  body: string; labelOf: (raw: string) => string; onSave: (markdown: string) => void; onCancel: () => void; people?: ChatPerson[];
}) {
  const [mention, setMention] = useState<{ query: string } | null>(null);
  // Same limit as sending: counted here, so a long edit is caught before the server refuses it.
  const [length, setLength] = useState(body.length);
  const tooLong = length > CHAT_MAX_BODY;
  const mentionable = useMemo(() => people.map((p) => ({ id: p.id, username: p.username, fullName: p.full_name, avatarUrl: p.avatar_url })), [people]);
  // While the @ list has matches, Enter and Escape belong to it.
  const menuOpen = useRef(false);
  const listShown = Boolean(mention && matchMentions(mentionable, mention.query).length);
  useEffect(() => {
    menuOpen.current = listShown;
  }, [listShown]);
  const editor = useChatEditor({
    content: chatDraftToHtmlish(body, labelOf),
    placeholder: "Edit message",
    className: "min-h-[1.5em]",
    onUpdate: (current: Editor) => {
      setLength(chatMarkdown(current).length);
      const { $head } = current.state.selection;
      const before = $head.parent.textBetween(0, $head.parentOffset, undefined, "\n");
      const match = before.match(/(^|\s)@([^\s@]{0,30})$/);
      setMention(match ? { query: match[2]! } : null);
    },
    handlers: {
      onEnter: () => {
        if (menuOpen.current) return true;
        save();
        return true;
      },
      onEscape: () => {
        if (menuOpen.current) return true;
        onCancel();
        return true;
      },
    },
  });
  useEffect(() => {
    editor?.commands.focus("end");
  }, [editor]);
  function save() {
    if (!editor) return;
    const markdown = chatMarkdown(editor);
    if (markdown.length > CHAT_MAX_BODY) return;
    onSave(markdown);
  }
  const pickMention = (participant: { id: string; username: string | null; fullName: string | null }) => {
    if (!editor) return;
    // Matched again at pick time: the caret may have moved since the list opened.
    const { $head } = editor.state.selection;
    const query = $head.parent.textBetween(0, $head.parentOffset, undefined, "\n").match(/(^|\s)@([^\s@]{0,30})$/)?.[2];
    setMention(null);
    if (query === undefined) return;
    const caret = editor.state.selection.from;
    editor.chain().focus().deleteRange({ from: caret - query.length - 1, to: caret })
      .insertContent([{ type: "chatToken", attrs: { raw: `<@${participant.id}>`, label: `@${participant.fullName || participant.username || "someone"}` } }, { type: "text", text: " " }])
      .run();
  };
  return (
    <div className="my-1 space-y-2">
      <div className={`relative app-scroll app-scroll-y max-h-[240px] rounded-md border bg-card px-3 py-2 ${tooLong ? "border-destructive" : "border-input focus-within:border-ring"}`}>
        {mention && mentionable.length ? (
          <MentionDropdown query={mention.query} participants={mentionable} onSelect={pickMention} onClose={() => setMention(null)} getInput={() => (editor && !editor.isDestroyed ? editor.view.dom : null)} />
        ) : null}
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Button type="button" variant="outline" size="sm" className="pointer-coarse:h-11" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" className="pointer-coarse:h-11" disabled={tooLong} onClick={save}>Save</Button>
        <span className="nb-meta pointer-coarse:hidden">Enter to save · Esc to cancel</span>
        {length > CHAT_MAX_BODY * 0.9 ? (
          <span role="status" className={`nb-meta ml-auto ${tooLong ? "text-destructive" : ""}`}>
            {length.toLocaleString()}/{CHAT_MAX_BODY.toLocaleString()}{tooLong ? " · too long to save" : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}
