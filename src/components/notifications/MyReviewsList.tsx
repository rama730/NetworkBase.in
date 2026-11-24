"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { GitPullRequest } from "@/components/ui/icons";

import { myReviewsAction } from "@/app/actions/files/merge-requests";

/** The inbox's "My reviews" tab (report H23 journey 3): open merge requests waiting on you, in every workspace. */
export function MyReviewsList() {
  const q = useQuery({
    queryKey: ["my-reviews"],
    queryFn: async () => { const res = await myReviewsAction(); if (!res.success) throw new Error(res.error); return res.data.reviews; },
    staleTime: 15_000,
  });
  if (q.isLoading) return <p role="status" className="nb-waiting justify-center px-4 py-6 text-xs text-muted-foreground"><PixelBeat />Loading reviews…</p>;
  if (q.isError) return <p className="px-4 py-6 text-center text-xs text-muted-foreground">Couldn’t load your reviews. <button type="button" className="underline" onClick={() => void q.refetch()}>Retry</button></p>;
  if (!q.data?.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing is waiting on your review.</p>;
  return (
    <ul aria-label="Merge requests waiting on your review">
      {q.data.map((r) => (
        <li key={`${r.workspace.id}:${r.number}`} className="border-b border-border/60">
          <Link href={r.href} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground"><span className="font-mono">!{r.number}</span> {r.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.workspace.title} · <span className="font-mono">{r.source}</span>{r.author ? ` · by ${r.author.name ?? `@${r.author.username}`}` : ""}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
