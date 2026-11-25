"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { detailsKeys, keyLabel } from "@/components/messages/keys";

/** The shortcuts Messages already has, in one place (⌘/ or Ctrl+/). Keep in step with MessagesChrome, MessageRow and the composer. */
function groups() {
  const k = keyLabel;
  return [
    { title: "Anywhere in Messages", keys: [
      [k("mod+k"), "Jump to a conversation or person"],
      [`${k("mod+enter")} in the switcher`, "Search messages"],
      [`${k("alt+up")} / ${k("alt+down")}`, "Previous / next conversation with something new"],
      [k("esc"), "Mark this conversation as read, or close the thread or details"],
      [k("shift+esc"), "Mark every conversation needing you as read"],
      [k(detailsKeys()), "Open or close conversation details"],
      [k("mod+/"), "These shortcuts"],
    ] },
    { title: "Writing", keys: [
      [k("enter"), "Send"],
      [k("shift+enter"), "New line"],
      [`${k("up")} in an empty box`, "Edit your last message"],
      ["@", "Mention someone"],
      ["/", "Commands (/task, /poll, /code…)"],
      ["Tab", "Pick the highlighted command or person"],
    ] },
    { title: "Formatting", keys: [
      [k("mod+b"), "Bold"],
      [k("mod+i"), "Italic"],
      [k("mod+shift+x"), "Strikethrough"],
      [k("mod+shift+u"), "Link"],
      [`${k("mod+shift+7")} / ${k("mod+shift+8")}`, "Numbered / bulleted list"],
      [k("mod+shift+9"), "Quote"],
      [k("mod+shift+c"), "Inline code"],
      [k("mod+alt+shift+c"), "Code block"],
    ] },
    { title: "On a message (Tab to the list, then ↑ / ↓)", keys: [
      [`${k("up")} / ${k("down")}`, "Previous / next message"],
      ["T", "Reply in thread"],
      ["S", "Save"],
      ["U", "Mark unread"],
      ["E", "Edit (your messages)"],
      [k("backspace"), "Delete"],
      [k("shift+f10"), "Open the actions menu (a conversation in the sidebar too)"],
    ] },
  ] as const;
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nbm nbm-dialog max-h-[85dvh] overflow-y-auto">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Shortcuts don’t fire while you’re typing, except in the message box.</DialogDescription>
        {groups().map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="nb-micro mb-1.5">{group.title}</h3>
            <dl className="divide-y divide-border rounded-md border border-border">
              {group.keys.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                  <dt><kbd className="nb-meta text-foreground">{keys}</kbd></dt>
                  <dd className="text-right text-muted-foreground">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
