"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useOpenSettingsSections } from "./SettingsSectionLayout";

export function SettingsSectionsSkeleton({ count = 2 }: { count?: number }) {
    const open = useOpenSettingsSections();
    return <div aria-hidden="true" className="space-y-8">
        {Array.from({ length: count }, (_, index) => (
            <div key={index} className={open
                ? "space-y-4 border-b border-border pb-6 last:border-b-0 last:pb-0"
                : "space-y-4 rounded-lg border border-border bg-card p-6"}>
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
