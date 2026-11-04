"use client";

import Link from "next/link";

import { buildWorkspaceSprintDetailHref, type SprintDetailPayload, type SprintHealthSummary } from "@/lib/workspaces/sprint-detail";
import { PHASE_WORDS, sprintPhase } from "@/lib/workspaces/sprint-plan";
import { cn } from "@/lib/utils";

// Board/review report §6: a CO's page shows the sprints inside it on one strip, each with its done count, and the CO's
// roll-up across all of them.

type Child = NonNullable<SprintDetailPayload["children"]>[number];

export function SprintInsideStrip({ mainName, projectSlug, sprints, summary, openAssignments = 0, teamsWithoutSprint = 0 }: {
  mainName: string; projectSlug: string; sprints: Child[]; summary: SprintHealthSummary | null; openAssignments?: number; teamsWithoutSprint?: number;
}) {
  if (!sprints.length) {
    return <p className="mb-4 rounded-[6px] border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground">No sprints inside {mainName} yet. Split it into weeks with New sprint.</p>;
  }
  const line = [
    summary ? `${summary.completedTasks} of ${summary.totalTasks} done` : null,
    openAssignments ? `${openAssignments} ${openAssignments === 1 ? "assignment" : "assignments"} open` : null,
    teamsWithoutSprint ? `${teamsWithoutSprint} ${teamsWithoutSprint === 1 ? "team has" : "teams have"} no sprint yet` : null,
  ].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="sprint-inside-heading" className="mb-4 space-y-2">
      <h3 id="sprint-inside-heading" className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Sprints in {mainName}</h3>
      <ol className="flex gap-1" aria-label={`Sprints in ${mainName}`}>
        {sprints.map((child) => {
          const phase = sprintPhase(child);
          return (
            <li key={child.id} className="min-w-0 flex-1">
              <Link href={buildWorkspaceSprintDetailHref(projectSlug, child.id, { sprintCode: child.code })}
                className={cn("block truncate rounded-[4px] border px-2 py-1.5 text-[12px]",
                  phase === "running" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-muted/40 text-muted-foreground hover:text-foreground")}>
                <span className="block truncate font-medium">{child.name}</span>
                <span className="block truncate">{child.total ? `${child.done}/${child.total} done` : PHASE_WORDS[phase].label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      {line ? <p className="text-[13px] text-muted-foreground">Across {mainName}: {line}</p> : null}
    </section>
  );
}
