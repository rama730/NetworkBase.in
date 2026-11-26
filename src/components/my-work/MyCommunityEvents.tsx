"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import Link from "next/link";

import { readMyCommunityEventsAction } from "@/app/actions/community-events";
import { queryKeys } from "@/lib/query-keys";

/** Report 34.4 layer 4 (plan B5.3c): My events — community events you're going to or waiting for, the next 14 days. Hidden when none. */
export function MyCommunityEvents() {
  const query = useQuery({ queryKey: queryKeys.myWork.communityEvents(), queryFn: () => readMyCommunityEventsAction(), staleTime: 60_000 });
  const events = query.data?.success ? query.data.events : [];
  if (!events.length) return null;
  const when = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return (
    <section aria-label="My events" className="space-y-1 px-1 pb-2" data-testid="my-work-events">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold"><CalendarDays aria-hidden="true" className="size-3.5" />My events</h3>
      <ul className="space-y-1">
        {events.map((e) => (
          <li key={e.id}>
            <Link href={e.href} className="flex items-center gap-2 rounded-[5px] border border-border bg-card px-2 py-1.5 text-[13px] hover:bg-muted">
              <span className="font-mono text-[12px] text-muted-foreground">{when(e.start)}</span>
              <span className="min-w-0 flex-1 truncate">{e.title}{e.waitlisted ? <span className="text-muted-foreground"> · Waitlist</span> : null}</span>
              <span className="truncate text-[11px] text-muted-foreground">{e.org}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
