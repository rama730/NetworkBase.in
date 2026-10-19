import { Skeleton } from "@/components/ui/skeleton";

function SkeletonBlock({ className }: { className: string }) {
    return <Skeleton className={`rounded ${className}`} />;
}

function SettingsRailSkeleton() {
    return (
        <aside aria-hidden="true" className="h-fit rounded-lg border border-border bg-card p-3 shadow-none">
            <div className="px-3 py-3">
                <SkeletonBlock className="h-3 w-32" />
                <SkeletonBlock className="mt-3 h-6 w-40" />
                <SkeletonBlock className="mt-3 h-4 w-full" />
                <SkeletonBlock className="mt-2 h-4 w-4/5" />
            </div>
            <div className="mt-2 space-y-1">
                {Array.from({ length: 9 }).map((_, index) => (
                    <div
                        key={index}
                        className="flex items-start gap-3 rounded-lg px-3 py-3"
                    >
                        <SkeletonBlock className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
                        <div className="min-w-0 flex-1">
                            <SkeletonBlock className="h-4 w-28" />
                            <SkeletonBlock className="mt-2 h-3 w-full" />
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    );
}

function SettingsCardSkeleton({ tall = false }: { tall?: boolean }) {
    return (
        <section aria-hidden="true" className="rounded-lg border border-border bg-card p-5 shadow-none">
            <div>
                <div className="min-w-0 flex-1">
                    <SkeletonBlock className="h-5 w-44" />
                    <SkeletonBlock className="mt-3 h-4 w-full max-w-2xl" />
                    <SkeletonBlock className="mt-2 h-4 w-3/5" />
                    {tall ? (
                        <div className="mt-5 space-y-3">
                            <SkeletonBlock className="h-44 w-full rounded-lg" />
                            <div className="flex gap-2">
                                <SkeletonBlock className="h-10 w-32 rounded-lg" />
                                <SkeletonBlock className="h-10 w-20 rounded-lg" />
                            </div>
                        </div>
                    ) : (
                        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            <SkeletonBlock className="h-14 rounded-lg" />
                            <SkeletonBlock className="h-14 rounded-lg" />
                            <SkeletonBlock className="h-14 rounded-lg" />
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

export function SkeletonSettings() {
    return (
        <>
            <span className="sr-only" role="status" aria-live="polite">Loading settings…</span>
            <div aria-hidden="true" className="grid gap-6 xl:grid-cols-[248px_minmax(0,1fr)]">
                <SettingsRailSkeleton />
                <div className="min-w-0 space-y-5">
                    <section aria-hidden="true" className="rounded-lg border border-border bg-card p-5 shadow-none">
                        <SkeletonBlock className="h-3 w-24" />
                        <SkeletonBlock className="mt-3 h-7 w-48" />
                        <SkeletonBlock className="mt-3 h-4 w-full max-w-3xl" />
                        <SkeletonBlock className="mt-2 h-4 w-2/3" />
                    </section>
                    <SettingsCardSkeleton />
                    <SettingsCardSkeleton tall />
                    <section aria-hidden="true" className="rounded-lg border border-border bg-card p-5 shadow-none">
                        <SkeletonBlock className="h-5 w-32" />
                        <SkeletonBlock className="mt-3 h-4 w-full max-w-xl" />
                        <div className="mt-5 grid gap-4">
                            <SkeletonBlock className="h-10 rounded-lg" />
                            <SkeletonBlock className="h-10 rounded-lg" />
                            <SkeletonBlock className="h-28 rounded-lg" />
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}
