import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonUpdates() {
    return (
        <div role="status" aria-live="polite" aria-label="Loading updates" className="mx-auto grid w-full max-w-[1240px] gap-8 xl:grid-cols-[minmax(0,1fr)_440px]">
            <span className="sr-only">Loading updates…</span>
            <main aria-hidden="true" className="min-w-0">
                <div className="px-1 pb-3 pt-2">
                    <Skeleton className="h-6 w-24 rounded-[3px]" />
                    <Skeleton className="mt-2 h-4 w-80 max-w-full rounded-[3px]" />
                </div>
                <div className="flex gap-3 border-b border-border px-1 py-4">
                    <Skeleton kind="tile" className="h-9 w-9 rounded-[5px]" />
                    <Skeleton className="mt-1 h-5 flex-1 rounded-[3px]" />
                </div>
                {Array.from({ length: 2 }).map((_, index) => (
                    <div key={index} className="flex gap-3 border-b border-border px-1 py-5">
                        <Skeleton kind="tile" className="h-9 w-9 rounded-[5px]" />
                        <div className="min-w-0 flex-1 space-y-3">
                            <Skeleton className="h-4 w-1/3 rounded-[3px]" />
                            <Skeleton className="h-14 rounded-[5px]" />
                            <Skeleton className="h-4 w-28 rounded-[3px]" />
                        </div>
                    </div>
                ))}
            </main>
            <aside aria-hidden="true" className="hidden w-full min-w-0 shrink-0 border-l border-border pl-6 xl:block xl:w-[440px]">
                <Skeleton className="h-4 w-24 rounded-[3px]" />
                <div className="mt-4 space-y-3">
                    <Skeleton className="h-10 rounded-[5px]" />
                    <Skeleton className="h-10 rounded-[5px]" />
                    <Skeleton className="h-10 rounded-[5px]" />
                </div>
            </aside>
        </div>
    );
}
