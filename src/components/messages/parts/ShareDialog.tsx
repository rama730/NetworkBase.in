"use client";

import { useMemo, useState } from "react";
import { toast } from "@/lib/feedback";

import { shareMessage } from "@/app/actions/chat/messages";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ConversationIcon } from "@/components/messages/ConversationIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle, counterpart } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";

/** Share a message into another conversation you're in, with an optional note. */
export function ShareDialog({ channelId, seq, onClose }: { channelId: string; seq: number; onClose: () => void }) {
  const { data } = useChatShell();
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState(0);
  // Not the conversation the message is already in.
  const options = useMemo(() => (data?.channels ?? [])
    .filter((c) => !c.channel_archived_at && !c.archived_at && c.id !== channelId)
    .map((c) => ({ channel: c, title: channelTitle(c, meId) }))
    .filter((o) => !query || o.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.channel.last_message_at ?? "").localeCompare(a.channel.last_message_at ?? ""))
    .slice(0, 30), [channelId, data?.channels, meId, query]);
  // ↑/↓ move through the list from the search box, Enter picks (no tabbing through 30 rows).
  const onKeys = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      const next = (active + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
      setActive(next);
      document.getElementById(`share-option-${options[next]!.channel.id}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && options[active]) {
      event.preventDefault();
      setTarget(options[active].channel.id);
    }
  };

  const send = async () => {
    if (!target || sending) return;
    setSending(true);
    const result = await shareMessage({ channelId, seq, toChannelId: target, note: note.trim() || undefined });
    setSending(false);
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success("Message shared");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share message</DialogTitle>
          <DialogDescription>Mentions in the shared copy won’t notify anyone again.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeys}
          placeholder="Search conversations"
          aria-label="Search conversations"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls="share-options"
          aria-activedescendant={options[active] ? `share-option-${options[active].channel.id}` : undefined}
          className="pointer-coarse:h-11"
        />
        <ul id="share-options" className="app-scroll app-scroll-y max-h-56 space-y-px" role="listbox" aria-label="Share to">
          {options.map(({ channel, title }, index) => (
            <li key={channel.id} id={`share-option-${channel.id}`} role="option" aria-selected={target === channel.id}>
              <button type="button" tabIndex={-1} onClick={() => setTarget(channel.id)} onMouseEnter={() => setActive(index)} className={`flex min-h-[34px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] pointer-coarse:min-h-11 ${target === channel.id ? "bg-accent text-accent-foreground" : index === active ? "bg-muted" : "hover:bg-muted"}`}>
                {channel.kind === "dm" || counterpart(channel) ? <UserAvatar identity={channel.dm_user ?? counterpart(channel)} size={20} /> : <ConversationIcon channel={channel} size={16} aria-hidden="true" className="text-muted-foreground" />}
                <span className="truncate">{title}</span>
              </button>
            </li>
          ))}
          {!options.length ? <li className="px-2 py-3 text-[13px] text-muted-foreground">No conversations match.</li> : null}
        </ul>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="Add a note (optional)" aria-label="Note" className="w-full rounded-md border border-input bg-card px-3 py-2 text-[15px] outline-none focus:border-ring" />
        <DialogFooter paper>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!target || sending} onClick={() => void send()}>{sending ? "Sharing…" : "Share"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
