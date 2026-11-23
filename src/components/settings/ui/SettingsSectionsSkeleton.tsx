"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useOpenSettingsSections } from "./SettingsSectionLayout";

/** Loading groups: in Settings (mix) a mono label bar and rows on hairlines; elsewhere cards. */
export function SettingsSectionsSkeleton({ count = 2 }: { count?: number }) {
    const open = useOpenSettingsSections();
    if (open) {
        return <div aria-hidden="true">
            {Array.from({ length: count }, (_, index) => (
                <div key={index} className="nbs-group">
                    <div className="nbs-glabel"><Skeleton className="h-2.5 w-28" /></div>
                    <div className="nbs-rows">
                        {[0, 1].map((row) => <div key={row} className="nbs-row"><div className="grid gap-2"><Skeleton className="h-3 w-36 max-w-full" /><Skeleton className="h-2.5 w-72 max-w-full" /></div><Skeleton className="h-[22px] w-[38px]" /></div>)}
                    </div>
                </div>
            ))}
        </div>;
    }
    return <div aria-hidden="true" className="space-y-8">
        {Array.from({ length: count }, (_, index) => (
            <div key={index} className="space-y-4 rounded-lg border border-border bg-card p-6">
                <div className="space-y-1">
                    <Skeleton className="h-5 w-40 max-w-full" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                </div>
                <div className="space-y-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            </div>
        ))}
    </div>;
}
