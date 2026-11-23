import { Skeleton } from "@/components/ui/skeleton";

/** A list loading (pins, files): avatar-and-lines rows in the shared shimmer. */
export function RowsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="space-y-4 p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          <Skeleton kind="tile" className="size-[34px] flex-none rounded-md" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 w-32 rounded-sm" />
            <Skeleton className="h-3 w-3/4 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
