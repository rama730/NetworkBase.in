import { Skeleton } from "@/components/ui/skeleton";

/**
 * One loading shape for Messages screens (route loading, Inbox, Saved, Drafts, Search): a header and list rows.
 * `header={false}`: just the rows, inside a screen that already has its header.
 */
export function ListSkeleton({ label = "Loading", header = true, rows = 6 }: { label?: string; header?: boolean; rows?: number }) {
  return (
    <div role="status" className={`flex min-h-0 flex-col bg-card ${header ? "h-full" : ""}`}>
      <span className="sr-only">{label}…</span>
      {header ? (
        <div className="flex h-14 flex-none items-center border-b border-border px-4">
          <Skeleton className="h-5 w-32 rounded-sm" />
        </div>
      ) : null}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-3 px-4 py-3">
            <Skeleton kind="tile" className="size-[34px] flex-none rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3 rounded-sm" />
              <Skeleton className="h-3 w-2/3 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
