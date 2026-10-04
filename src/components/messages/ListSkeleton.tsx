import { Skeleton } from "@/components/ui/skeleton";

/** One loading shape for Messages screens (route loading, Inbox, Saved, Drafts, Search): a header and list rows. */
export function ListSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex h-full min-h-0 flex-col bg-card">
      <span className="sr-only">{label}…</span>
      <div className="flex h-14 flex-none items-center border-b border-border px-4">
        <Skeleton className="h-5 w-32 rounded" />
      </div>
      <div className="divide-y divide-border">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 flex-none rounded-[5px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3 rounded" />
              <Skeleton className="h-3 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
