import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceDetailLoading() {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-label="Loading workspace"
            className="flex h-full min-h-0 w-full flex-col bg-background text-foreground"
        >
            <span className="sr-only">Loading workspace…</span>

            {/* Top full-bleed header matching WorkspaceLayout */}
            <div aria-hidden="true" className="w-full shrink-0 border-b border-border bg-card">
                <div className="mx-auto max-w-[1240px] px-4 py-4 sm:px-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-w-0 items-center gap-3.5">
                            <Skeleton className="size-11 shrink-0 rounded-md border border-border" />
                            <div className="min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <Skeleton className="h-6 w-52 max-w-full rounded-[4px]" />
                                    <Skeleton className="h-4 w-16 rounded-full" />
                                </div>
                                <Skeleton className="h-3.5 w-72 max-w-full rounded-[3px]" />
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            <div className="flex -space-x-1.5">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton key={i} className="size-7 rounded-full border-2 border-card" />
                                ))}
                            </div>
                            <Skeleton className="h-[var(--ui-control-height)] w-20 rounded-md" />
                            <Skeleton className="h-[var(--ui-control-height)] w-9 rounded-md" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Sticky Tab Bar matching WorkspaceLayout tabs */}
            <div aria-hidden="true" className="w-full shrink-0 border-b border-border bg-card">
                <div className="mx-auto flex max-w-[1240px] items-stretch gap-2 overflow-x-auto px-4 sm:px-6">
                    {["Overview", "Documents", "Updates", "Sprints", "Tasks", "Files", "Settings"].map((tab) => (
                        <Skeleton key={tab} className="h-10 w-24 rounded-t-md" />
                    ))}
                </div>
            </div>

            {/* Content pane matching initial dashboard tab */}
            <div aria-hidden="true" className="flex-1 overflow-hidden p-6">
                <div className="mx-auto max-w-[1240px]">
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                        <section className="space-y-6 lg:col-span-8">
                            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
                                <Skeleton className="h-7 w-56 rounded-[4px]" />
                                <div className="space-y-2.5">
                                    <Skeleton className="h-4 w-full rounded-[3px]" />
                                    <Skeleton className="h-4 w-11/12 rounded-[3px]" />
                                    <Skeleton className="h-4 w-4/5 rounded-[3px]" />
                                </div>
                                <div className="grid gap-3 pt-3 sm:grid-cols-2">
                                    <Skeleton className="h-36 rounded-lg border border-border" />
                                    <Skeleton className="h-36 rounded-lg border border-border" />
                                </div>
                            </div>
                        </section>
                        <aside className="space-y-4 lg:col-span-4">
                            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                                <Skeleton className="h-5 w-28 rounded-[3px]" />
                                <Skeleton className="h-3 w-full rounded-[3px]" />
                                <div className="flex justify-between pt-2">
                                    <Skeleton className="h-4 w-12 rounded-[3px]" />
                                    <Skeleton className="h-4 w-12 rounded-[3px]" />
                                    <Skeleton className="h-4 w-12 rounded-[3px]" />
                                </div>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
