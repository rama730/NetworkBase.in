import ProjectCardSkeleton from "@/components/workspaces/WorkspaceCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level Discover fallback: the same frame as the page (insets, columns, header rows, controls),
 * so nothing moves when the real page replaces it.
 */
export function DiscoverRouteSkeleton() {
  return (
    <div role="status" className="app-scroll app-scroll-y h-full min-h-0 flex-1 overflow-hidden px-4 sm:px-6">
      <span className="sr-only">Loading Discover…</span>
      <div aria-hidden="true" className="mx-auto w-full max-w-[1240px] pb-8 pt-6">
        <div className="nb-discover-columns">
          <section className="min-w-0">
            <div className="mb-[18px] flex flex-col gap-4">
              <div className="space-y-2">
                <Skeleton className="h-9 w-40 rounded-md" />
                <Skeleton className="h-5 w-80 max-w-full rounded-md" />
              </div>
              {/* Scope, search, then Sort and Filters (a full-width row of their own on phones). */}
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-[var(--ui-control-height)] w-[136px] rounded-md" />
                <Skeleton className="h-[var(--ui-control-height)] flex-1 rounded-md sm:w-64 sm:flex-none" />
                <div className="flex items-center gap-2 max-sm:w-full">
                  <Skeleton className="h-[var(--ui-control-height)] w-[132px] rounded-md max-sm:flex-1" />
                  <Skeleton className="h-[var(--ui-control-height)] w-24 rounded-md max-sm:flex-1" />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              {/* The same count as the feed's own skeleton, so nothing jumps when it takes over. */}
              {[1, 2, 3, 4].map((item) => <ProjectCardSkeleton key={item} />)}
            </div>
          </section>
          <aside className="nb-discover-rail">
            <div className="mb-3 flex items-center gap-3">
              <Skeleton className="h-4 w-40 rounded-sm" />
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map((item) => <Skeleton key={item} className="h-[136px] w-full rounded-lg" />)}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
