import { Skeleton } from "@/components/ui/skeleton";
import { PersonCardLayout } from "./PersonCardContent";

export function PersonCardSkeleton({ variant = "network" }: { variant?: "network" | "rail" }) {
    return <div aria-hidden="true"><PersonCardLayout variant={variant}
        avatar={<Skeleton className="h-full w-full rounded-md" />}
        head={<Skeleton className="h-4 w-28 max-w-full rounded-sm" />}
        headline={<Skeleton className="h-3 w-32 max-w-full rounded-sm" />}
        location={<Skeleton className="h-3.5 w-44 max-w-full rounded-sm" />}
        body={<div className="flex gap-[5px]"><Skeleton className="h-[22px] w-16 rounded-full" /><Skeleton className="h-[22px] w-14 rounded-full" /></div>}
        meta={[<Skeleton key="footer" className="h-3 w-32 max-w-full rounded-sm" />]}
        aside={<Skeleton className="nb-person-action-skeleton w-[76px] rounded-md" />}
    /></div>;
}
