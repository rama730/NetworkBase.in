"use client";

import Link from "next/link";

import { buildWorkspaceSprintDetailHref, type SprintDetailPayload, type SprintHealthSummary, type SprintListItem } from "@/lib/workspaces/sprint-detail";
import { paceLine, PHASE_WORDS, sprintPhase, sprintTime, weekOf, withGaps, workProgress } from "@/lib/workspaces/sprint-plan";
import type { SprintWords } from "@/lib/organizations/sprint-words";
import { cn } from "@/lib/utils";

// Sprint redesign (2026-11-09): a Unit's (or Phase's) page opens with its numbers in one row — time, work done with
// the pace and why, open assignments, teams without a sprint — then its Weeks, one bar each, gaps marked. It replaced
// the "Sprints in CO1" strip and its "Across CO1" line.

type Child = NonNullable<SprintDetailPayload["children"]>[number];
const SHORT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const short = (iso: string) => SHORT.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

export function SprintInsights({ main, words, projectSlug, sprints, summary, openAssignments = 0, teamsWithoutSprint = 0 }: {
  main: SprintListItem; words: SprintWords; projectSlug: string; sprints: Child[]; summary: SprintHealthSummary | null; openAssignments?: number; teamsWithoutSprint?: number;
}) {
  const inner = words.inner.toLowerCase();
  const time = sprintTime(main);
  const running = sprintPhase(main) === "running";
  const work = workProgress(summary ?? { totalTasks: 0, completedTasks: 0, totalStoryPoints: 0, completedStoryPoints: 0 });
  const tiles = [
    { label: running && weekOf(main) ? `Time · ${weekOf(main)}` : "Time", value: running && time ? `${time.percent}%` : PHASE_WORDS[sprintPhase(main)].label, bar: running ? time?.percent ?? 0 : null },
    { label: `${work.unit === "points" ? "Points" : "Tasks"} done · ${work.done} of ${work.total}`, value: `${work.percent}%`, bar: work.percent,
      note: running && time && work.total ? paceLine(time.percent, work.percent) : null, behind: running && time ? time.percent - work.percent > 15 : false },
    { label: "Assignments open", value: String(openAssignments) },
    { label: "Teams without a sprint", value: String(teamsWithoutSprint), link: teamsWithoutSprint ? { href: "#sprint-teams-heading", text: "See who" } : null },
  ];
  return (
    <section aria-label={`${main.name} at a glance`} className="mb-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-md bg-muted p-3">
            <p className="text-[12px] text-muted-foreground">{tile.label}</p>
            <p className="text-[20px] font-semibold leading-tight text-foreground">{tile.value}</p>
            {"bar" in tile && tile.bar != null ? (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-background" role="img" aria-label={`${tile.bar}%`}><div className="h-full bg-primary" style={{ width: `${Math.min(100, tile.bar)}%` }} /></div>
            ) : null}
            {"note" in tile && tile.note ? <p className={cn("mt-1 text-[12px]", tile.behind ? "text-[var(--status-danger)]" : "text-muted-foreground")}>{tile.note}</p> : null}
            {"link" in tile && tile.link ? <a href={tile.link.href} className="nb-link mt-1 inline-block text-[12px]">{tile.link.text}</a> : null}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 id="sprint-inside-heading" className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">{words.inner}s in {main.name}</h3>
        {!sprints.length ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground">No {inner}s inside {main.name} yet. Split it into {inner}s with New sprint.</p>
        ) : (
          <ol className="space-y-1.5" aria-label={`${words.inner}s in ${main.name}`}>
            {withGaps(sprints).map((entry) => {
              if (entry.type === "gap") {
                return <li key={`gap-${entry.from}`} className="px-3 text-[12px] text-[var(--status-danger)]">Gap · {short(entry.from)}–{short(entry.to)} · no {inner} planned</li>;
              }
              const child = entry.sprint;
              const phase = sprintPhase(child);
              const percent = child.total ? Math.round((child.done / child.total) * 100) : 0;
              return (
                <li key={child.id}>
                  <Link href={buildWorkspaceSprintDetailHref(projectSlug, child.id, { sprintCode: child.code })}
                    className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[13px] transition-colors hover:bg-muted",
                      phase === "running" ? "border-primary bg-card" : "border-border bg-card")}>
                    <span className="min-w-0 truncate"><span className="font-medium text-foreground">{child.name}</span>
                      <span className="text-muted-foreground"> · {child.startDate && child.endDate ? `${short(child.startDate)}–${short(child.endDate)}` : ""}</span></span>
                    <span className="font-mono text-[12px] text-muted-foreground">{child.total ? `${child.done}/${child.total} done` : PHASE_WORDS[phase].label}</span>
                    <span className="col-span-2 h-1 overflow-hidden rounded-sm bg-muted" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
