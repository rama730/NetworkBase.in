"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { readWorkspaceUpdatesAction } from "@/app/actions/workspace/updates";
import { EmptyState } from "@/components/ui/EmptyState";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { queryKeys } from "@/lib/query-keys";
import { parseRelease } from "@/lib/workflows/changelog";

/**
 * Report 38.17 W5, W6 (plan A7.5): Updates → Changelog: release Updates only, newest first, each as its version and
 * date with Added · Improved · Fixed; one written by hand without the shape shows as one block. Reads like the feed
 * (visitors see public ones where Updates is public).
 */
export function Changelog({ projectId }: { projectId: string }) {
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "changelog"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const r = await readWorkspaceUpdatesAction(projectId, { cursor: pageParam, filter: "release" });
      if (!r.success || !r.data) throw new Error(r.error || "Couldn’t load the changelog");
      return r.data as { updates: Array<{ id: string; content: string; createdAt: string }>; nextCursor?: string | null };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  if (query.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the changelog…</p>;
  if (query.isError) return <div className="nb-empty-state py-10" role="alert"><p className="nb-card-title">Couldn’t load the changelog</p><button type="button" className="mt-3 text-sm font-medium text-primary underline" onClick={() => void query.refetch()}>Try again</button></div>;
  const releases = query.data.pages.flatMap((p) => p.updates);
  if (!releases.length) return <EmptyState title="No releases yet" description="Post an Update with Release ticked and it shows here as a version." compact />;
  return (
    <ol className="space-y-4" data-testid="changelog">
      {releases.map((u) => {
        const r = parseRelease(u.content);
        const date = new Date(u.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
        return (
          <li key={u.id} className="rounded-[8px] border border-border p-4" data-testid="changelog-release">
            {r.kind === "release" ? (
              <>
                <h3 className="text-[14px] font-semibold"><span className="font-mono">{r.version}</span> <span className="font-normal text-muted-foreground">· {date}</span></h3>
                {([["Added", r.added], ["Improved", r.improved], ["Fixed", r.fixed]] as const).map(([label, items]) => items.length ? (
                  <div key={label} className="mt-2"><p className="text-[12px] font-medium text-muted-foreground">{label}</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">{items.map((i, n) => <li key={n}>{i}</li>)}</ul></div>
                ) : null)}
              </>
            ) : (
              <><p className="text-[12px] text-muted-foreground">{date}</p><p className="mt-1 whitespace-pre-wrap text-[13px]">{r.text}</p></>
            )}
          </li>
        );
      })}
      {query.hasNextPage ? <li><button type="button" className="text-[13px] font-medium underline underline-offset-4" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Show older</button></li> : null}
    </ol>
  );
}
