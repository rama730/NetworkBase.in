"use client";

import { useQuery } from "@tanstack/react-query";

import { createBatcher } from "@/lib/batcher";
import { isLooseUuid } from "@/lib/validations/uuid";
import { formatLastUpdateTime, lastUpdateLine, type WorkspaceLastUpdate as Update } from "@/lib/workspaces/last-update";
import { queryKeys } from "@/lib/query-keys";

// A page of cards makes one request, and the action only loads once something shows a line.
const load = createBatcher<Update>(async (ids) => {
  const { getWorkspaceLastUpdates } = await import("@/app/actions/workspace/last-update");
  return new Map((await getWorkspaceLastUpdates({ projectIds: ids })).map((entry) => [entry.projectId, entry]));
});

/** `Updated by Rama · 2h ago`; with `timeOnly`, where the row already names the workspace, just `2h ago`. */
export function WorkspaceLastUpdate({ projectId, timeOnly = false, className }: { projectId: string | null | undefined; timeOnly?: boolean; className?: string }) {
  const id = projectId && isLooseUuid(projectId) ? projectId : null;
  const { data, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.project.detail.lastUpdate(id ?? "none"),
    enabled: Boolean(id),
    queryFn: () => load(id!),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
  if (!data) return null;
  return (
    <span className={className} title={new Date(data.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} data-testid="workspace-last-update">
      {timeOnly ? formatLastUpdateTime(data.at, dataUpdatedAt) : lastUpdateLine(data, dataUpdatedAt)}
    </span>
  );
}
