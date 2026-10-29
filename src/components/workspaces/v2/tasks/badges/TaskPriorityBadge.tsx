import { cn } from "@/lib/utils";
import { getTaskPriorityLabel } from "@/lib/workspaces/task-presentation";
import { getTaskPriorityPresentation } from "@/lib/workspaces/task-workflow";

interface TaskPriorityBadgeProps {
    priority: string;
    className?: string;
}

export default function TaskPriorityBadge({ priority, className }: TaskPriorityBadgeProps) {
    const presentation = getTaskPriorityPresentation(priority);

    return (
        <span className={cn(
            "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none inline-flex items-center whitespace-nowrap",
            presentation.badgeClassName,
            className
        )}>
            {getTaskPriorityLabel(priority)}
        </span>
    );
}
