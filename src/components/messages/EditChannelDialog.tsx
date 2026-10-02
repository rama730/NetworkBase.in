"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { updateChannel, type ChannelDetails } from "@/app/actions/chat/channels";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CHAT_MAX_DESCRIPTION } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { queryKeys } from "@/lib/query-keys";

/** Topic and description (and the name, for admins). */
export function EditChannelDialog({ channel, open, onOpenChange }: { channel: ChannelDetails; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { refresh } = useChatShell();
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [description, setDescription] = useState(channel.description ?? "");
  const [saving, setSaving] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const result = await updateChannel({ channelId: channel.id, topic: topic.trim() || null, description: description.trim() || null });
    setSaving(false);
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channel.id) });
    refresh();
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogTitle>Edit #{channel.name}</DialogTitle>
        <DialogDescription>Everyone in the channel sees the topic in the header.</DialogDescription>
        <form className="space-y-4" onSubmit={save}>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Topic</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value.slice(0, 250))} className="h-[var(--ui-control-height)] w-full rounded-[5px] border border-input bg-card px-3 text-[15px] pointer-coarse:h-11 pointer-coarse:text-[17px]" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, CHAT_MAX_DESCRIPTION))} rows={3} className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[15px] pointer-coarse:text-[17px]" />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
