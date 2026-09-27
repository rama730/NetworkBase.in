"use client";

import { cn } from "@/lib/utils";

interface TaskFiltersProps {
  scope: "all" | "backlog" | "sprint";
  setScope?: (scope: "all" | "backlog" | "sprint") => void;
}

const options = [
  { value: "all", label: "All tasks" },
  { value: "sprint", label: "Sprint" },
  { value: "backlog", label: "Backlog" },
] as const;

export default function TaskFilters({ scope, setScope }: TaskFiltersProps) {
  return (
    <div
      role="group"
      className="inline-flex h-[34px] items-center gap-0.5 rounded-[5px] border border-border bg-muted/30 p-0.5"
      aria-label="Task scope"
    >
      {options.map((option) => {
        const isSelected = scope === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => setScope?.(option.value)}
            className={cn(
              "h-full rounded-[3px] px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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

