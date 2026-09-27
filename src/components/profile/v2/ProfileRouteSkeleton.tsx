import { Skeleton } from "@/components/ui/skeleton";

export function ProfileRouteSkeleton() {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-label="Loading profile"
            className="min-h-full bg-background text-foreground"
        >
            <span className="sr-only">Loading profile…</span>
            <div aria-hidden="true" className="mx-auto max-w-[1060px] px-4 py-6 sm:px-6">
                <div className="space-y-5">
                    {/* Full-width header matching ProfileHeader geometry */}
                    <header className="rounded-lg border border-border bg-card p-6 shadow-none">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex gap-4">
                                <Skeleton className="size-[72px] shrink-0 rounded-[4px]" />
                                <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Skeleton className="h-7 w-48 rounded-[4px]" />
                                        <Skeleton className="h-4 w-24 rounded-[3px]" />
                                        <Skeleton className="h-5 w-32 rounded-full" />
                                    </div>
                                    <Skeleton className="h-4 w-80 max-w-full rounded-[3px]" />
                                    <div className="flex flex-wrap items-center gap-3 pt-1">
                                        <Skeleton className="h-3.5 w-24 rounded-[3px]" />
                                        <Skeleton className="h-3.5 w-28 rounded-[3px]" />
                                        <Skeleton className="h-3.5 w-20 rounded-[3px]" />
                                    </div>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 pt-1">
                                <Skeleton className="h-9 w-24 rounded-md" />
                                <Skeleton className="h-9 w-9 rounded-md" />
                            </div>
                        </div>
                    </header>

                    {/* Main content grid: Left Column (tabs + main) + Right Rail (320px) */}
                    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6 lg:items-start">
                        <div className="space-y-6 lg:min-w-0">
                            {/* Tabs shell */}
                            <div className="flex items-center gap-2 border-b border-border pb-px">
                                <Skeleton className="h-9 w-24 rounded-t-md" />
                                <Skeleton className="h-9 w-24 rounded-t-md" />
                            </div>

                            {/* About card */}
                            <section className="rounded-lg border border-border bg-card p-5 space-y-3">
                                <Skeleton className="h-5 w-24 rounded-[3px]" />
                                <Skeleton className="h-4 w-full rounded-[3px]" />
                                <Skeleton className="h-4 w-5/6 rounded-[3px]" />
                                <Skeleton className="h-4 w-4/6 rounded-[3px]" />
                            </section>

                            {/* Projects / Highlights section */}
                            <section className="rounded-lg border border-border bg-card p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <Skeleton className="h-5 w-32 rounded-[3px]" />
                                    <Skeleton className="h-4 w-16 rounded-[3px]" />
                                </div>
                                <div className="space-y-3">
                                    <Skeleton className="h-28 w-full rounded-lg border border-border" />
                                    <Skeleton className="h-28 w-full rounded-lg border border-border" />
                                </div>
                            </section>
                        </div>

                        {/* Right rail */}
                        <aside className="space-y-6 lg:min-w-0">
                            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                                <Skeleton className="h-4 w-28 rounded-[3px]" />
                                <div className="flex flex-wrap gap-1.5">
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <Skeleton key={i} className="h-6 w-16 rounded-[4px]" />
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                                <Skeleton className="h-4 w-24 rounded-[3px]" />
                                <Skeleton className="h-10 w-full rounded-md" />
                                <Skeleton className="h-10 w-full rounded-md" />
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
