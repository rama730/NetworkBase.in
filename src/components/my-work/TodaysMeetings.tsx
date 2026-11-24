"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import Link from "next/link";

import { readMyMeetingsTodayAction } from "@/app/actions/meeting-feed";
import { queryKeys } from "@/lib/query-keys";

/** Report 38.11 part 8 (plan A4.1b): My work's meetings today (the ones you attend), in your own time. Hidden when none. */
export function TodaysMeetings() {
  const query = useQuery({
    queryKey: queryKeys.myWork.meetingsToday(),
    queryFn: () => { const s = new Date(); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setDate(e.getDate() + 1); return readMyMeetingsTodayAction({ from: s.toISOString(), to: e.toISOString() }); },
    staleTime: 60_000,
  });
  const meetings = query.data?.success ? query.data.meetings : [];
  if (!meetings.length) return null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <section aria-label="Today’s meetings" className="space-y-1 px-1 pb-2" data-testid="my-work-meetings">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold"><CalendarClock aria-hidden="true" className="size-3.5" />Today’s meetings</h3>
      <ul className="space-y-1">
        {meetings.map((m) => (
          <li key={m.href}>
            <Link href={m.href} className="flex items-center gap-2 rounded-[5px] border border-border bg-card px-2 py-1.5 text-[13px] hover:bg-muted">
              <span className="font-mono text-[12px] text-muted-foreground">{time(m.startsAt)}</span>
              <span className={m.finished ? "min-w-0 flex-1 truncate text-muted-foreground" : "min-w-0 flex-1 truncate"}>{m.title}</span>
              <span className="truncate text-[11px] text-muted-foreground">{m.workspace}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
