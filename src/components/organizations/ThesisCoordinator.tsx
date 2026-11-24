"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { readThesisCoordinatorAction } from "@/app/actions/thesis-coordinator";
import { StatusBadge } from "@/components/organizations/org-ui";

// Report 30.6 W5 (plan B1.8c): the coordinator's Theses table — numbers and states only, flags in words.
const NUM = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export function ThesisCoordinator({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["thesis-coordinator", orgId], queryFn: () => readThesisCoordinatorAction(orgId), staleTime: 60_000 });
  const rows = q.data?.success ? q.data.rows : [];
  if (!rows.length) return null;
  return (
    <section aria-label="Theses" className="mb-5 space-y-2" data-testid="thesis-coordinator">
      <h2 className="nb-section-title">Theses <span className="nb-meta font-mono">{rows.length}</span></h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border text-[12px] text-muted-foreground">
            <tr><th scope="col" className="px-3 py-2 font-medium">Student</th><th scope="col" className="px-3 py-2 font-medium">Title</th><th scope="col" className="px-3 py-2 font-medium">Supervisor</th>
              <th scope="col" className="px-3 py-2 font-medium">Milestone</th><th scope="col" className="px-3 py-2 font-medium">Words</th><th scope="col" className="px-3 py-2 font-medium">Last supervision</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.workspaceId} className="border-b border-border last:border-b-0" data-testid="thesis-row">
                <td className="px-3 py-2">{r.student ?? "—"}</td>
                <td className="max-w-[260px] truncate px-3 py-2"><Link href={`/workspaces/${encodeURIComponent(r.slug ?? r.workspaceId)}`} className="hover:underline">{r.title}</Link></td>
                <td className="px-3 py-2">{r.supervisor ?? <StatusBadge state="at_risk">No supervisor</StatusBadge>}</td>
                <td className="px-3 py-2">{r.milestone ? <span className="inline-flex items-center gap-1.5">{r.milestone.title}{r.milestone.due ? ` · due ${DAY.format(new Date(r.milestone.due))}` : ""}{r.milestone.overdue ? <StatusBadge state="late">Overdue</StatusBadge> : null}</span> : "—"}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{NUM.format(r.words)} / {NUM.format(r.target)}</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5">{r.lastSupervision ? DAY.format(new Date(`${r.lastSupervision}T12:00:00Z`)) : "None yet"}
                  {r.noSupervision ? <StatusBadge state="at_risk">{r.daysSince != null ? `${r.daysSince} days` : "No supervision yet"}</StatusBadge> : null}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
