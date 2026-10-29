"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";

import { clearProjectStatus, setProjectStatus } from "@/app/actions/presence";
import { EmojiChoice } from "@/components/presence/EmojiChoice";
import { StatusInline } from "@/components/presence/StatusInline";
import { useRefreshPresence } from "@/components/presence/useMyPresence";
import { useProjectPresence } from "@/components/presence/usePresence";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PROJECT_STATUS_SUGGESTIONS, STATUS_TEXT_MAX, clearAfterToDate } from "@/lib/presence/model";

function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The project's status in its header: any emoji + text, Slack style. Owners
 * and admins open it to set or clear; everyone else just sees it.
 */
export function ProjectStatusControl({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const presence = useProjectPresence(projectId);
  const refresh = useRefreshPresence();
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [until, setUntil] = useState("");

  const chip = presence.status ? (
    <span className="inline-flex h-7 items-center rounded-full bg-muted px-3 text-[13px] font-semibold text-foreground">
      <StatusInline emoji={presence.status.emoji} text={presence.statusText} />
    </span>
  ) : null;

  if (!canManage) return chip;

  const start = () => {
    setEmoji(presence.status?.emoji ?? null);
    setText(presence.status?.text ?? "");
    setUntil(presence.status?.expiresAt ? localInput(new Date(presence.status.expiresAt)) : "");
    setOpen(true);
  };

  const save = async () => {
    if (!emoji && !text.trim()) return void toast.error("Add an emoji or some text");
    const result = await setProjectStatus({ projectId, emoji, text: text.trim() || null, expiresAt: until ? new Date(until).toISOString() : null });
    if (!result.success) return void toast.error(feedbackError(result.error === "forbidden" ? "Only owners and admins can set the workspace status" : "Couldn’t set the project status. Check the end time.", "Couldn’t set the project status. Check the end time."));
    await refresh();
    setOpen(false);
    toast.success("Workspace status updated");
  };

  const clear = async () => {
    const result = await clearProjectStatus({ projectId });
    if (!result.success) return void toast.error("Couldn’t clear the team status");
    await refresh();
    setOpen(false);
    toast.success("Workspace status cleared");
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        aria-label={presence.status ? `Project status: ${presence.statusLine}. Change` : "Set project status"}
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {chip ?? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <Smile size={14} aria-hidden="true" />
            Set project status
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Removed</DialogTitle>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex min-h-12 items-center gap-2 rounded-lg border-2 border-input px-1.5 focus-within:border-primary">
              <EmojiChoice value={emoji} onChange={setEmoji} />
              <input
                value={text}
                maxLength={STATUS_TEXT_MAX}
                onChange={(event) => setText(event.target.value)}
                placeholder="What’s the team doing?"
                aria-label="Removed"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Suggestions</span>
              {PROJECT_STATUS_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.text}
                  type="button"
                  onClick={() => {
                    setEmoji(suggestion.emoji);
                    setText(suggestion.text);
                    const end = suggestion.clearAfter === "custom"
                      ? (() => { const week = new Date(); week.setDate(week.getDate() + 7); week.setHours(23, 59, 0, 0); return week; })()
                      : clearAfterToDate(suggestion.clearAfter);
                    setUntil(end ? localInput(end) : "");
                  }}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-left hover:bg-muted"
                >
                  <span aria-hidden="true" className="w-7 text-center font-[system-ui] text-[20px]">{suggestion.emoji}</span>
                  <span className="text-[15px] font-medium">{suggestion.text}</span>
                </button>
              ))}
            </div>
            <label className="block text-[13px] font-medium">
              Until (optional)
              <input
                type="datetime-local"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-[15px]"
              />
            </label>
            <div className="flex items-center gap-2">
              {presence.status ? (
                <button type="button" onClick={() => void clear()} className="h-11 rounded-lg border border-border px-4 text-[14px] font-semibold hover:bg-muted">Clear status</button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} className="ml-auto h-11 rounded-lg border border-border px-4 text-[14px]">Cancel</button>
              <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-[14px] font-semibold text-primary-foreground">Save</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
