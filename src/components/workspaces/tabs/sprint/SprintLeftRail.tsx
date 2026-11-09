"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Inbox, Plus } from "lucide-react";

import { buildWorkspaceSprintDetailHref, formatSprintDateRange, type SprintListItem } from "@/lib/workspaces/sprint-detail";
import { nestTerm, PHASE_WORDS, sprintPhase, sprintTime, startsIn, termRail, weekOf, withGaps } from "@/lib/workspaces/sprint-plan";
import { cn } from "@/lib/utils";

// Sprint redesign §5.1, §8.1: the rail is the term — Now, Next, Later, Past — with the gaps nobody planned, and for a
// workspace the backlog work comes from.

interface SprintLeftRailProps {
  projectId?: string;
  projectSlug: string;
  sprints: SprintListItem[];
  selectedSprintId: string | null;
  canCreate: boolean;
  onCreate: () => void;
  /** A workspace plans from its backlog; an organization from its assignments. */
  showBacklog?: boolean;
}

const SHORT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const short = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/** Under a sprint's name: its dates, then where it is in its life. */
function railLines(sprint: SprintListItem) {
  const phase = sprintPhase(sprint);
  const time = sprintTime(sprint);
  const dates = formatSprintDateRange(sprint.startDate, sprint.endDate);
  const wait = startsIn(sprint);
  const note = phase === "running" && time ? `day ${time.day} of ${time.days}`
    : phase === "upcoming" && wait !== null ? (wait === 0 ? "starts today" : `starts in ${wait} ${wait === 1 ? "day" : "days"}`)
      : phase === "ended" ? `ended ${sprint.endDate ? short(sprint.endDate.slice(0, 10)) : ""} · needs closing`
        : PHASE_WORDS[phase].label;
  return { dates, note };
}

export function SprintLeftRail({ projectSlug, sprints, selectedSprintId, canCreate, onCreate, showBacklog = false }: SprintLeftRailProps) {
  const router = useRouter();
  const [pastOpen, setPastOpen] = useState(false);
  // Board/review report §6: an organization's CO holds its sprints; the term lists COs, each with its sprints inside.
  const nested = useMemo(() => nestTerm(sprints), [sprints]);
  const groups = useMemo(() => termRail(nested.top), [nested]);
  const groupContentId = "sprint-group-past";
  const isCollapsed = !pastOpen;
  const href = (sprint: SprintListItem) => buildWorkspaceSprintDetailHref(projectSlug, sprint.id, { sprintCode: sprint.code });
  return (
    <>
      {/* Phones: one native picker, so the selected sprint stays on screen (spec §21). */}
      <div className="flex items-center gap-2 md:hidden">
        <label className="sr-only" htmlFor="sprint-picker">Sprint</label>
        <select id="sprint-picker" value={selectedSprintId ?? ""} onChange={(event) => { const sprint = sprints.find((item) => item.id === event.target.value); if (sprint) router.replace(href(sprint), { scroll: false }); }}
          className="h-11 min-w-0 flex-1 rounded-[5px] border border-border bg-card px-3 text-[16px] text-foreground">
          {!selectedSprintId ? <option value="">Select a sprint</option> : null}
          {groups.map((group) => (
            <optgroup key={group.key} label={group.title}>
              {group.items.flatMap((item) => (item.type === "sprint" ? [
                <option key={item.sprint.id} value={item.sprint.id}>{item.sprint.name}</option>,
                ...(nested.inside.get(item.sprint.id) ?? []).map((child) => <option key={child.id} value={child.id}>{item.sprint.name} · {child.name}</option>),
              ] : []))}
            </optgroup>
          ))}
        </select>
        {canCreate ? (
          <button type="button" onClick={onCreate} aria-label="New sprint" className="inline-flex size-11 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
            <Plus className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <aside aria-label="Sprints" className="w-full min-h-0 overflow-y-auto pr-2 max-md:hidden lg:border-r lg:border-border lg:pr-5 app-scroll app-scroll-y app-scroll-gutter lg:sticky lg:top-[calc(var(--workspace-tabs-height,0px)+1rem)] lg:max-h-[calc(100dvh-var(--workspace-tabs-height,0px)-2rem)]">
        <div className="space-y-4 pb-10">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Term</h2>
            </div>
            {canCreate ? (
              <button type="button" onClick={onCreate}
                className="nb-touch-target nb-ui-label inline-flex h-[34px] w-full items-center justify-center gap-2 rounded-[5px] border border-primary bg-primary px-3 text-primary-foreground transition-[background-color,border-color,transform] duration-150 hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:translate-y-px">
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                New sprint
              </button>
            ) : null}
          </div>
          <nav className="space-y-4" aria-label="Sprints navigation">
            {groups.map((group) => {
              const past = group.key === "past";
              return (
                <section key={group.key} className="space-y-1" aria-labelledby={`sprint-group-title-${group.key}`}>
                  {past ? (
                    <button type="button" id={`sprint-group-title-${group.key}`} onClick={() => setPastOpen(!pastOpen)} aria-expanded={!isCollapsed} aria-controls={groupContentId}
                      className="nb-touch-target flex w-full items-center gap-1.5 rounded-[3px] px-1 py-1 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground hover:text-foreground">
                      {isCollapsed ? <ChevronRight className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />}
                      Past · {group.items.length}
                    </button>
                  ) : (
                    <h3 id={`sprint-group-title-${group.key}`} className="px-1 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">{group.title}</h3>
                  )}
                  {past && isCollapsed ? null : (
                    <ul id={past ? groupContentId : undefined} className="space-y-1">
                      {group.items.map((item) => {
                        if (item.type === "gap") {
                          return (
                            <li key={`gap-${item.from}`} className="px-2.5 py-1.5 text-[12px] text-[var(--status-danger)]">
                              <span className="block font-medium">Gap · {short(item.from)}–{short(item.to)}</span>
                              <span className="block text-muted-foreground">No sprint planned</span>
                            </li>
                          );
                        }
                        const sprint = item.sprint;
                        const isSelected = selectedSprintId === sprint.id;
                        const phase = sprintPhase(sprint);
                        const time = phase === "running" ? sprintTime(sprint) : null;
                        return (
                          <li key={sprint.id}>
                            <Link href={href(sprint)} aria-current={isSelected ? "page" : undefined}
                              className={cn("flex flex-col gap-1 rounded-[5px] border px-2.5 py-2 text-left transition-colors", isSelected ? "border-border bg-muted" : "border-transparent hover:border-border/60 hover:bg-muted/40")}>
                              <span className="flex items-center gap-2 min-w-0">
                                <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-[1px]", phase === "running" ? "bg-[var(--status-success)]" : phase === "ended" ? "bg-[var(--status-warning)]" : phase === "upcoming" ? "bg-primary" : "bg-muted-foreground/50")} />
                                <span className="truncate text-sm font-medium leading-tight text-foreground">{sprint.name}</span>
                              </span>
                              <span className="pl-3.5 font-mono text-[11px] text-muted-foreground">{railLines(sprint).dates}<span className={cn("block", phase === "ended" && "text-[var(--status-warning)]")}>{railLines(sprint).note}</span>
                                {/* Board/review report §6: a CO counts its weeks. */}
                                {nested.inside.get(sprint.id)?.length && phase === "running" && weekOf(sprint) ? <span className="block">{weekOf(sprint)}</span> : null}</span>
                              {time ? (
                                <span className="ml-3.5 block h-1 overflow-hidden rounded-[2px] bg-muted" role="img" aria-label={`${time.percent}% of the time gone`}>
                                  <span className="block h-full bg-primary" style={{ width: `${time.percent}%` }} />
                                </span>
                              ) : null}
                            </Link>
                            {nested.inside.get(sprint.id)?.length ? (
                              <ul aria-label={`Sprints in ${sprint.name}`} className="ml-3.5 mt-1 space-y-0.5 border-l border-border pl-2">
                                {withGaps(nested.inside.get(sprint.id)!).map((entry) => {
                                  if (entry.type === "gap") {
                                    return (
                                      <li key={`gap-${entry.from}`} className="px-2 py-1 text-[12px] text-[var(--status-danger)]">
                                        <span className="block font-medium">Gap · {short(entry.from)}–{short(entry.to)}</span><span className="block text-muted-foreground">No sprint planned</span>
                                      </li>
                                    );
                                  }
                                  const child = entry.sprint;
                                  const childPhase = sprintPhase(child);
                                  const childTime = childPhase === "running" ? sprintTime(child) : null;
                                  return (
                                    <li key={child.id}>
                                      <Link href={href(child)} aria-current={selectedSprintId === child.id ? "page" : undefined}
                                        className={cn("flex flex-col rounded-[5px] px-2 py-1.5 text-left", selectedSprintId === child.id ? "bg-muted" : "hover:bg-muted/40")}>
                                        <span className={cn("truncate text-[13px]", childPhase === "running" ? "font-medium text-foreground" : "text-muted-foreground")}>{child.name}</span>
                                        <span className="font-mono text-[11px] text-muted-foreground">{childTime ? `day ${childTime.day} of ${childTime.days}` : railLines(child).note}</span>
                                      </Link>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </nav>
          {showBacklog ? (
            <Link href="?tab=tasks&taskScope=backlog" className="flex items-start gap-2 border-t border-border px-2.5 pt-3 text-sm hover:text-foreground">
              <Inbox className="mt-0.5 size-3.5 text-muted-foreground" aria-hidden="true" />
              <span><span className="block font-medium">Backlog</span><span className="block text-[12px] text-muted-foreground">Tasks not in a sprint</span></span>
            </Link>
          ) : null}
        </div>
      </aside>
    </>
  );
}
