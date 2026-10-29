import { Skeleton } from "@/components/ui/skeleton";
import { RailSection } from "@/components/ui/rail-section";

/** Layout-matched placeholder for the project dashboard's overview and rail. */
export function SkeletonDashboard() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading dashboard" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <span className="sr-only">Loading dashboard…</span>
      <section aria-hidden="true" className="min-w-0 space-y-6 lg:col-span-8">
        <div className="rounded-lg border border-border bg-card p-6">
          <Skeleton className="h-7 w-56 rounded" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-11/12 rounded" />
            <Skeleton className="h-4 w-4/5 rounded" />
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-36 rounded-lg border border-border" />
            <Skeleton className="h-36 rounded-lg border border-border" />
          </div>
        </div>
      </section>
      <aside aria-hidden="true" className="min-w-0 space-y-6 lg:col-span-4">
        <RailSection title="Journey">
          <Skeleton className="h-3 w-full rounded" />
          <div className="mt-4 flex justify-between">
            <Skeleton className="h-4 w-12 rounded" />
            <Skeleton className="h-4 w-12 rounded" />
            <Skeleton className="h-4 w-12 rounded" />
          </div>
        </RailSection>
        <RailSection title="Recent activity">
          <div className="space-y-4">
            <Skeleton className="h-12 rounded" />
            <Skeleton className="h-12 rounded" />
            <Skeleton className="h-12 rounded" />
          </div>
        </RailSection>
        <RailSection title="Open roles" contentClassName="space-y-3 p-3">
          <Skeleton className="h-12 rounded" />
          <Skeleton className="h-12 rounded" />
        </RailSection>
      </aside>
    </div>
  );
}
