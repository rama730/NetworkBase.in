import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonTasks() {
    return <div role="status" aria-live="polite" aria-label="Loading tasks" className="flex h-[calc(100vh-200px)] gap-4 overflow-x-auto pb-4"><span className="sr-only">Loading tasks…</span>{[1, 2, 3, 4].map((i) => <div key={i} aria-hidden="true" className="flex min-w-[300px] flex-col gap-4 rounded-lg border border-border bg-card p-4"><Skeleton className="h-6 w-1/2 rounded" /><div className="space-y-3"><div className="space-y-2 rounded-lg border border-border bg-background p-3"><Skeleton className="h-4 w-3/4 rounded" /><Skeleton className="h-3 w-1/2 rounded" /></div><div className="space-y-2 rounded-lg border border-border bg-background p-3"><Skeleton className="h-4 w-3/4 rounded" /></div></div></div>)}</div>;
}
