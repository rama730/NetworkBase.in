import type { getWorkspaceNodesWithCounts } from "@/app/actions/files/nodes";

type RootRead = ReturnType<typeof getWorkspaceNodesWithCounts>;

// The Files tab's root folder read, started on the server when the page opens on Files (live-fix phase 1). The page
// offers it here and the explorer's first root load takes it once, instead of queueing a browser call of its own.
const started = new Map<string, RootRead>();

export function offerStartedRoot(projectId: string, read: RootRead | null | undefined) {
  if (read) started.set(projectId, read);
}

export function takeStartedRoot(projectId: string): RootRead | null {
  const read = started.get(projectId) ?? null;
  started.delete(projectId);
  return read;
}
