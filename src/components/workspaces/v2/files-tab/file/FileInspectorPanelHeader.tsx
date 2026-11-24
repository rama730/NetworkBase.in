"use client";

import * as React from "react";
import { X } from "lucide-react";

export interface FileInspectorPanelHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
  closeTestId?: string;
}

export function FileInspectorPanelHeader({
  title,
  subtitle,
  onClose,
  closeLabel,
  closeTestId,
}: FileInspectorPanelHeaderProps): React.JSX.Element {
  React.useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2.5">
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {subtitle ? (
          <div className="mt-0.5 min-w-0 text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        data-testid={closeTestId}
        className="-mr-1 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-[#D14E24]"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
