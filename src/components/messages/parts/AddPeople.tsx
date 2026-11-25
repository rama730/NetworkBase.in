"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Search, UserPlus } from "lucide-react";
import { toast } from "@/lib/feedback";

import { addMembers } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { useChannelMembers } from "@/components/messages/useConversation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { personName } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { queryKeys } from "@/lib/query-keys";

/** Search people and add them to a conversation, one tap each. People already here say so. */
export function AddPeople({ channelId, autoFocus = false }: { channelId: string; autoFocus?: boolean }) {
  const queryClient = useQueryClient();
  const members = useChannelMembers(channelId);
  const existing = new Set((members.data ?? []).map((m) => m.id));
  const [query, setQuery] = useState("");
  // One add at a time per person: a double tap can't add (and toast) twice.
  const [adding, setAdding] = useState<string | null>(null);
  const results = usePeopleSearch(query);
  const add = async (userId: string, name: string) => {
    if (adding) return;
    setAdding(userId);
    const result = await addMembers({ channelId, userIds: [userId] }).finally(() => setAdding(null));
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success(`${name} added`);
    setQuery("");
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
  };
  const found = (results.data ?? []).slice(0, 6);
  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Add people</span>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus={autoFocus} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add people by name" className="pl-9 pointer-coarse:h-11 pointer-coarse:text-[17px]" />
      </label>
      {found.map((person) => {
        const member = existing.has(person.id);
        return (
          <button
            key={person.id}
            type="button"
            disabled={member || adding !== null}
            aria-busy={adding === person.id || undefined}
            onClick={() => void add(person.id, personName(person))}
            className="nbm-mrow nbm-mrow-add"
          >
            <UserAvatar identity={person} size={26} />
            <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
            {member ? (
              <span className="nbm-tag"><Check size={12} aria-hidden="true" /> In channel</span>
            ) : adding === person.id ? (
              <span className="nbm-lrow-meta">Adding…</span>
            ) : (
              <UserPlus size={16} aria-hidden="true" className="text-muted-foreground" />
            )}
          </button>
        );
      })}
      {query.trim().length >= 2 && results.data && !found.length && !results.pending ? <p className="px-2 text-[13px] text-muted-foreground">No one matches &ldquo;{query.trim()}&rdquo;.</p> : null}
    </div>
  );
}

export function AddPeopleDialog({ channelId, title, onClose }: { channelId: string; title: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add people to {title}</DialogTitle>
          <DialogDescription>They’ll see the conversation history.</DialogDescription>
        </DialogHeader>
        <AddPeople channelId={channelId} autoFocus />
      </DialogContent>
    </Dialog>
  );
}
