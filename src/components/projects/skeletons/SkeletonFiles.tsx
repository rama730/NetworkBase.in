import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonFiles() {
  return <div role="status" aria-label="Loading files" aria-busy="true" className="flex h-full min-h-0 w-full overflow-hidden bg-background">
    <span className="sr-only">Loading files…</span>
    <aside aria-hidden="true" className="hidden w-[280px] shrink-0 border-r border-border p-3 md:block">
      <Skeleton className="mb-5 h-6 w-20 rounded" />
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="mb-2 flex h-11 items-center gap-3 px-3"><Skeleton className="size-4 rounded" /><Skeleton className="h-4 w-28 rounded" /></div>)}
    </aside>
    <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4"><Skeleton className="h-5 w-24 rounded" /><Skeleton className="h-8 w-40 rounded" /></div>
      <div className="h-11 shrink-0 border-b border-border bg-muted/30" />
      {Array.from({ length: 10 }, (_, i) => <div key={i} className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4"><Skeleton className="size-4 rounded" /><Skeleton className="h-4 w-1/3 rounded" /><Skeleton className="ml-auto hidden h-3 w-24 rounded sm:block" /></div>)}
    </div>
  </div>;
}
