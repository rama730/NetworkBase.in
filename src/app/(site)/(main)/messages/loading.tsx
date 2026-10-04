import { Skeleton } from "@/components/ui/skeleton";

export default function MessagesLoading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading messages" className="flex h-full min-h-0 flex-col bg-card">
      <span className="sr-only">Loading messages…</span>
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-5 w-40 rounded" />
      </div>
      <div className="space-y-4 p-4">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex gap-3">
            <Skeleton className="size-[34px] rounded-[5px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32 rounded" />
              <Skeleton className="h-3 w-3/4 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
