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

            {/* Audit 4.4: the same sizes as WorkspaceLayout (full width, 64 px image, control-height tabs), so nothing jumps. */}
            <div aria-hidden="true" className="w-full shrink-0 bg-card">
                <div className="px-4 pb-4 pt-5 sm:px-6 max-md:pt-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <Skeleton kind="tile" className="size-16 shrink-0 rounded-lg border border-border max-md:size-12" />
                            <div className="min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <Skeleton className="h-6 w-52 max-w-full rounded-sm" />
                                    <Skeleton className="h-4 w-16 rounded-sm" />
                                </div>
                                <Skeleton className="h-3.5 w-72 max-w-full rounded-sm" />
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            <div className="flex -space-x-1.5">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton key={i} className="size-7 rounded-md border-2 border-card" />
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
                <div className="flex items-center gap-2 overflow-x-auto px-4 sm:px-6">
                    {["Overview", "About", "Documents", "Updates", "Sprints", "Tasks", "Files", "Members", "Settings"].map((tab) => (
                        <Skeleton key={tab} className="my-1 h-[calc(var(--ui-control-height)-8px)] w-20 shrink-0 rounded-md" />
                    ))}
                </div>
            </div>

            {/* Content pane matching initial dashboard tab */}
            <div aria-hidden="true" className="flex-1 overflow-hidden p-4 sm:p-5">
                <div>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                        <section className="space-y-6 lg:col-span-8">
                            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
                                <Skeleton className="h-7 w-56 rounded-sm" />
                                <div className="space-y-2.5">
                                    <Skeleton className="h-4 w-full rounded-sm" />
                                    <Skeleton className="h-4 w-11/12 rounded-sm" />
                                    <Skeleton className="h-4 w-4/5 rounded-sm" />
                                </div>
                                <div className="grid gap-3 pt-3 sm:grid-cols-2">
                                    <Skeleton className="h-36 rounded-lg border border-border" />
                                    <Skeleton className="h-36 rounded-lg border border-border" />
                                </div>
                            </div>
                        </section>
                        <aside className="space-y-4 lg:col-span-4">
                            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                                <Skeleton className="h-5 w-28 rounded-sm" />
                                <Skeleton className="h-3 w-full rounded-sm" />
                                <div className="flex justify-between pt-2">
                                    <Skeleton className="h-4 w-12 rounded-sm" />
                                    <Skeleton className="h-4 w-12 rounded-sm" />
                                    <Skeleton className="h-4 w-12 rounded-sm" />
                                </div>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
