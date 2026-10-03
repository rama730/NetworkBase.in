"use client";

import { useEffect } from "react";
import { EditorContent } from "@tiptap/react";

import { chatDraftToHtmlish, chatMarkdown, useChatEditor } from "@/components/messages/ChatEditor";

export /** Inline edit with the composer's editor: Enter saves, Escape cancels. */
function EditBox({ body, labelOf, onSave, onCancel }: { body: string; labelOf: (raw: string) => string; onSave: (markdown: string) => void; onCancel: () => void }) {
  const editor = useChatEditor({
    content: chatDraftToHtmlish(body, labelOf),
    placeholder: "Edit message",
    className: "min-h-[1.5em]",
    handlers: {
      onEnter: () => {
        if (editor) onSave(chatMarkdown(editor));
        return true;
      },
      onEscape: () => {
        onCancel();
        return true;
      },
    },
  });
  useEffect(() => {
    editor?.commands.focus("end");
  }, [editor]);
  return (
    <div className="my-1 space-y-2">
      <div className="app-scroll app-scroll-y max-h-[240px] rounded-[5px] border border-input bg-card px-3 py-2 focus-within:border-ring">
        <EditorContent editor={editor} />
      </div>
      <div className="flex gap-2 text-[13px]">
        <button type="button" className="rounded-[5px] border border-border px-3 py-1" onClick={onCancel}>Cancel</button>
        <button type="button" className="rounded-[5px] bg-primary px-3 py-1 text-primary-foreground" onClick={() => editor && onSave(chatMarkdown(editor))}>Save</button>
      </div>
    </div>
  );
}
