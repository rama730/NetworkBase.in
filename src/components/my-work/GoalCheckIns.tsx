"use client";

import { useQuery } from "@tanstack/react-query";
import { Gauge } from "@/components/ui/icons";
import Link from "next/link";

import { readMyGoalCheckInsAction } from "@/app/actions/goal-checkins";
import { queryKeys } from "@/lib/query-keys";

/** Report 38.12 part 8 (plan A5.1b): My work's "Check in on 3 key results", one row per workspace. Hidden when none. */
export function GoalCheckIns() {
  const query = useQuery({ queryKey: queryKeys.myWork.goalCheckIns(), queryFn: () => readMyGoalCheckInsAction(), staleTime: 60_000 });
  const rows = query.data?.success ? query.data.checkIns : [];
  if (!rows.length) return null;
  return (
    <section aria-label="Key results to check in" className="space-y-1 px-1 pb-2" data-testid="my-work-checkins">
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="flex items-center gap-2 rounded-[5px] border border-border bg-card px-2 py-1.5 text-[13px] hover:bg-muted">
              <Gauge aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Check in on <span className="font-mono">{r.count}</span> key {r.count === 1 ? "result" : "results"}</span>
              <span className="truncate text-[11px] text-muted-foreground">{r.workspace}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
