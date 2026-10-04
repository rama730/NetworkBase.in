import { Skeleton } from "@/components/ui/skeleton";

const NAV_ITEM_SKELETONS = [
  "h-10 w-20 rounded-md",
  "h-10 w-28 rounded-md",
  "h-10 w-24 rounded-md",
  "h-10 w-32 rounded-md",
  "h-10 w-20 rounded-md",
] as const;

/** Layout-preserving route fallback while the settings document resolves. */
export default function SettingsLoading() {
  return (
    <main role="status" aria-live="polite" aria-label="Loading settings" className="mx-auto w-full max-w-6xl p-6 sm:p-8">
      <span className="sr-only">Loading settings…</span>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-lg border border-border bg-card p-3">
          {NAV_ITEM_SKELETONS.map((className, index) => (
            <Skeleton key={index} className={className} />
          ))}
        </aside>
        <section className="space-y-5">
          <Skeleton className="h-8 w-44 rounded" />
          <Skeleton className="h-4 w-96 max-w-full rounded" />
          <Skeleton className="h-48 rounded-lg border border-border" />
          <Skeleton className="h-36 rounded-lg border border-border" />
        </section>
      </div>
    </main>
  );
}
