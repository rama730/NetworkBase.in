import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonDoc() {
    return (
        <div className="relative mx-auto w-full max-w-[1240px] px-0 py-0" role="status" aria-live="polite" aria-label="Loading documents">
            <span className="sr-only">Loading documents…</span>
            <div aria-hidden="true" className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0 space-y-4">
                    <Skeleton className="h-8 w-1/2 rounded-[5px]" />
                    <Skeleton className="h-4 w-full rounded-[4px]" />
                    <Skeleton className="h-4 w-5/6 rounded-[4px]" />
                    <Skeleton className="h-4 w-3/4 rounded-[4px]" />
                    <Skeleton className="my-6 h-36 rounded-[5px] border border-border" />
                    <Skeleton className="h-6 w-1/3 rounded-[5px]" />
                    <Skeleton className="h-4 w-full rounded-[4px]" />
                    <Skeleton className="h-4 w-4/5 rounded-[4px]" />
                </div>
                <aside className="hidden w-full xl:block xl:w-[260px] shrink-0 border-l border-border pl-6">
                    <div className="sticky top-[calc(var(--project-tabs-height,42px)+1rem)] space-y-2">
                        <div className="flex items-center justify-between pb-2">
                            <Skeleton className="h-3.5 w-20 rounded-[3px]" />
                            <Skeleton className="h-4 w-4 rounded-[3px]" />
                        </div>
                        <div className="space-y-1.5">
                            <Skeleton className="h-[34px] w-full rounded-[5px] border border-border" />
                            <Skeleton className="h-[34px] w-full rounded-[5px] border border-border" />
                            <Skeleton className="h-[34px] w-full rounded-[5px] border border-border" />
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
