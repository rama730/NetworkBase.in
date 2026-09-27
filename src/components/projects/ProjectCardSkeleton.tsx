import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectCardSkeleton() {
    return <div className="nb-project-card" role="status" aria-label="Loading project">
        <span className="sr-only">Loading project</span>
        <div className="flex gap-2" aria-hidden="true"><Skeleton className="h-5 w-2/3 rounded-sm" /></div>
        <div className="space-y-2" aria-hidden="true"><Skeleton className="h-3 w-full rounded-sm" /><Skeleton className="h-3 w-4/5 rounded-sm" /></div>
        <div className="flex gap-1.5" aria-hidden="true">{[1,2,3].map(i => <Skeleton key={i} className="h-6 w-16 rounded-sm" />)}</div>
        <div className="nb-project-card-footer" aria-hidden="true"><div className="flex -space-x-1.5">{[1,2,3].map(i => <Skeleton key={i} className="size-[26px] rounded-md border-2 border-card" />)}</div><Skeleton className="h-3 w-24 rounded-sm" /></div>
    </div>;
}
