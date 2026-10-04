"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { createChannel } from "@/app/actions/chat/channels";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CHAT_CHANNEL_NAME_PATTERN, CHAT_MAX_DESCRIPTION } from "@/lib/messaging/constants";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref } from "@/lib/messaging/routes";

/**
 * Name, optional description, a private switch (report 7.10 D6). The 200-per-project cap is enforced in SQL.
 * Says which project it goes in; from the All projects view you can pick another.
 */
export function CreateChannelDialog({ projectId: initialProjectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { data, refresh } = useChatShell();
  const allView = useSelectedProject() === null;
  const [projectId, setProjectId] = useState(initialProjectId);
  const projects = data?.projects ?? [];
  const projectTitle = projects.find((p) => p.id === projectId)?.title;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const normalized = name.trim().toLowerCase().replace(/\s+/g, "-");
  const valid = CHAT_CHANNEL_NAME_PATTERN.test(normalized);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const result = await createChannel({ projectId, name: normalized, description: description.trim() || null, isPrivate });
    setSaving(false);
    if (!result.success) {
      toast.error(chatErrorMessage(result.error));
      return;
    }
    refresh();
    onOpenChange(false);
    setName("");
    setDescription("");
    setPrivate(false);
    router.push(conversationHref(result.channelId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogTitle>Create channel</DialogTitle>
        <DialogDescription>{projectTitle ? <>In <span className="font-medium text-foreground">{projectTitle}</span>. </> : null}Channels are where your project talks about a topic.</DialogDescription>
        <form className="space-y-4" onSubmit={submit}>
          {allView && projects.length > 1 ? (
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium">Project</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-[var(--ui-control-height)] w-full rounded-[5px] border border-input bg-card px-2 text-[15px] pointer-coarse:h-11">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </label>
          ) : null}
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. design" maxLength={80} autoFocus aria-invalid={name.length > 0 && !valid} aria-describedby="chat-channel-name-hint" />
            <span id="chat-channel-name-hint" className={`block text-[12px] ${name && !valid ? "text-destructive" : "text-muted-foreground"}`}>
              Lowercase letters, numbers and hyphens, up to 80 characters.
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Description <span className="text-muted-foreground">(optional)</span></span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, CHAT_MAX_DESCRIPTION))}
              rows={2}
              className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[15px] pointer-coarse:text-[17px]"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-[13px] font-medium">Make private</span>
              <span className="block text-[12px] text-muted-foreground">Only people you add can see it.</span>
            </span>
            <input type="checkbox" role="switch" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="size-5 accent-[var(--primary)]" />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || saving}>{saving ? "Creating…" : "Create"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
