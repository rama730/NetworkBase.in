import ProjectCardSkeleton from "@/components/projects/ProjectCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level Discovery fallback. It mirrors the signed-in Discovery page:
 * heading and filter, a single-column project feed, and the desktop people rail.
 */
export function HubRouteSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading discovery" className="h-full min-h-0 overflow-hidden">
      <span className="sr-only">Loading discovery…</span>
      <div aria-hidden="true" className="mx-auto h-full max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="nb-discover-columns">
          <section className="min-w-0">
            <header className="mb-[34px] flex min-w-0 flex-col gap-4 py-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-3">
                <Skeleton className="h-10 w-44 rounded" />
                <Skeleton className="h-5 w-80 max-w-full rounded" />
              </div>
              <Skeleton className="h-[var(--ui-control-height-lg)] w-full rounded-md sm:w-[168px]" />
            </header>
            <div className="space-y-4">
              {[1, 2, 3].map((item) => <ProjectCardSkeleton key={item} />)}
            </div>
          </section>

          <aside className="nb-discover-rail pt-2" aria-label="Loading people you should meet">
            <div className="mb-3 flex items-center gap-3">
              <Skeleton className="h-4 w-44 rounded" />
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <article key={item} className="nb-discover-person-card">
                  <Skeleton className="size-14 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-36 max-w-full rounded" />
                    <Skeleton className="h-4 w-full rounded" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
                </article>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
