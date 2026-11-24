"use client";

import { Check, ChevronDown, Plus, SlidersHorizontal, X } from "@/components/ui/icons";
import { useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { chipValue } from "@/lib/workspaces/task-filters";

export type ChipOption = { value: string; label: string; icon?: ReactNode; count?: number };
export type FilterChip = {
  key: string;
  name: string;
  options: ChipOption[];
  selected: string[];
  multi: boolean;
  onChange: (next: string[]) => void;
  /** Behind "+ Filter" until added or set (report 38.4 S5: Priority, Labels, Sprint). */
  extra?: boolean;
};

const CHIP = "nb-touch-target inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[3px] border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:h-11";

/**
 * Report 38.4 S5 (shared part): Assigned to · Type · Due · the tab's own chips · + Filter. A set chip reads "Name: value"
 * with ✕; "Clear all" shows from two set chips. Phones get one Filters button opening a sheet with every chip (W9).
 */
export function FilterChipRow({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  const phone = useMediaQuery("(max-width: 639px)");
  const [added, setAdded] = useState<string[]>([]);
  const [sheet, setSheet] = useState(false);
  const set = chips.filter((c) => c.selected.length);
  const shown = chips.filter((c) => !c.extra || added.includes(c.key) || c.selected.length);
  const more = chips.filter((c) => !shown.includes(c));
  const toggle = (c: FilterChip, value: string) => c.onChange(c.multi ? (c.selected.includes(value) ? c.selected.filter((v) => v !== value) : [...c.selected, value]) : c.selected[0] === value ? [] : [value]);
  const label = (c: FilterChip) => chipValue(c.selected.map((v) => c.options.find((o) => o.value === v)?.label ?? v));

  if (phone) {
    return (
      <>
        <button type="button" onClick={() => setSheet(true)} className={cn(CHIP, "border-border bg-card text-foreground hover:bg-muted max-sm:w-full")} data-testid="filters-button">
          <SlidersHorizontal aria-hidden="true" className="size-3.5" />Filters{set.length ? <span className="font-mono text-[11px] text-muted-foreground">{set.length}</span> : null}
        </button>
        <Dialog open={sheet} onOpenChange={setSheet}>
          <DialogContent presentation="bottom-sheet" className="max-h-[85vh] gap-0 overflow-y-auto p-0">
            <DialogTitle className="px-4 pb-2 pt-4 text-sm font-medium">Filters</DialogTitle>
            {chips.map((c) => (
              <section key={c.key} aria-label={c.name} className="border-t border-border px-4 py-2">
                <h3 className="py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{c.name}</h3>
                {c.options.map((o) => (
                  <button key={o.value} type="button" role={c.multi ? "checkbox" : "radio"} aria-checked={c.selected.includes(o.value)} onClick={() => toggle(c, o.value)}
                    className={cn("flex min-h-11 w-full items-center gap-2 rounded-[3px] px-2 text-left text-sm", c.selected.includes(o.value) ? "bg-muted font-medium" : "hover:bg-muted/50")}>
                    <Check aria-hidden="true" className={cn("size-4 shrink-0", !c.selected.includes(o.value) && "opacity-0")} />
                    {o.icon}<span className="flex-1">{o.label}</span>{o.count !== undefined ? <span className="font-mono text-[11px] text-muted-foreground">{o.count}</span> : null}
                  </button>
                ))}
              </section>
            ))}
            <div className="sticky bottom-0 flex gap-2 border-t border-border bg-card px-4 py-3">
              <button type="button" onClick={onClearAll} disabled={!set.length} className={cn(CHIP, "flex-1 justify-center border-border bg-card text-foreground disabled:opacity-50")}>Clear all</button>
              <button type="button" onClick={() => setSheet(false)} className={cn(CHIP, "flex-1 justify-center border-primary bg-primary text-primary-foreground")}>Done</button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Filters" data-testid="filter-chip-row">
      {shown.map((c) => {
        const value = label(c);
        return (
          <div key={c.key} className={cn("inline-flex shrink-0 items-center rounded-[3px] border", value ? "border-foreground/25 bg-muted" : "border-border bg-card")}>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(CHIP, "border-0 bg-transparent text-foreground hover:bg-muted", value && "pr-1.5")} aria-label={value ? `${c.name}: ${value}` : c.name}>
                  {value ? <><span className="text-muted-foreground">{c.name}:</span> {value}</> : <>{c.name}<ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" /></>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                {c.multi ? c.options.map((o) => (
                  <DropdownMenuCheckboxItem key={o.value} checked={c.selected.includes(o.value)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle(c, o.value)} className="gap-2 text-xs">
                    {o.icon}<span className="flex-1">{o.label}</span>{o.count !== undefined ? <span className="font-mono text-[11px] text-muted-foreground">{o.count}</span> : null}
                  </DropdownMenuCheckboxItem>
                )) : (
                  <DropdownMenuRadioGroup value={c.selected[0] ?? ""} onValueChange={(v) => c.onChange(v ? [v] : [])}>
                    {c.options.map((o) => <DropdownMenuRadioItem key={o.value} value={o.value} className="text-xs">{o.label}</DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {value ? (
              <button type="button" aria-label={`Remove the ${c.name} filter`} onClick={() => { c.onChange([]); setAdded((a) => a.filter((k) => k !== c.key)); }}
                className="nb-touch-target inline-flex h-[34px] items-center pl-0.5 pr-2 text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
            ) : null}
          </div>
        );
      })}
      {more.length ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(CHIP, "border-dashed border-border bg-transparent text-muted-foreground hover:text-foreground")}><Plus aria-hidden="true" className="size-3.5" />Filter</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {more.map((c) => <DropdownMenuItem key={c.key} onSelect={() => setAdded((a) => [...a, c.key])} className="text-xs">{c.name}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {set.length >= 2 ? <button type="button" onClick={onClearAll} className="nb-touch-target h-[34px] px-1 text-xs font-medium text-primary underline-offset-2 hover:underline">Clear all</button> : null}
    </div>
  );
}
