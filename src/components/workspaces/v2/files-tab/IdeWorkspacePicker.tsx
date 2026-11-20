"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Folder, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { queryKeys } from "@/lib/query-keys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface IdeWorkspace {
  id: string;
  name: string;
  slug?: string;
}
export type ProjectPage = {
  projects: IdeWorkspace[];
  projectPage: { hasMore: boolean; nextCursor: string | null };
};

/** One page of the viewer's workspaces for an editor handoff (My work's footer reads the same list and cache). */
export async function loadProjects(
  cursor: string | null,
  signal: AbortSignal,
): Promise<ProjectPage> {
  const params = new URLSearchParams({ mode: "summary" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/v1/extension/workspace?${params}`, {
    credentials: "include",
    signal,
  });
  const body = await response.json();
  if (!response.ok || !body.success || !Array.isArray(body.data?.projects))
    throw new Error("Couldn’t load your workspaces.");
  return body.data as ProjectPage;
}

/** My Work has no implicit project; never launch an arbitrary or empty workspace. */
export function IdeWorkspacePicker({
  open,
  onOpenChange,
  editorName,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editorName: string;
  onSelect: (project: IdeWorkspace) => void;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const query = useInfiniteQuery({
    queryKey: queryKeys.myWork.ideProjects(user?.id ?? null),
    queryFn: ({ pageParam, signal }) => loadProjects(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.projectPage?.hasMore ? page.projectPage.nextCursor : undefined,
    enabled: open && Boolean(user?.id),
    staleTime: 30_000,
  });
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];
  const filtered = projects.filter((project) =>
    `${project.name} ${project.slug ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSearch("");
        onOpenChange(next);
      }}
    >
      <DialogContent
        overlayClassName="z-[250]"
        className="z-[251] sm:max-w-[400px]"
      >
        <DialogHeader className="text-left">
          <DialogTitle>Choose a workspace</DialogTitle>
          <DialogDescription>
            Open a NetworkBase workspace in {editorName}.
          </DialogDescription>
        </DialogHeader>
        <label className="flex h-[var(--ui-control-height)] items-center gap-2 rounded-md border border-border px-2.5 focus-within:ring-1 focus-within:ring-ring">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search workspaces"
            placeholder="Search workspaces…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        {!user ? (
          <p role="status" className="text-[13px] text-muted-foreground">
            Sign in to open your workspaces.
          </p>
        ) : query.isPending ? (
          <div
            role="status"
            aria-label="Loading workspaces"
            className="space-y-2"
          >
            {[1, 2, 3].map((row) => (
              <div key={row} className="nb-skeleton h-11 rounded-md" />
            ))}
          </div>
        ) : query.isError && !query.data ? (
          <div role="alert" className="space-y-2 text-[13px]">
            <p>Couldn’t load your workspaces.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="max-h-[min(320px,45dvh)] overflow-y-auto overscroll-contain">
            {filtered.map((project) => (
              <button
                type="button"
                key={project.id}
                onClick={() => {
                  setSearch("");
                  onSelect(project);
                }}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Folder
                  className="size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{project.name}</span>
              </button>
            ))}
            {!filtered.length && (
              <p
                role="status"
                className="py-4 text-[13px] text-muted-foreground"
              >
                {projects.length
                  ? query.hasNextPage
                    ? "No matching workspaces. Load more or try another name."
                    : "No matching workspaces. Try another name."
                  : "Join or create a workspace to open it in your editor."}
              </p>
            )}
            {query.hasNextPage && (
              <Button
                variant="ghost"
                className="mt-2 w-full"
                disabled={query.isFetchingNextPage}
                onClick={() => {
                  void query.fetchNextPage();
                }}
              >
                {query.isFetchingNextPage
                  ? "Loading workspaces…"
                  : "Load more workspaces"}
              </Button>
            )}
            {query.isFetchNextPageError && (
              <p role="alert" className="text-xs text-destructive">
                Couldn’t load more workspaces. Try again.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
