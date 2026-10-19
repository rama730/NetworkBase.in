"use client";

import type { ReactNode } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

/** Shared Discover/Network filter shell: side drawer on desktop, bottom sheet on phones. */
export function FilterPanel({
  open,
  onOpenChange,
  trigger,
  children,
  onClear,
  activeFilters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  children: ReactNode;
  onClear: () => void;
  activeFilters: number;
}) {
  const phone = useMediaQuery("(max-width: 767px)");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        presentation={phone ? "bottom-sheet" : "right-drawer"}
        className={phone ? "" : "gap-0 p-0 sm:max-w-[420px]"}
      >
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="nb-card-title">Filters</DialogTitle>
        </div>
        <div className="app-scroll app-scroll-y min-h-0 flex-1 space-y-6 px-5 py-5">
          {children}
        </div>
        <DialogFooter
          paper
          className="m-0 flex-row justify-between rounded-none sm:justify-between"
        >
          <Button
            type="button"
            variant="ghost"
            onClick={onClear}
            disabled={activeFilters === 0}
            className="pointer-coarse:h-11"
          >
            Clear all
          </Button>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="pointer-coarse:h-11"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
