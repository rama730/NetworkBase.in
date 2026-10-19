import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonGitHubSync({ className }: { className?: string } = {}) {
  return (
    <div
      role="status"
      aria-label="Loading GitHub Sync"
      aria-busy="true"
      className={cn("flex flex-1 flex-col overflow-y-auto p-6 bg-background", className)}
    >
      <span className="sr-only">Loading GitHub Sync…</span>
      <div className="flex flex-col gap-1.5 mb-6">
        <Skeleton className="h-7 w-48 rounded-[4px]" />
        <Skeleton className="h-4 w-80 max-w-full rounded-[3px]" />
      </div>

      <div className="rounded-[6px] border border-border bg-card p-5 mb-6 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32 rounded-[3px]" />
          <Skeleton className="h-8 w-24 rounded-[4px]" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="size-4 rounded-[3px]" />
          <Skeleton className="h-4 w-52 rounded-[3px]" />
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <Skeleton className="h-9 w-36 rounded-[5px]" />
        <Skeleton className="h-9 w-28 rounded-[5px]" />
      </div>

      <div className="rounded-[6px] border border-border bg-card p-5 space-y-4">
        <Skeleton className="h-5 w-40 rounded-[3px]" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b border-border/40 last:border-0"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="size-4 rounded-[3px]" />
                <Skeleton className="h-4 w-48 rounded-[3px]" />
              </div>
              <Skeleton className="h-4 w-24 rounded-[3px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
