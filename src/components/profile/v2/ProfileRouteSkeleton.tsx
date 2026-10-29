import { Skeleton } from "@/components/ui/skeleton";
import { RailSection } from "@/components/ui/rail-section";

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
                    <header className="rounded-[8px] border border-border bg-card p-4 shadow-none md:p-6">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex gap-4">
                                <Skeleton className="size-[72px] shrink-0 rounded-[4px]" />
                                <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Skeleton className="h-7 w-48 rounded-[4px]" />
                                        <Skeleton className="h-4 w-24 rounded-[4px]" />
                                        <Skeleton className="h-5 w-32 rounded-[4px]" />
                                    </div>
                                    <Skeleton className="h-4 w-80 max-w-full rounded-[4px]" />
                                    <div className="flex flex-wrap items-center gap-3 pt-1">
                                        <Skeleton className="h-3.5 w-24 rounded-[4px]" />
                                        <Skeleton className="h-3.5 w-28 rounded-[4px]" />
                                        <Skeleton className="h-3.5 w-20 rounded-[4px]" />
                                    </div>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 pt-1">
                                <Skeleton className="h-9 w-24 rounded-[6px]" />
                                <Skeleton className="h-9 w-9 rounded-[6px]" />
                            </div>
                        </div>
                    </header>

                    {/* Main content grid: Left Column (tabs + main) + Right Rail (320px) matching ProfileShell */}
                    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6 lg:items-start">
                        <div className="contents lg:min-w-0 lg:block lg:space-y-6">
                            {/* Tabs shell */}
                            <div className="order-1 min-w-0 flex min-h-11 w-full items-end gap-5 border-b border-border">
                                <Skeleton className="h-5 w-20 mb-3 rounded-[4px]" />
                                <Skeleton className="h-5 w-20 mb-3 rounded-[4px]" />
                            </div>

                            {/* About card */}
                            <section className="order-2 rounded-[8px] border border-border bg-card p-5 space-y-3">
                                <Skeleton className="h-5 w-24 rounded-[4px]" />
                                <Skeleton className="h-4 w-full rounded-[4px]" />
                                <Skeleton className="h-4 w-5/6 rounded-[4px]" />
                                <Skeleton className="h-4 w-4/6 rounded-[4px]" />
                            </section>

                            {/* Project contributions */}
                            <section className="order-4 rounded-[8px] border border-border bg-card p-5 space-y-3">
                                <Skeleton className="h-5 w-40 rounded-[4px]" />
                                <Skeleton className="h-20 w-full rounded-[6px] border border-border" />
                            </section>
                        </div>

                        {/* Right rail */}
                        <aside role="complementary" className="contents lg:min-w-0 lg:block" aria-label="Profile details">
                            <div className="contents lg:sticky lg:block lg:space-y-6" style={{ top: "24px" }}>
                                {/* Highlights: OpenToRolesCard */}
                                <div className="order-3 space-y-6">
                                    <RailSection title="Collaboration preferences" contentClassName="p-5 max-md:p-4 space-y-3">
                                        <Skeleton className="h-4 w-3/4 rounded-[4px]" />
                                        <div className="flex gap-2 pt-1">
                                            <Skeleton className="h-6 w-20 rounded-[4px]" />
                                            <Skeleton className="h-6 w-24 rounded-[4px]" />
                                        </div>
                                    </RailSection>
                                </div>

                                {/* Rail: Links card */}
                                <div className="order-5 space-y-6">
                                    <RailSection title="Links" contentClassName="px-5 max-md:px-4">
                                        <div className="space-y-2">
                                            <Skeleton className="h-11 w-full rounded-[4px]" />
                                            <Skeleton className="h-11 w-full rounded-[4px]" />
                                        </div>
                                    </RailSection>
                                </div>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
