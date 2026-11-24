// Task 5.1 — `TaskLinkChip` component.
//
// Renders a small badge showing the count of tasks linked to a file/folder
// node. Emits `files_tab.task_link_chip_clicked` telemetry on click.
//
// Requirements: 7.1, 7.2, 16.2.
//
// Rendering contract:
//   - Rendered only when `count >= 1` (callers gate on count > 0).
//   - Clicking the chip emits telemetry and forwards the event to the
//     parent via `onClick` so it can open the linked-tasks popover.
"use client";

import * as React from "react";
import { LinkIcon } from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

export interface TaskLinkChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** Number of tasks linked to this node. */
  count: number;
  /** Click handler — parent typically opens a linked-tasks popover. */
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}

/**
 * A compact badge indicating how many tasks are linked to a file or folder.
 * Emits telemetry on click and delegates to the parent's `onClick` handler.
 */
export function TaskLinkChip({
  count,
  onClick,
  className,
  ...props
}: TaskLinkChipProps): React.JSX.Element | null {
  const handleClick = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      logger.metric("files_tab.task_link_chip_clicked", {
        module: "files-tab",
        count,
      });
      onClick(event);
    },
    [count, onClick],
  );

  if (count < 1) return null;

  return (
    <button
      {...props}
      type="button"
      data-testid="files-tab-task-link-chip"
      data-count={count}
      onClick={handleClick}
      aria-label={`${count} linked ${count === 1 ? "task" : "tasks"}`}
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-[3px] border border-[#DBD5C8] bg-[#F3F0EA] px-1.5 font-mono text-[11px] font-semibold tabular-nums text-[#4C5A61]",
        "dark:border-white/10 dark:bg-white/10 dark:text-white/80",
        "cursor-pointer transition-colors hover:border-[#D14E24] hover:bg-[#FCF0EA] hover:text-[#D14E24]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D14E24]",
        className,
      )}
    >
      <LinkIcon className="h-2.5 w-2.5" aria-hidden="true" />
      {count}
    </button>
  );
}

export default TaskLinkChip;
