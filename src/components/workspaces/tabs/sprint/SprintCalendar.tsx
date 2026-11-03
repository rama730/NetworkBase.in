"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { readCalendarAction, readCalendarLinkAction } from "@/app/actions/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/feedback";

// Calendar (report §33.5, "Later"): a view on Sprints of the viewer's own due work and the sprints here, by week, and a
// private link for Google or Apple Calendar.

const DAY = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const weekOf = (iso: string) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
};

export function SprintCalendarButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Calendar</Button>
      {open ? <SprintCalendar projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SprintCalendar({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["sprint-calendar", projectId], queryFn: () => readCalendarAction(projectId), staleTime: 60_000 });
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const entries = query.data?.success ? query.data.entries : [];
  const weeks = [...Map.groupBy(entries, (e) => weekOf(e.start))];
  const getLink = (reset: boolean) => startTransition(async () => {
    const r = await readCalendarLinkAction(reset);
    if (!r.success) return void toast.error(r.error);
    setLink(r.url);
    try { await navigator.clipboard.writeText(r.url); toast.success(reset ? "New link copied. The old one stopped working." : "Calendar link copied"); } catch { /* shown below to copy by hand */ }
  });
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Calendar</DialogTitle>
          <DialogDescription>Your own due work and the sprints here, for the next four months.</DialogDescription>
        </DialogHeader>
        {query.isPending ? <div className="nb-skeleton h-24 rounded-md" aria-label="Loading calendar" /> : weeks.length === 0 ? <p className="text-sm text-muted-foreground">Nothing coming up.</p> : (
          <ol className="space-y-3 text-sm">
            {weeks.map(([week, items]) => (
              <li key={week}>
                <p className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Week of {DAY.format(new Date(week))}</p>
                <ul className="mt-1 space-y-1">
                  {items.map((e) => (
                    <li key={`${e.kind}-${e.id}`} className="flex flex-wrap justify-between gap-2">
                      <Link href={e.href} className="min-w-0 truncate hover:underline">{e.kind === "due" ? `Due: ${e.title}` : e.title}</Link>
                      <span className="shrink-0 text-muted-foreground">{e.kind === "due" ? `${DAY.format(new Date(e.start))} ${TIME.format(new Date(e.start))}` : `${DAY.format(new Date(e.start))}–${DAY.format(new Date(e.end ?? e.start))}`}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <section className="space-y-2 border-t border-border pt-3 text-sm">
          <p className="font-medium">Add to your calendar</p>
          <p className="text-[13px] text-muted-foreground">A private link for Google or Apple Calendar. Anyone with it can see your dates, so keep it to yourself.</p>
          {link ? <p className="break-all rounded-md bg-muted px-2 py-1 font-mono text-[12px]">{link}</p> : null}
          <span className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={() => getLink(false)}>Copy link</Button>
            {link ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => getLink(true)}>Make a new link</Button> : null}
          </span>
        </section>
      </DialogContent>
    </Dialog>
  );
}
