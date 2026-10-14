// Files main: folder/root renders the list; file renders FileView keyed by id.

"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import { useFilesTabRole } from "./FilesTabRoleContext";
import { useCurrentLocation } from "./hooks/useCurrentLocation";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import {
  FilesWorkspaceHeader,
  FilesWorkspaceMenu,
} from "./FilesWorkspaceHeader";
import { FolderListView } from "./folder/FolderListView";
import { FileView } from "./file/FileView";
import { useFilesWorkspaceView } from "./FilesWorkspaceViews";
import { TaskFilesCollection } from "./TaskFilesCollection";
import { SavedFilesCollection } from "./SavedFilesCollection";
import { TrashFilesCollection } from "./TrashFilesCollection";
import dynamic from "next/dynamic";
import type { GithubImportAccessState } from "@/lib/github/import-types";

const GitHubSyncWorkspace = dynamic(
  () => import("./GitHubSyncWorkspace").then((mod) => mod.GitHubSyncWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    ),
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
const EMPTY_NODES = Object.freeze({}) as Record<string, ProjectNode>;

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
  const workspaceView = useFilesWorkspaceView();
  const isCollection =
    workspaceView &&
    workspaceView.view !== "project" &&
    (!location || location.type === "root");

  // Read the booting state from the explorer context (injected via FilesTabRoot)
  const bootContext = React.useContext(FilesTabBootContext);
  const isBooting = bootContext?.isBooting ?? false;

  // Read the raw `currentLocationId` + `nodesById` so we can detect the
  // Req 1.8 "id set but unresolved" case independently of
  // `useCurrentLocation` (which masks it as `{ type: "root" }` to keep
  // the read selector total — surfaces handle their own error UX).
  const currentLocationId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.currentLocationId ?? null,
  );
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById ?? EMPTY_NODES,
  ) as Record<string, ProjectNode>;

  const unresolved =
    currentLocationId !== null && nodesById[currentLocationId] === undefined;

  return (
    <div
      data-testid="files-tab-main"
      className="flex-1 flex flex-col min-w-0 h-full relative"
    >
      <FilesWorkspaceHeader
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
          <FilesWorkspaceMenu projectId={projectId} />
        )}
        {isCollection ? (
          workspaceView.view === "github" ? (
            <GitHubSyncWorkspace
              projectId={projectId}
              projectSlug={projectSlug}
              projectName={projectName}
              canManage={isOwner ?? !!canOpenGitHub}
              access={githubAccess ?? null}
            />
          ) : workspaceView.view === "tasks" ||
            workspaceView.view === "deliverables" ? (
            <TaskFilesCollection
              key={`${projectId}:${workspaceView.view}:${workspaceView.taskId ?? "all"}`}
              projectId={projectId}
            />
          ) : workspaceView.view === "trash" ? (
            <TrashFilesCollection projectId={projectId} />
          ) : (
            <SavedFilesCollection projectId={projectId} />
          )
        ) : isBooting ? (
          <div
            role="status"
            aria-busy="true"
            aria-live="polite"
            aria-label="Loading workspace..."
            data-testid="files-tab-main-loading"
            className="flex-1 space-y-2 p-4"
          >
            <div className="h-8 w-44 rounded-[5px] bg-muted/60 animate-pulse" />
            <div className="space-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex h-10 items-center gap-3 rounded-[5px] border border-border/40 px-3">
                  <div className="size-4 rounded-[3px] bg-muted animate-pulse" />
                  <div className="h-4 w-36 rounded-[3px] bg-muted animate-pulse" />
                  <div className="ml-auto h-3 w-16 rounded-[3px] bg-muted/70 animate-pulse" />
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
      </FilesWorkspaceHeader>
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
