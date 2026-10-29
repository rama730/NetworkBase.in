import { Skeleton } from "@/components/ui/skeleton";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";

export function NetworkRouteSkeleton() {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            aria-label="Loading network"
            className="nb-network-page min-h-full bg-background px-4 sm:px-6"
        >
            <span className="sr-only">Loading network…</span>
            <div
                aria-hidden="true"
                className="mx-auto w-full max-w-[1240px] pb-8 pt-6"
            >
                <div className="nb-network-columns">
                    <div className="nb-network-main min-w-0">
                        <div className="min-w-0">
                            <Skeleton className="nb-page-title h-[1.28em] w-36 rounded-[5px]" />
                            <div className="nb-body relative mt-1">
                                <p className="invisible">
                                    People you’ve worked with, and people
                                    worth working with.
                                </p>
                                <Skeleton className="absolute inset-y-0 left-0 w-80 max-w-full rounded-md" />
                            </div>
                        </div>
                        <div className="nb-network-toolbar mt-4 flex min-w-0 flex-wrap-reverse items-start gap-2 border-b border-border">
                            <div className="-mb-px self-end flex min-h-11 max-w-full min-w-0 shrink-0 items-center gap-2 border-b-2 border-transparent px-2 py-3">
                                <Skeleton className="h-[16.2px] w-24 rounded-sm" />
                                <Skeleton className="h-[16.2px] w-24 rounded-sm" />
                                <Skeleton className="h-[16.2px] w-24 rounded-sm" />
                            </div>
                            <div className="nb-network-controls mb-2 flex max-w-full flex-wrap items-center gap-2">
                                <Skeleton className="h-[var(--ui-control-height)] w-64 max-w-full rounded-md" />
                                <Skeleton className="h-[var(--ui-control-height)] w-[84px] rounded-md" />
                            </div>
                        </div>
                        <div className="nb-person-card-grid mt-4 grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                            {[1, 2, 3, 4, 5, 6].map((key) => (
                                <PersonCardSkeleton key={key} />
                            ))}
                        </div>
                    </div>
                    <div className="nb-network-rail space-y-3">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-[14px] w-32 rounded-sm" />
                            <div className="h-px flex-1 bg-border" />
                        </div>
                        <div className="space-y-1 rounded-lg border border-border bg-card p-4">
                            {[1, 2, 3].map((item) => (
                                <div
                                    key={item}
                                    className="flex h-11 items-center justify-between px-2"
                                >
                                    <Skeleton className="h-4 w-36 rounded-sm" />
                                    <Skeleton className="h-3 w-5 rounded-sm" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
