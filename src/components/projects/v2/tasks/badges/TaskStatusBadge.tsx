import { cn } from "@/lib/utils";
import { getTaskStatusLabel } from "@/lib/projects/task-presentation";
import { getTaskStatusPresentation } from "@/lib/projects/task-workflow";

interface TaskStatusBadgeProps {
    status: string;
    reviewStatus?: string | null;
    className?: string;
}

export default function TaskStatusBadge({ status, reviewStatus, className }: TaskStatusBadgeProps) {
    const presentation = getTaskStatusPresentation(status);

    return (
        <span className={cn(
            "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none inline-flex items-center whitespace-nowrap",
            reviewStatus === "pending" ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" : presentation.badgeClassName,
            className
        )}>
            {reviewStatus === "pending" ? "In review" : getTaskStatusLabel(status)}
        </span>
    );
}
