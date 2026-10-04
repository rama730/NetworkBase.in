"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";

import { chatDraftToHtmlish, chatMarkdown, useChatEditor } from "@/components/messages/ChatEditor";
import { matchMentions, MentionDropdown } from "@/components/messages/parts/MentionDropdown";
import type { ChatPerson } from "@/lib/messaging/types";

/** Inline edit with the composer's editor: Enter saves, Escape cancels, @ suggests people like the composer. */
export function EditBox({ body, labelOf, onSave, onCancel, people = [] }: {
  body: string; labelOf: (raw: string) => string; onSave: (markdown: string) => void; onCancel: () => void; people?: ChatPerson[];
}) {
  const [mention, setMention] = useState<{ query: string } | null>(null);
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
      const { $head } = current.state.selection;
      const before = $head.parent.textBetween(0, $head.parentOffset, undefined, "￼");
      const match = before.match(/(^|\s)@([^\s@]{0,30})$/);
      setMention(match ? { query: match[2]! } : null);
    },
    handlers: {
      onEnter: () => {
        if (menuOpen.current) return true;
        if (editor) onSave(chatMarkdown(editor));
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
  const pickMention = (participant: { id: string; username: string | null; fullName: string | null }) => {
    if (!mention || !editor) return;
    const caret = editor.state.selection.from;
    setMention(null);
    editor.chain().focus().deleteRange({ from: caret - mention.query.length - 1, to: caret })
      .insertContent([{ type: "chatToken", attrs: { raw: `<@${participant.id}>`, label: `@${participant.fullName || participant.username || "someone"}` } }, { type: "text", text: " " }])
      .run();
  };
  return (
    <div className="my-1 space-y-2">
      <div className="relative app-scroll app-scroll-y max-h-[240px] rounded-[5px] border border-input bg-card px-3 py-2 focus-within:border-ring">
        {mention && mentionable.length ? (
          <MentionDropdown query={mention.query} participants={mentionable} onSelect={pickMention} onClose={() => setMention(null)} getInput={() => (editor && !editor.isDestroyed ? editor.view.dom : null)} />
        ) : null}
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <button type="button" className="rounded-[5px] border border-border px-3 py-1 pointer-coarse:min-h-11" onClick={onCancel}>Cancel</button>
        <button type="button" className="rounded-[5px] bg-primary px-3 py-1 text-primary-foreground pointer-coarse:min-h-11" onClick={() => editor && onSave(chatMarkdown(editor))}>Save</button>
        <span className="text-[12px] text-muted-foreground pointer-coarse:hidden">Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}
