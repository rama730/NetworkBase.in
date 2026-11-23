// Files main: folder/root renders the list; file renders FileView keyed by id.

"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import type { WorkspaceNode } from "@/lib/db/schema";
import { useFilesStore } from "@/stores/filesStore";

import { useFilesTabRole } from "./FilesTabRoleContext";
import { useCurrentLocation } from "./hooks/useCurrentLocation";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import {
  FilesHeader,
  FilesViewsMenu,
} from "./FilesHeader";
import { FolderListView } from "./folder/FolderListView";
import { FileView } from "./file/FileView";
import { useFilesViews } from "./FilesViews";
import { TaskFilesCollection } from "./TaskFilesCollection";
import { SavedFilesCollection } from "./SavedFilesCollection";
import { TrashFilesCollection } from "./TrashFilesCollection";
import { ChangesCollection } from "./ChangesCollection";
import { HistoryCollection } from "./HistoryCollection";
import { BranchesCollection } from "./BranchesCollection";
import { MergeRequestsCollection } from "./MergeRequestsCollection";
import { BranchExplorer } from "./BranchExplorer";
import dynamic from "next/dynamic";
import type { GithubImportAccessState } from "@/lib/github/import-types";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonGitHubSync } from "@/components/workspaces/skeletons/SkeletonGitHubSync";
import { OrgFilesCollection } from "@/components/organizations/OrgFilesPanel";

const RepositorySync = dynamic(
  () => import("./RepositorySync").then((mod) => mod.RepositorySync),
  {
    ssr: false,
    loading: () => <SkeletonGitHubSync />,
  },
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilesTabMainProps {
  projectId: string;
  projectSlug?: string;
  projectName?: string;
  canOpenGitHub?: boolean;
  githubAccess?: GithubImportAccessState | null;
  isOwner?: boolean;
  deepLinkError?: string | null;
  onDismissDeepLinkError?: () => void;
}

// Stable empty object used by selectors reading `nodesById` when the
// workspace entry has not been created yet. Keeps Zustand selector
// equality (`Object.is`) stable across renders so we do not trigger
// gratuitous re-renders before the project workspace is hydrated.
const EMPTY_NODES = Object.freeze({}) as Record<string, WorkspaceNode>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilesTabMain({
  projectId,
  projectSlug,
  projectName,
  canOpenGitHub,
  githubAccess,
  isOwner,
  deepLinkError,
  onDismissDeepLinkError,
}: FilesTabMainProps): React.JSX.Element {
  const { canEdit, canManageFiles } = useFilesTabRole();
  const location = useCurrentLocation(projectId);
  const filesView = useFilesViews();
  const isCollection =
    filesView &&
    filesView.view !== "project" &&
    (!location || location.type === "root");

  // Read the booting state from the explorer context (injected via FilesTabRoot)
  const bootContext = React.useContext(FilesTabBootContext);
  const isBooting = bootContext?.isBooting ?? false;

  // Read the raw `currentLocationId` + `nodesById` so we can detect the
  // Req 1.8 "id set but unresolved" case independently of
  // `useCurrentLocation` (which masks it as `{ type: "root" }` to keep
  // the read selector total — surfaces handle their own error UX).
  const currentLocationId = useFilesStore(
    (s) => s.byProjectId[projectId]?.currentLocationId ?? null,
  );
  const nodesById = useFilesStore(
    (s) => s.byProjectId[projectId]?.nodesById ?? EMPTY_NODES,
  ) as Record<string, WorkspaceNode>;

  const unresolved =
    currentLocationId !== null && nodesById[currentLocationId] === undefined;

  return (
    <div
      data-testid="files-tab-main"
      className="flex-1 flex flex-col min-w-0 h-full relative"
    >
      <FilesHeader
        projectId={projectId}
        location={location}
        projectSlug={projectSlug}
        canOpenGitHub={canOpenGitHub}
      >
        {deepLinkError ? (
          <div
            role="alert"
            className="m-3 flex items-center justify-between rounded-[5px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          >
            <span>{deepLinkError}</span>
            {onDismissDeepLinkError ? (
              <button
                type="button"
                onClick={onDismissDeepLinkError}
                className="ml-2 font-mono text-[11px] hover:underline"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
        {!isCollection && (isBooting || unresolved) && (
          <FilesViewsMenu projectId={projectId} />
        )}
        {filesView?.branch && filesView.view === "project" ? (
          // On a branch, All files is the branch's tree (H2, the H-2b plan).
          <BranchExplorer projectId={projectId} />
        ) : isCollection ? (
          filesView.view === "github" ? (
            <RepositorySync
              key={projectId}
              projectId={projectId}
              projectSlug={projectSlug}
              projectName={projectName}
              canManage={Boolean(isOwner)}
              access={githubAccess ?? null}
            />
          ) : filesView.view === "tasks" ||
            filesView.view === "deliverables" ? (
            <TaskFilesCollection
              key={`${projectId}:${filesView.view}:${filesView.taskId ?? "all"}`}
              projectId={projectId}
            />
          ) : filesView.view === "trash" ? (
            <TrashFilesCollection projectId={projectId} />
          ) : filesView.view === "changes" ? (
            <ChangesCollection projectId={projectId} />
          ) : filesView.view === "history" ? (
            <HistoryCollection projectId={projectId} />
          ) : filesView.view === "branches" ? (
            <BranchesCollection projectId={projectId} />
          ) : filesView.view === "merge-requests" ? (
            <MergeRequestsCollection projectId={projectId} />
          ) : (filesView.view === "materials" || filesView.view === "submissions" || filesView.view === "from_org") && filesView.org ? (
            <OrgFilesCollection view={filesView.view} projectId={projectId} org={filesView.org} />
          ) : (
            <SavedFilesCollection projectId={projectId} />
          )
        ) : isBooting ? (
          <div
            role="status"
            aria-busy="true"
            aria-live="polite"
            aria-label="Loading workspace…"
            data-testid="files-tab-main-loading"
            className="flex-1 space-y-2 p-4"
          >
            <Skeleton className="h-8 w-44 rounded-[5px]" />
            <div className="space-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex h-10 items-center gap-3 rounded-[5px] border border-border/40 px-3">
                  <Skeleton className="size-4 rounded-[3px]" />
                  <Skeleton className="h-4 w-36 rounded-[3px]" />
                  <Skeleton className="ml-auto h-3 w-16 rounded-[3px]" />
                </div>
              ))}
            </div>
          </div>
        ) : unresolved ? (
          <LocationNotFound />
        ) : location === null ||
          location.type === "root" ||
          location.type === "folder" ? (
          <FolderListView
            projectId={projectId}
            folderId={
              location && location.type === "folder" ? location.id : null
            }
            canEdit={canEdit}
            canManageFiles={canManageFiles}
          />
        ) : (
          <FileView
            key={location.id}
            projectId={projectId}
            node={location.node}
            canEdit={canEdit}
          />
        )}
      </FilesHeader>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline: Req 1.8 error indicator
// ---------------------------------------------------------------------------
//
// Rendered when `currentLocationId` is set but the node cannot be resolved
// in `nodesById`. The Sidebar_Tree above us is untouched, so the user can
// still navigate elsewhere. The surface of the error is intentionally
// inline + non-modal — deep-link arrival race (Req 10.5) and mid-session
// cache eviction both land here and both benefit from a preserved tree
// state per Req 1.8.

function LocationNotFound(): React.JSX.Element {
  return (
    <div
      data-testid="files-tab-main-location-not-found"
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
    >
      <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">
        This location could not be found
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        The file or folder you requested is no longer available. Pick a
        different item from the sidebar to continue browsing.
      </p>
    </div>
  );
}

export default FilesTabMain;
