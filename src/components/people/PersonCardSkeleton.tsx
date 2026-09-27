import { Skeleton } from "@/components/ui/skeleton";

export function PersonCardSkeleton() {
    return (
        <article
            aria-hidden="true"
            className="flex h-full min-w-0 min-h-[158px] items-center gap-3.5 rounded-lg border border-border bg-card p-4"
        >
            <Skeleton className="size-[54px] shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32 max-w-full rounded-[4px]" />
                <Skeleton className="h-3.5 w-48 max-w-full rounded-[3px]" />
                <Skeleton className="h-3 w-28 max-w-full rounded-[3px]" />
                <div className="flex gap-1.5 pt-1">
                    <Skeleton className="h-5 w-16 rounded-[4px]" />
                    <Skeleton className="h-5 w-14 rounded-[4px]" />
                </div>
            </div>
            <Skeleton className="h-[var(--ui-control-height)] w-20 shrink-0 rounded-md" />
        </article>
    );
}
