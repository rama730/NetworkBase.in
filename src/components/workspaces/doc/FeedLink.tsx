"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { newMeetingFeedAction, readMeetingFeedAction, stopMeetingFeedAction } from "@/app/actions/meeting-feed";
import { FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

/** W10 and call 7: your personal, read-only .ics link (shown once; a new one stops the old). */
export function FeedLink() {
  const query = useQuery({ queryKey: queryKeys.myWork.meetingFeed(), queryFn: () => readMeetingFeedAction() });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const has = query.data?.success && query.data.hasLink;
  async function make() {
    setBusy(true);
    const r = await newMeetingFeedAction();
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    const url = `${window.location.origin}${r.path}`;
    setLink(url);
    const { copyText } = await import("@/lib/clipboard");
    try { await copyText(url); toast("Calendar link copied · add it to your calendar app as a subscription"); } catch { toast("Copy the link below into your calendar app"); }
    void query.refetch();
  }
  async function stop() {
    setBusy(true);
    const r = await stopMeetingFeedAction();
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    setLink(null);
    toast("Calendar link stopped");
    void query.refetch();
  }
  return (
    <div className="space-y-1.5 rounded-[8px] border border-border bg-card p-3" data-testid="meeting-feed">
      <p className="text-[13px] font-medium">Your calendar link</p>
      <p className="text-xs text-muted-foreground">Meetings you attend and school events for you, in any calendar app that subscribes to a link. Times and titles only; read-only.{has && !link ? " A link is on; making a new one stops the old." : ""}</p>
      {link ? <input readOnly value={link} aria-label="Your calendar link" onFocus={(e) => e.currentTarget.select()} className={cn(inputClassName(false), "font-mono text-[12px]")} /> : null}
      <div className="flex gap-2">
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void make()}>{has ? "New link" : "Get my link"}</button>
        {has ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void stop()}>Stop the link</button> : null}
      </div>
    </div>
  );
}

