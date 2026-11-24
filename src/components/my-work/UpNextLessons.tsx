"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import Link from "next/link";

import { readMyUpNextAction } from "@/app/actions/learning-path";
import { queryKeys } from "@/lib/query-keys";

/** Report 38.18 part 9 (plan A7.7): My work's "Up next: Loops · Basics", one row per learning path. Hidden when none. */
export function UpNextLessons() {
  const query = useQuery({ queryKey: [...queryKeys.myWork.goalCheckIns(), "up-next-lessons"], queryFn: () => readMyUpNextAction(), staleTime: 60_000 });
  const rows = query.data?.success ? query.data.items : [];
  if (!rows.length) return null;
  return (
    <section aria-label="Up next on your learning paths" className="space-y-1 px-1 pb-2" data-testid="my-work-up-next">
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.workspaceId}>
            <Link href={`/workspaces/${encodeURIComponent(r.slug ?? r.workspaceId)}?tab=sprints`} className="flex items-center gap-2 rounded-[5px] border border-border bg-card px-2 py-1.5 text-[13px] hover:bg-muted">
              <BookOpen aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Up next: {r.lesson} · {r.step}</span>
              <span className="truncate text-[11px] text-muted-foreground">{r.workspaceTitle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
