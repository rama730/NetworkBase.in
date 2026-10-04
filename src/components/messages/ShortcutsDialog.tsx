"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The shortcuts Messages already has, in one place (⌘/ or Ctrl+/). Keep in step with MessagesChrome, MessageRow and the composer. */
function groups(mod: string) {
  return [
    { title: "Anywhere in Messages", keys: [
      [`${mod}K`, "Jump to a conversation or person"],
      [`${mod}↵ in the switcher`, "Search messages"],
      ["Alt ↑ / Alt ↓", "Previous / next conversation with something new"],
      ["Esc", "Mark this conversation as read, or close the thread or details"],
      ["Shift Esc", "Mark every conversation needing you as read"],
      [`${mod}⇧I`, "Open or close conversation details"],
      [`${mod}/`, "These shortcuts"],
    ] },
    { title: "Writing", keys: [
      ["Enter", "Send"],
      ["Shift Enter", "New line"],
      ["↑ in an empty box", "Edit your last message"],
      ["@", "Mention someone"],
      ["/", "Commands (/task, /poll, /code…)"],
      ["Tab", "Pick the highlighted command or person"],
    ] },
    { title: "Formatting", keys: [
      [`${mod}B`, "Bold"],
      [`${mod}I`, "Italic"],
      [`${mod}⇧X`, "Strikethrough"],
      [`${mod}⇧U`, "Link"],
      [`${mod}⇧7 / ${mod}⇧8`, "Numbered / bulleted list"],
      [`${mod}⇧9`, "Quote"],
      [`${mod}⇧C`, "Inline code"],
      [`${mod}⌥⇧C`, "Code block"],
    ] },
    { title: "On a message (Tab to the list, then ↑ / ↓)", keys: [
      ["↑ / ↓", "Previous / next message"],
      ["T", "Reply in thread"],
      ["S", "Save"],
      ["U", "Mark unread"],
      ["E", "Edit (your messages)"],
      ["⌫", "Delete"],
    ] },
  ] as const;
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mod = isMac() ? "⌘" : "Ctrl+";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Shortcuts don&apos;t fire while you&apos;re typing, except in the message box.</DialogDescription>
        {groups(mod).map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{group.title}</h3>
            <dl className="divide-y divide-border rounded-[5px] border border-border">
              {group.keys.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                  <dt><kbd className="font-mono text-[12px]">{keys}</kbd></dt>
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
