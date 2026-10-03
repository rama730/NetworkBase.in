"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { addMembers } from "@/app/actions/chat/members";
import { usePeopleSearch } from "@/components/messages/usePeopleSearch";
import { useChannelMembers } from "@/components/messages/useConversation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { personName } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { queryKeys } from "@/lib/query-keys";

/** Search people and add them to a conversation, one tap each. */
export function AddPeople({ channelId, autoFocus = false }: { channelId: string; autoFocus?: boolean }) {
  const queryClient = useQueryClient();
  const members = useChannelMembers(channelId);
  const existing = new Set((members.data ?? []).map((m) => m.id));
  const [query, setQuery] = useState("");
  const results = usePeopleSearch(query);
  const add = async (userId: string, name: string) => {
    const result = await addMembers({ channelId, userIds: [userId] });
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success(`${name} added`);
    setQuery("");
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.members(channelId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channelId) });
  };
  const found = (results.data ?? []).filter((p) => !existing.has(p.id)).slice(0, 6);
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">Add people</span>
        <input autoFocus={autoFocus} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add people by name" className="h-[var(--ui-control-height)] w-full rounded-[5px] border border-input bg-card px-3 text-[15px] pointer-coarse:h-11 pointer-coarse:text-[17px]" />
      </label>
      {found.map((person) => (
        <button key={person.id} type="button" onClick={() => void add(person.id, personName(person))} className="flex min-h-11 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[15px] hover:bg-muted">
          <UserAvatar identity={person} size={24} roundedClassName="rounded-[5px]" />
          <span className="min-w-0 flex-1 truncate">{personName(person)}</span>
          <UserPlus size={16} aria-hidden="true" />
        </button>
      ))}
      {query.trim().length >= 2 && results.data && !found.length ? <p className="px-2 text-[13px] text-muted-foreground">No one else matches.</p> : null}
    </div>
  );
}

export function AddPeopleDialog({ channelId, title, onClose }: { channelId: string; title: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Add people to {title}</DialogTitle>
        <DialogDescription>They&apos;ll see the conversation history.</DialogDescription>
        <AddPeople channelId={channelId} autoFocus />
      </DialogContent>
    </Dialog>
  );
}
