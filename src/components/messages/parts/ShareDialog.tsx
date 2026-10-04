"use client";

import { useMemo, useState } from "react";
import { Hash, Lock, Users } from "lucide-react";
import { toast } from "sonner";

import { shareMessage } from "@/app/actions/chat/messages";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle } from "@/lib/messaging/channel-view";
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
  const options = useMemo(() => (data?.channels ?? [])
    .filter((c) => !c.channel_archived_at && !c.archived_at)
    .map((c) => ({ channel: c, title: channelTitle(c, meId) }))
    .filter((o) => !query || o.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.channel.last_message_at ?? "").localeCompare(a.channel.last_message_at ?? ""))
    .slice(0, 30), [data?.channels, meId, query]);

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
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Share message</DialogTitle>
        <DialogDescription>Mentions in the shared copy won&apos;t notify anyone again.</DialogDescription>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="h-10 w-full rounded-[5px] border border-input bg-card px-3 text-[15px]" />
        <ul className="app-scroll app-scroll-y max-h-56 space-y-px" role="listbox" aria-label="Share to">
          {options.map(({ channel, title }) => {
            const Icon = channel.name === null ? Users : channel.kind === "private" ? Lock : Hash;
            return (
              <li key={channel.id}>
                <button type="button" role="option" aria-selected={target === channel.id} onClick={() => setTarget(channel.id)} className={`flex min-h-10 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] ${target === channel.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                  {channel.kind === "dm" ? <UserAvatar identity={channel.dm_user} size={20} roundedClassName="rounded-[3px]" /> : <Icon size={15} aria-hidden="true" className="text-muted-foreground" />}
                  <span className="truncate">{title}</span>
                </button>
              </li>
            );
          })}
          {!options.length ? <li className="px-2 py-3 text-[13px] text-muted-foreground">No conversations match.</li> : null}
        </ul>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="Add a note (optional)" aria-label="Note" className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[14px]" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-[5px] border border-border px-3 text-[13px]">Cancel</button>
          <button type="button" disabled={!target || sending} onClick={() => void send()} className="h-9 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground disabled:opacity-50">{sending ? "Sharing…" : "Share"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
