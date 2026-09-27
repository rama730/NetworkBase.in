import { Skeleton } from "@/components/ui/skeleton";
import { PersonCardSkeleton } from "@/components/people/PersonCardSkeleton";

export function NetworkRouteSkeleton() {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-label="Loading network"
            className="min-h-full bg-background"
        >
            <span className="sr-only">Loading network…</span>
            <div aria-hidden="true" className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0 space-y-2">
                        <Skeleton className="h-8 w-36 rounded-[5px]" />
                        <Skeleton className="h-4 w-72 max-w-full rounded-[4px]" />
                    </div>
                    <Skeleton className="h-[var(--ui-control-height-lg)] w-full rounded-md sm:w-60" />
                </div>

                <div className="mt-6 flex items-stretch gap-2 border-b border-border pb-px">
                    <Skeleton className="h-9 w-28 rounded-t-md" />
                    <Skeleton className="h-9 w-28 rounded-t-md" />
                    <Skeleton className="h-9 w-28 rounded-t-md" />
                </div>

                <div className="mt-6 grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                    {[1, 2, 3, 4, 5, 6].map((key) => (
                        <PersonCardSkeleton key={key} />
                    ))}
                </div>
            </div>
        </div>
    );
}
