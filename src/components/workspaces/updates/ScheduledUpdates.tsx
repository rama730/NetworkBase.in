"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useState } from "react";

import { cancelScheduledUpdateAction, editScheduledUpdateAction, postScheduledNowAction, readScheduledUpdatesAction } from "@/app/actions/workspace/updates";
import { DateTimeField } from "@/components/organizations/DateTimeField";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export const scheduledKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "scheduled-updates"];
const small = cn(FORM_SECONDARY_CLASS, "h-7 px-2 text-[12px]");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Report 38.17 W2 (A7.4): Scheduled: what waits to post, soonest first; its author edits or posts it now; owners and admins can cancel. */
export function ScheduledUpdates({ projectId, onPosted }: { projectId: string; onPosted: () => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scheduledKey(projectId), queryFn: () => readScheduledUpdatesAction(projectId), staleTime: 30_000 });
  const [editing, setEditing] = useState<{ id: string; content: string; at: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!query.data?.success || !query.data.scheduled.length) return null;
  const { scheduled, me, canManage } = query.data;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function run(id: string, fn: () => Promise<{ success: boolean; error?: string }>, done: string) {
    setBusy(id);
    try {
      const r = await fn();
      if (!r.success) throw new Error(r.error);
      await queryClient.invalidateQueries({ queryKey: scheduledKey(projectId) });
      toast(done);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t do that");
      return false;
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-label="Scheduled updates" className="mb-4 rounded-[8px] border border-border" data-testid="scheduled-updates">
      <h3 className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[12px] font-semibold"><CalendarClock aria-hidden="true" className="size-3.5" />Scheduled <span className="font-mono font-normal text-muted-foreground">{scheduled.length}</span></h3>
      <ul className="divide-y divide-border">
        {scheduled.map((s) => (
          <li key={s.id} className="space-y-1.5 px-3 py-2 text-[13px]" data-testid="scheduled-update">
            <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
              <span className={cn("font-mono", s.failedReason && "text-destructive")}>{s.failedReason ? "Didn’t post" : `Posts ${when(s.publishAt)}`}</span>
              <span>· {s.visibility === "members" ? "Members" : "Public"}</span><span>· {s.authorName}</span>
            </p>
            {s.failedReason ? <p className="text-[12px] text-destructive">{s.failedReason} Edit it to try again at a new time.</p> : null}
            {editing?.id === s.id ? (
              <div className="space-y-2">
                <textarea aria-label="Update text" rows={3} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} className={cn(inputClassName(false), "h-auto py-2")} />
                <DateTimeField id={`sched-${s.id}`} aria-label="Post at" value={editing.at} onChange={(at) => setEditing({ ...editing, at })} timeZone={zone} summary="Posts" />
                <div className="flex gap-2">
                  <button type="button" className={cn(FORM_PRIMARY_CLASS, "h-7 px-3 text-[12px]")} disabled={busy === s.id}
                    onClick={() => void run(s.id, () => editScheduledUpdateAction(projectId, s.id, { content: editing.content, publishAt: new Date(editing.at).toISOString() }), "Saved").then((ok) => { if (ok) setEditing(null); })}>Save</button>
                  <button type="button" className={small} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : <p className="line-clamp-3 whitespace-pre-wrap">{s.content}</p>}
            {editing?.id !== s.id ? (
              <div className="flex gap-2">
                {s.authorId === me ? <button type="button" className={small} onClick={() => setEditing({ id: s.id, content: s.content, at: toLocalInput(s.publishAt) })}>Edit</button> : null}
                {s.authorId === me ? <button type="button" className={small} disabled={busy === s.id} onClick={() => void run(s.id, () => postScheduledNowAction(projectId, s.id), "Posted").then((ok) => { if (ok) onPosted(); })}>Post now</button> : null}
                {s.authorId === me || canManage ? <button type="button" className={small} disabled={busy === s.id} onClick={() => void run(s.id, () => cancelScheduledUpdateAction(projectId, s.id), "Cancelled")}>Cancel</button> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
