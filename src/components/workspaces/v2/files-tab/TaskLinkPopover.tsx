"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTaskTitlePresentation } from "@/lib/workspaces/task-presentation";
import { useTaskLinks, type LinkedTask } from "@/hooks/useTaskLinks";
import { TaskLinkChip } from "./TaskLinkChip";
import { useRouter } from "next/navigation";
import { taskFilesHref } from "@/lib/files/task-navigation";
import { confirmFileNavigation } from "@/lib/files/unsaved-navigation";

export interface TaskLinkPopoverProps {
  projectId: string;
  nodeId: string;
  count: number;
  className?: string;
}

/** Reuse Radix for collision handling, nested scroll, focus and dismissal. */
export function TaskLinkPopover({
  projectId, nodeId, count, className,
}: TaskLinkPopoverProps): React.JSX.Element | null {
  const [isOpen, setIsOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  if (count < 1) return null;
  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Anchor asChild>
        <div ref={anchorRef} className={cn("inline-flex", className)}>
          <TaskLinkChip
            count={count}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            onClick={() => setIsOpen((open) => !open)}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          collisionPadding={12}
          align="start"
          data-testid="task-link-popover"
          aria-label="Linked tasks"
          className="z-[240] flex w-64 max-w-[calc(100vw-24px)] max-h-[min(20rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden rounded-[8px] border border-[#DBD5C8] bg-white shadow-lg dark:border-border dark:bg-card"
          onClick={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            anchorRef.current?.querySelector("button")?.focus();
          }}
        >
          <div className="border-b border-[#DBD5C8] bg-[#F3F0EA] px-3 py-2 dark:border-border dark:bg-card">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#4C5A61] dark:text-muted-foreground">Linked tasks</h4>
          </div>
          <TaskLinkPopoverContent projectId={projectId} nodeId={nodeId} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TaskLinkPopoverContent({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const { tasks, isLoading, error, refresh } = useTaskLinks(projectId, nodeId);
  return (
    <div className="min-h-0 overflow-y-auto">
      {isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-[#6B7880] dark:text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
        </div>
      ) : error ? (
        <div role="alert" className="px-3 py-4 text-center text-xs text-red-500">{error} <button type="button" className="min-h-10 px-2 underline" onClick={() => void refresh()}>Retry</button></div>
      ) : tasks.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-[#6B7880] dark:text-muted-foreground">No linked tasks.</div>
      ) : (
        <ul className="divide-y divide-[#DBD5C8]/40 dark:divide-border">
          {tasks.map((task) => <PopoverTaskRow key={task.taskId} task={task} projectId={projectId} nodeId={nodeId} />)}
        </ul>
      )}
    </div>
  );
}

function PopoverTaskRow({ task, projectId, nodeId }: { task: LinkedTask; projectId: string; nodeId: string }) {
  const presentation = getTaskTitlePresentation(task);
  const router = useRouter();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const href = taskFilesHref(search, task.taskId, nodeId) || `?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(task.taskId)}&panelTab=files`;
  return (
    <li data-testid={`task-link-popover-row-${task.taskId}`}>
      <a
        href={href}
        onClick={event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          if (!confirmFileNavigation(projectId)) return;
          router.push(href, { scroll: false });
        }}
        className="flex min-h-11 items-center gap-2 px-3 py-2 transition-colors hover:bg-[#F3F0EA] focus-visible:outline-[#D14E24] dark:hover:bg-muted"
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-2 shrink-0 rounded-[2px]",
            task.status === "done" && task.reviewStatus !== "pending"
              ? "bg-[#2F6B4F]"
              : task.status === "in_progress"
                ? "bg-[#D14E24]"
                : task.status === "blocked"
                  ? "bg-[#B3261E]"
                  : "bg-[#8E9AA1]",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-xs font-medium text-[#141A1E] dark:text-foreground", presentation.className)} aria-label={presentation.ariaLabel}>{task.title}</span>
          <span className="block font-mono text-[11px] capitalize text-[#6B7880] dark:text-muted-foreground">{task.reviewStatus === "pending" ? "In review" : task.status.replace(/_/g, " ")}</span>
        </span>
      </a>
    </li>
  );
}

export default TaskLinkPopover;
