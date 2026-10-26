import { Skeleton } from "@/components/ui/skeleton";

/** An update card's shape while it loads: author row, three text lines, the footer row. */
export default function DiscoverUpdateCardSkeleton() {
    return <div className="nb-project-card border-l-2 border-l-primary" aria-hidden="true">
        <div className="flex items-center gap-3"><Skeleton className="size-10 rounded-md" /><div className="space-y-1.5"><Skeleton className="h-4 w-36 rounded-sm" /><Skeleton className="h-3 w-24 rounded-sm" /></div></div>
        <div className="mt-3 space-y-1.5"><Skeleton className="h-4 w-full rounded-sm" /><Skeleton className="h-4 w-full rounded-sm" /><Skeleton className="h-4 w-2/3 rounded-sm" /></div>
        <div className="nb-project-card-footer"><Skeleton className="h-7 w-24 rounded-md" /><Skeleton className="h-7 w-28 rounded-md" /></div>
    </div>;
}
