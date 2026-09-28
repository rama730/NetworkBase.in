import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the project-creation wizard while viewer context is resolving. */
export default function NewProjectLoading() {
  return (
    <main role="status" aria-live="polite" aria-label="Loading project creation" className="mx-auto w-full max-w-5xl p-6 sm:p-8">
      <span className="sr-only">Loading project creation…</span>
      <div aria-hidden="true" className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <aside className="space-y-5 pt-3">
          {[1, 2, 3, 4].map((step) => <Skeleton key={step} className="h-8 w-36 rounded" />)}
        </aside>
        <section className="space-y-6 rounded-lg border border-border bg-card p-6 sm:p-8">
          <div className="space-y-3"><Skeleton className="h-8 w-64 max-w-full rounded" /><Skeleton className="h-4 w-96 max-w-full rounded" /></div>
          <div className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map((choice) => <Skeleton key={choice} className="h-36 rounded-lg border border-border" />)}</div>
          <div className="flex justify-end gap-3"><Skeleton className="h-10 w-20 rounded" /><Skeleton className="h-10 w-28 rounded" /></div>
        </section>
      </div>
    </main>
  );
}
