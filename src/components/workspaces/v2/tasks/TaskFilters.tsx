"use client";

import { ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { BoardCounts } from "@/lib/workspaces/server/tasks";
import { cn } from "@/lib/utils";

export type TaskFilterScope = "all" | "backlog" | "sprint" | "review" | "assignments" | "mine";

interface TaskFiltersProps {
  scope: TaskFilterScope;
  setScope?: (scope: TaskFilterScope) => void;
  /** An organization's board adds Assignments and Mine (report §16.1). */
  organization?: boolean;
  /** Board/review report §6: the running sprint's full name beside Sprint ("CO1 · Week 3–4"). */
  sprintLabel?: string | null;
  /** Board view dropdown §3: each view's open number (grey) and what needs you now (orange). */
  counts?: BoardCounts | null;
}

const options: Array<{ value: TaskFilterScope; label: string; orgOnly?: boolean; after?: boolean }> = [
  { value: "all", label: "All tasks" },
  { value: "sprint", label: "Sprint" },
  { value: "backlog", label: "Backlog" },
  { value: "review", label: "In review", after: true },
  { value: "assignments", label: "Assignments", orgOnly: true },
  { value: "mine", label: "Mine", orgOnly: true },
];

const orange = "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] bg-primary px-1 text-[11px] font-medium tabular-nums text-primary-foreground";

/**
 * Board view dropdown §2: the six views as one View button, so search, View, Code editor and New task share one line.
 * The button names the view you're on and, in orange, how much needs you in the other views; the menu lists every view
 * with its open number (grey) and what needs you (orange). Phones get the same list as a sheet from the bottom.
 */
export default function TaskFilters({ scope, setScope, organization = false, sprintLabel, counts }: TaskFiltersProps) {
  const phone = useMediaQuery("(max-width: 639px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  const shown = options.filter((option) => organization || !option.orgOnly);
  const labelOf = (value: TaskFilterScope) => (value === "sprint" && sprintLabel ? `Sprint · ${sprintLabel}` : shown.find((o) => o.value === value)?.label ?? "All tasks");
  const elsewhere = counts ? shown.filter((o) => o.value !== scope).reduce((sum, o) => sum + counts[o.value].needsYou, 0) : 0;
  const spoken = (value: TaskFilterScope) => {
    const c = counts?.[value];
    return c ? `, ${c.open} open${c.needsYou ? `, ${c.needsYou} ${value === "review" ? "waiting for you" : "need you"}` : ""}` : "";
  };
  const pick = (value: TaskFilterScope) => { setScope?.(value); setSheetOpen(false); };
  const row = (value: TaskFilterScope) => {
    const c = counts?.[value];
    return (
      <>
        <span className="min-w-0 flex-1 truncate">{labelOf(value)}</span>
        <span className="sr-only">{spoken(value)}</span>
        {c?.needsYou ? <span aria-hidden="true" className={orange}>{c.needsYou}</span> : null}
        {c ? <span aria-hidden="true" className="w-6 text-right text-xs tabular-nums text-muted-foreground">{c.open}</span> : null}
      </>
    );
  };

  const trigger = (
    <button type="button" aria-label={`Show: ${labelOf(scope)}${elsewhere ? `. ${elsewhere} in other views need you` : ""}`} onClick={phone ? () => setSheetOpen(true) : undefined}
      className="nb-touch-target inline-flex h-[34px] max-w-[20rem] items-center gap-2 rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:h-11 max-sm:w-full max-sm:max-w-none">
      <span className="min-w-0 flex-1 truncate text-left">{labelOf(scope)}</span>
      {elsewhere ? <span aria-hidden="true" className={orange}>{elsewhere}</span> : null}
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
          <DialogContent presentation="bottom-sheet" className="gap-0 p-0">
            <DialogTitle className="px-4 pb-2 pt-4 text-sm font-medium">Show</DialogTitle>
            <div role="radiogroup" aria-label="Show" className="pb-3">
              {shown.map((o) => (
                <div key={o.value}>
                  {o.after ? <div className="my-1 h-px bg-border" /> : null}
                  <button type="button" role="radio" aria-checked={o.value === scope} onClick={() => pick(o.value)}
                    className={cn("flex min-h-11 w-full items-center gap-2 rounded-[3px] px-4 text-left text-sm", o.value === scope ? "bg-muted font-medium text-foreground" : "text-foreground hover:bg-muted/50")}>
                    {row(o.value)}
                  </button>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuRadioGroup value={scope} onValueChange={(value) => pick(value as TaskFilterScope)} aria-label="Show">
          {shown.map((o) => (
            <Fragment key={o.value}>
              {o.after ? <DropdownMenuSeparator /> : null}
              <DropdownMenuRadioItem value={o.value} className="gap-2 text-xs font-medium">{row(o.value)}</DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
