"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, X, ChevronRight, ChevronDown } from "lucide-react";

import {
  buildProjectSprintDetailHref,
  formatSprintDateRange,
  SPRINT_STATUS_PRESENTATION,
  type SprintListItem,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

interface SprintLeftRailProps {
  projectSlug: string;
  sprints: SprintListItem[];
  selectedSprintId: string | null;
  canCreate: boolean;
  onCreate: () => void;
}

const SPRINT_GROUPS = [
  { status: "active", label: "Current" },
  { status: "planning", label: "Upcoming" },
  { status: "completed", label: "Completed" },
  { status: "cancelled", label: "Canceled" },
  { status: "archived", label: "Archived" },
] as const;

export function SprintLeftRail({
  projectSlug,
  sprints,
  selectedSprintId,
  canCreate,
  onCreate,
}: SprintLeftRailProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    cancelled: true,
    archived: true,
  });

  const toggleGroup = (status: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [status]: !prev[status],
    }));
  };

  // Filter sprints in-memory for instant 1M-user search performance
  const filteredSprints = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sprints;
    return sprints.filter(
      (sprint) =>
        sprint.name.toLowerCase().includes(query) ||
        sprint.code.toLowerCase().includes(query) ||
        (sprint.goal && sprint.goal.toLowerCase().includes(query)),
    );
  }, [sprints, searchQuery]);

  // Group and sort sprints
  const sprintsByStatus = useMemo(() => {
    const grouped = new Map<string, SprintListItem[]>();
    for (const group of SPRINT_GROUPS) grouped.set(group.status, []);
    for (const sprint of filteredSprints) {
      const computedStatus = sprint.status;
      if (grouped.has(computedStatus)) {
        grouped.get(computedStatus)!.push(sprint);
      }
    }
    const timestamp = (value: string | null | undefined) => {
      const parsed = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    };
    const compareNewestFirst = (
      left: SprintListItem,
      right: SprintListItem,
      resolve: (sprint: SprintListItem) => string | null | undefined,
    ) => {
      const difference = timestamp(resolve(right)) - timestamp(resolve(left));
      return Number.isFinite(difference)
        ? difference
        : left.id.localeCompare(right.id);
    };
    const compareEarliestFirst = (
      left: SprintListItem,
      right: SprintListItem,
    ) => {
      const leftDate = timestamp(left.startDate);
      const rightDate = timestamp(right.startDate);
      const difference =
        (leftDate === Number.NEGATIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : leftDate) -
        (rightDate === Number.NEGATIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : rightDate);
      return Number.isFinite(difference)
        ? difference
        : left.id.localeCompare(right.id);
    };
    grouped
      .get("active")
      ?.sort((left, right) =>
        compareNewestFirst(
          left,
          right,
          (sprint) => sprint.startedAt ?? sprint.startDate,
        ),
      );
    grouped.get("planning")?.sort(compareEarliestFirst);
    for (const status of ["completed", "cancelled", "archived"] as const) {
      grouped
        .get(status)
        ?.sort((left, right) =>
          compareNewestFirst(
            left,
            right,
            (sprint) =>
              sprint.completedAt ??
              sprint.cancelledAt ??
              sprint.archivedAt ??
              sprint.updatedAt,
          ),
        );
    }
    return grouped;
  }, [filteredSprints]);

  const hasAnyResults = filteredSprints.length > 0;
  const isFiltering = searchQuery.trim().length > 0;

  return (
    <>
    {/* Phones: one native picker instead of the stacked rail, so the selected sprint stays on screen (spec §21). */}
    <div className="flex items-center gap-2 md:hidden">
      <label className="sr-only" htmlFor="sprint-picker">Sprint</label>
      <select
        id="sprint-picker"
        value={selectedSprintId ?? ""}
        onChange={(event) => {
          const sprint = sprints.find((item) => item.id === event.target.value);
          if (sprint) router.push(buildProjectSprintDetailHref(projectSlug, sprint.id, { sprintCode: sprint.code }));
        }}
        className="h-11 min-w-0 flex-1 rounded-[5px] border border-border bg-card px-3 text-[16px] text-foreground"
      >
        {!selectedSprintId ? <option value="">Select a sprint</option> : null}
        {SPRINT_GROUPS.map((group) => {
          const groupSprints = sprintsByStatus.get(group.status) ?? [];
          return groupSprints.length > 0 ? (
            <optgroup key={group.status} label={group.label}>
              {groupSprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.code}</option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
      {canCreate ? (
        <button
          type="button"
          onClick={onCreate}
          aria-label="New sprint"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-foreground"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
    <aside className="w-full min-h-0 overflow-y-auto pr-2 max-md:hidden lg:border-r lg:border-border lg:pr-5 app-scroll app-scroll-y app-scroll-gutter lg:sticky lg:top-[calc(var(--project-tabs-height,0px)+1rem)] lg:max-h-[calc(100dvh-var(--project-tabs-height,0px)-2rem)]">
      <div className="space-y-4">
        {/* Rail Header */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Sprints
            </span>
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-muted/60 px-1 font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground">
              {sprints.length}
            </span>
          </div>

          {canCreate ? (
            <button
              type="button"
              onClick={onCreate}
              className="nb-touch-target nb-ui-label inline-flex h-[34px] w-full items-center justify-center gap-2 rounded-[5px] border border-primary bg-primary px-3 text-primary-foreground transition-[background-color,border-color,transform] duration-150 hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:translate-y-px active:border-[var(--primary-active)] active:bg-[var(--primary-active)]"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              New sprint
            </button>
          ) : null}

          {/* Quick Search Filter for 1M-user scalability */}
          {sprints.length > 3 ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter sprints…"
                className="nb-touch-target h-[30px] w-full rounded-[5px] border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear filter"
                  className="nb-touch-target absolute right-0 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Sprint Groups List */}
        <nav className="space-y-5 pb-10" aria-label="Sprints navigation">
          {!hasAnyResults && isFiltering ? (
            <div className="nb-empty-state nb-grid-ground p-4 text-center space-y-1.5" role="status">
              <p className="nb-compact text-muted-foreground">
                No sprints matching &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="font-mono text-[11px] uppercase tracking-[0.09em] text-primary hover:underline"
              >
                Clear filter
              </button>
            </div>
          ) : null}

          {SPRINT_GROUPS.map((group) => {
            const groupedSprints = sprintsByStatus.get(group.status) || [];
            if (groupedSprints.length === 0) return null;

            const isCollapsed = !isFiltering && Boolean(collapsedGroups[group.status]);
            const groupContentId = `sprint-group-${group.status}`;

            return (
              <section key={group.status} className="space-y-1">
                {/* Collapsible Group Header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.status)}
                  aria-expanded={!isCollapsed}
                  aria-controls={groupContentId}
                  className="nb-touch-target flex w-full items-center justify-between rounded-[3px] px-1 py-1 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:text-foreground group/header"
                >
                  <span className="flex items-center gap-1.5">
                    {isCollapsed ? (
                      <ChevronRight className="size-3 text-muted-foreground group-hover/header:text-foreground transition-transform" />
                    ) : (
                      <ChevronDown className="size-3 text-muted-foreground group-hover/header:text-foreground transition-transform" />
                    )}
                    <span>{group.label}</span>
                  </span>
                  <span
                    aria-label={`${groupedSprints.length} ${group.label.toLowerCase()} sprints`}
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-muted/60 px-1 font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground"
                  >
                    {groupedSprints.length}
                  </span>
                </button>

                {/* Sprints in Group */}
                {!isCollapsed ? (
                  <div id={groupContentId} className="space-y-1 pt-0.5">
                    {groupedSprints.map((sprint) => {
                      const isSelected = selectedSprintId === sprint.id;
                      const computedStatus = sprint.status;
                      const dateRange = formatSprintDateRange(sprint.startDate, sprint.endDate);

                      return (
                        <Link
                          key={sprint.id}
                          href={buildProjectSprintDetailHref(
                            projectSlug,
                            sprint.id,
                            { sprintCode: sprint.code },
                          )}
                         
                          aria-current={isSelected ? "page" : undefined}
                          className={cn(
                            "group relative flex flex-col gap-1 rounded-[5px] border px-2.5 py-2 text-left transition-colors select-none",
                            isSelected
                              ? "border-border bg-muted font-medium text-foreground shadow-none"
                              : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/40 hover:text-foreground",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "size-1.5 shrink-0 rounded-[1px]",
                                  SPRINT_STATUS_PRESENTATION[computedStatus].dotClassName,
                                )}
                              />
                              <span className="truncate text-sm font-medium leading-tight text-foreground">
                                {sprint.name}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                              {sprint.code}
                            </span>
                          </div>

                          {dateRange ? (
                            <span className="truncate pl-3.5 font-mono text-[10px] max-md:text-[11px] text-muted-foreground">
                              {dateRange}
                            </span>
                          ) : null}

                          {sprint.goal ? (
                            <span className="truncate pl-3.5 text-[11px] text-muted-foreground">
                              {sprint.goal}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>
      </div>
    </aside>
    </>
  );
}
