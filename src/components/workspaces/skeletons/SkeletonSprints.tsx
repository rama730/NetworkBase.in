import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonSprints() {
    return (
        <div role="status" aria-live="polite" aria-label="Loading sprints" className="grid min-h-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
            <span className="sr-only">Loading sprints…</span>

            <aside aria-hidden="true" className="w-full min-h-0 pr-2 lg:border-r lg:border-border lg:pr-5">
                <div className="space-y-4">
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between px-1"><Skeleton className="h-3 w-14 rounded" /><Skeleton className="h-4 w-4 rounded-[3px]" /></div>
                        <Skeleton className="h-[34px] w-full rounded-[5px]" />
                    </div>
                    <div className="space-y-5 pb-10">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between px-1"><Skeleton className="h-3 w-20 rounded" /><Skeleton className="h-4 w-4 rounded-[3px]" /></div>
                            <div className="space-y-1 pt-0.5">
                                <div className="space-y-2 rounded-[5px] border border-border bg-card p-3"><div className="flex items-center justify-between gap-2"><Skeleton className="h-4 w-24 rounded" /><Skeleton className="h-3 w-9 rounded" /></div><Skeleton className="h-3 w-32 max-w-full rounded" /><Skeleton className="h-3 w-20 rounded" /></div>
                                <div className="space-y-2 rounded-[5px] p-3"><Skeleton className="h-4 w-28 rounded" /><Skeleton className="h-3 w-24 rounded" /></div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between px-1"><Skeleton className="h-3 w-16 rounded" /><Skeleton className="h-4 w-4 rounded-[3px]" /></div>
                    </div>
                </div>
            </aside>

            <section aria-hidden="true" className="min-w-0 pb-12">
                <header className="mb-8 flex items-start justify-between gap-4 border-b border-border pb-5">
                    <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-baseline gap-2"><Skeleton className="h-8 w-48 max-w-full rounded" /><Skeleton className="h-5 w-40 max-w-full rounded" /></div>
                        <div className="flex flex-wrap items-center gap-2"><Skeleton className="h-5 w-20 rounded-[3px]" /><Skeleton className="h-4 w-36 rounded" /><Skeleton className="h-4 w-32 rounded" /></div>
                        <Skeleton className="h-4 w-3/4 max-w-3xl rounded" />
                    </div>
                    <div className="flex shrink-0 items-center gap-3"><Skeleton className="h-4 w-12 rounded" /><Skeleton className="h-[34px] w-[72px] rounded-[5px]" /><Skeleton kind="tile" className="size-[34px] rounded-[5px]" /></div>
                </header>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3"><div className="flex flex-wrap items-center gap-3.5"><Skeleton className="h-4 w-16 rounded" /><Skeleton className="h-4 w-20 rounded" /><Skeleton className="h-4 w-16 rounded" /><Skeleton className="h-4 w-32 rounded" /></div><div className="flex items-center gap-2"><Skeleton className="h-1.5 w-24 rounded-[2px]" /><Skeleton className="h-3 w-8 rounded" /></div></div>
                <ul className="overflow-hidden rounded-[8px] border border-border bg-card">
                    {[1, 2, 3, 4].map((item) => <li key={item} className="flex items-center justify-between gap-4 border-b border-border/60 p-4 last:border-b-0"><div className="flex min-w-0 flex-1 items-start gap-4"><Skeleton className="mt-1 size-8 shrink-0 rounded-[5px]" /><div className="min-w-0 flex-1 space-y-2"><div className="flex items-center gap-2"><Skeleton className="h-5 w-16 rounded-[3px]" /><Skeleton className="h-4 w-48 max-w-[55%] rounded" /></div><div className="flex flex-wrap items-center gap-3"><Skeleton className="h-3 w-12 rounded" /><Skeleton className="h-3 w-20 rounded" /><Skeleton className="h-3 w-16 rounded" /></div></div></div><Skeleton className="size-4 shrink-0 rounded" /></li>)}
                </ul>
            </section>
        </div>
    );
}
