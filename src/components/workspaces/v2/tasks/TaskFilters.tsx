"use client";

import { cn } from "@/lib/utils";

export type TaskFilterScope = "all" | "backlog" | "sprint" | "review" | "assignments" | "mine";

interface TaskFiltersProps {
  scope: TaskFilterScope;
  setScope?: (scope: TaskFilterScope) => void;
  /** An organization's board adds Assignments and Mine (report §16.1). */
  organization?: boolean;
}

const options: Array<{ value: TaskFilterScope; label: string; orgOnly?: boolean }> = [
  { value: "all", label: "All tasks" },
  { value: "sprint", label: "Sprint" },
  { value: "backlog", label: "Backlog" },
  { value: "review", label: "In review" },
  { value: "assignments", label: "Assignments", orgOnly: true },
  { value: "mine", label: "Mine", orgOnly: true },
];

export default function TaskFilters({ scope, setScope, organization = false }: TaskFiltersProps) {
  return (
    <div
      role="group"
      className="inline-flex h-[34px] items-center gap-0.5 rounded-[5px] border border-border bg-muted/30 p-0.5 max-md:h-11"
      aria-label="Show"
    >
      {options.filter((option) => organization || !option.orgOnly).map((option) => {
        const isSelected = scope === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => setScope?.(option.value)}
            className={cn(
              "h-full rounded-[3px] px-3 text-xs font-medium transition-colors max-md:min-w-11 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isSelected
                ? "border border-border/60 bg-card text-foreground shadow-2xs"
                : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

