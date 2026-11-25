"use client";

import { ArrowDown } from "lucide-react";
import { padCount } from "@/lib/messaging/mix-format";


/**
 * Shown while you're scrolled up: a thin bar between the list and the composer, in the layout
 * (not floating over the list), so it never covers a message or its reactions.
 */
export function LatestBar({ onClick, unseen, label }: { onClick: () => void; unseen: number; label: string }) {
  return (
    <div className="nbm-latest">
      <button type="button" onClick={onClick} aria-label={unseen ? `${label}, ${unseen} new` : label}>
        <ArrowDown size={16} aria-hidden="true" />
        {label}
        {unseen ? <span className="nbm-count hot" aria-hidden="true">{padCount(unseen)}</span> : null}
      </button>
    </div>
  );
}
