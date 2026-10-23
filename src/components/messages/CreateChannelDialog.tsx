"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/lib/feedback";

import { createChannel } from "@/app/actions/chat/channels";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
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
    // A new private channel has only you in it: open its members so you can add people.
    router.push(conversationHref(result.channelId, isPrivate ? { details: "members" } : {}));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Create channel</DialogTitle>
          <DialogDescription>{projectTitle ? <>In <span className="font-medium text-foreground">{projectTitle}</span>. </> : null}Channels are where your project talks about a topic.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {allView && projects.length > 1 ? (
            <div className="space-y-1.5">
              <span id="create-channel-project" className="text-[13px] font-medium">Project</span>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger aria-labelledby="create-channel-project" className="pointer-coarse:h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. design" maxLength={80} autoFocus aria-invalid={name.length > 0 && !valid} aria-describedby="chat-channel-name-hint" />
            <span id="chat-channel-name-hint" className={`block text-[13px] ${name && !valid ? "text-destructive" : "text-muted-foreground"}`}>
              {/* Show the name it'll really get ("Design Team" becomes #design-team). */}
              {name.trim() && valid && normalized !== name.trim() ? <>Will be created as <span className="font-mono text-foreground">#{normalized}</span>.</> : "Lowercase letters, numbers and hyphens, up to 80 characters."}
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium">Description <span className="text-muted-foreground">(optional)</span></span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, CHAT_MAX_DESCRIPTION))}
              rows={2}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-[15px] outline-none focus:border-ring pointer-coarse:text-[17px]"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span id="create-channel-private" className="block text-[13px] font-medium">Make private</span>
              <span className="block text-[13px] text-muted-foreground">Only people you add can see it.</span>
            </span>
            <SettingsSwitch aria-labelledby="create-channel-private" checked={isPrivate} onCheckedChange={setPrivate} />
          </div>
          <DialogFooter paper>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || saving}>{saving ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
