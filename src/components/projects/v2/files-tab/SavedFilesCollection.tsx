"use client";
import { useQuery } from "@tanstack/react-query";
import { getNodeMetadataBatch } from "@/app/actions/files/nodes";
import { useFilesStore } from "@/stores/filesStore";
import { useFilesViews } from "./FilesViews";
import { FolderListView } from "./folder/FolderListView";
import { useFilesTabRole } from "./FilesTabRoleContext";
const EMPTY_RECENTS: string[] = [];
const EMPTY_FAVORITES: Record<string, boolean> = {};
export function SavedFilesCollection({ projectId }: { projectId: string }) {
  const view = useFilesViews()!;
  const recents = useFilesStore(
    (s) => s.byProjectId[projectId]?.recents ?? EMPTY_RECENTS,
  );
  const favorites = useFilesStore(
    (s) => s.byProjectId[projectId]?.favorites ?? EMPTY_FAVORITES,
  );
  const ids =
    view.view === "recent"
      ? recents
      : Object.keys(favorites).filter((id) => favorites[id]);
  const { canEdit, canManageFiles } = useFilesTabRole();
  const result = useQuery({
    queryKey: ["files-saved-collection", projectId, ids.join(",")],
    queryFn: async () => {
      const nodes = [];
      for (let start = 0; start < ids.length; start += 100) {
        const page = await getNodeMetadataBatch(
          projectId,
          ids.slice(start, start + 100),
        );
        if (!page.success) throw new Error(page.message);
        nodes.push(...page.data.nodes);
      }
      const position = new Map(ids.map((id, index) => [id, index]));
      return nodes.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
    },
    staleTime: 60_000,
    // ponytail: back off idle polling to 5m to eliminate client-side egress churn. ceiling: 5m polling interval. upgrade: WebSocket Realtime push invalidation for remote lists.
  });
  const nodes =
    result.data?.filter((node) =>
      node.name.toLowerCase().includes(view.query.toLowerCase()),
    ) ?? [];
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={`${view.view} files`}
    >
      {result.isError && (
        <p role="alert" className="p-3 text-sm">
          Could not update this collection.{" "}
          <button className="underline" onClick={() => void result.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="min-h-0 flex-1">
        <FolderListView
          projectId={projectId}
          folderId={null}
          canEdit={canEdit}
          canManageFiles={canManageFiles}
          collection={{
            nodes,
            loading: result.isPending,
            preserveOrder: true,
            emptyMessage: result.isError
              ? "Files are unavailable. Retry above."
              : view.query
                ? "No matching files."
                : view.view === "recent"
                  ? "Files you open will appear here."
                  : "Star a file from its actions menu to find it here.",
          }}
        />
      </div>
    </section>
  );
}
