"use client";

import { ArrowDown } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";

/**
 * Shown while you're scrolled up: a thin bar between the list and the composer, in the layout
 * (not floating over the list), so it never covers a message or its reactions.
 */
export function LatestBar({ onClick, unseen, label }: { onClick: () => void; unseen: number; label: string }) {
  return (
    <div className="flex flex-none justify-center border-t border-border bg-card px-3 py-1">
      <Button type="button" variant="ghost" size="sm" onClick={onClick} aria-label={unseen ? `${label}, ${unseen} new` : label} className="text-primary pointer-coarse:h-11">
        <ArrowDown size={16} aria-hidden="true" />
        {label}
        {unseen ? <span className="nb-tab-count">{unseen > 99 ? "99+" : unseen}</span> : null}
      </Button>
    </div>
  );
}
