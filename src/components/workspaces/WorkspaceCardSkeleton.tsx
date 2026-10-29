import { Skeleton } from "@/components/ui/skeleton";

/** The card's shape while it loads: title, two summary lines, 22px tags, the 28px footer row. Announced once by its list. */
export default function ProjectCardSkeleton() {
    return <div className="nb-project-card" aria-hidden="true">
        <Skeleton className="h-[22px] w-2/3 rounded-sm" />
        <div className="space-y-1.5"><Skeleton className="h-4 w-full rounded-sm" /><Skeleton className="h-4 w-4/5 rounded-sm" /></div>
        <div className="flex gap-1.5">{[1,2,3].map(i => <Skeleton key={i} className="h-[22px] w-16 rounded-full" />)}</div>
        <div className="nb-project-card-footer"><div className="flex -space-x-1.5">{[1,2,3].map(i => <Skeleton key={i} className="size-[26px] rounded-md border-2 border-card" />)}</div><Skeleton className="h-7 w-28 rounded-md" /></div>
    </div>;
}
