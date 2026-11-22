import { Skeleton } from "@/components/ui/skeleton";

/** Loading shape of the profile (spec: profile mix): the band, the tab bar, then the column beside the right card. */
export function ProfileRouteSkeleton() {
    return (
        <div role="status" aria-live="polite" aria-label="Loading profile" className="min-h-full bg-background text-foreground">
            <span className="sr-only">Loading profile…</span>
            <div aria-hidden="true" className="nb-pf-page">
                <div className="nb-pf-band">
                    <div className="flex gap-4 p-5">
                        <Skeleton className="size-20 shrink-0 rounded-[6px]" />
                        <div className="min-w-0 flex-1 space-y-2.5 pt-1">
                            <Skeleton className="h-8 w-56 max-w-full rounded-[4px]" />
                            <Skeleton className="h-4 w-40 rounded-[4px]" />
                            <Skeleton className="h-4 w-80 max-w-full rounded-[4px]" />
                        </div>
                        <Skeleton className="hidden h-9 w-28 shrink-0 rounded-[6px] sm:block" />
                    </div>
                    <div className="grid grid-cols-3 border-t border-[var(--pf-band-cell)]">
                        {[0, 1, 2].map((i) => <div key={i} className="px-5 py-3.5"><Skeleton className="h-5 w-24 rounded-[4px]" /></div>)}
                    </div>
                </div>
                <div className="nb-pf-tabbar"><div className="flex min-h-11 items-center gap-6 px-5">
                    {[20, 28, 20].map((w, i) => <Skeleton key={i} className="h-4 rounded-[4px]" style={{ width: `${w * 4}px` }} />)}
                </div></div>
                <div className="flex gap-2"><Skeleton className="h-7 w-16 rounded-[4px]" /><Skeleton className="h-7 w-20 rounded-[4px]" /><Skeleton className="h-7 w-14 rounded-[4px]" /></div>
                <div className="nb-pf-body">
                    <div className="nb-pf-col">
                        <span className="nb-pf-label has-rule">About</span>
                        <div className="nb-pf-panel space-y-3 p-5">
                            <Skeleton className="h-4 w-full rounded-[4px]" />
                            <Skeleton className="h-4 w-5/6 rounded-[4px]" />
                            <Skeleton className="h-4 w-4/6 rounded-[4px]" />
                        </div>
                        <span className="nb-pf-label has-rule">Recent work</span>
                        <Skeleton className="h-28 w-full rounded-[8px]" />
                    </div>
                    <div className="nb-pf-rail">
                        <div className="nb-pf-panel nb-pf-facts">
                            {["Collaboration", "Organizations", "Details"].map((title) => (
                                <div key={title} className="nb-pf-fsec">
                                    <span className="nb-pf-label">{title}</span>
                                    <Skeleton className="h-4 w-full rounded-[4px]" />
                                    <Skeleton className="h-4 w-2/3 rounded-[4px]" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
