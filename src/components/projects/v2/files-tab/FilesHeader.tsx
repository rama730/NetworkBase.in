"use client";

import React, { useContext, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Github,
  Laptop,
  Info,
  Loader2,
  MoreHorizontal,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";
import { readHeaderGitHubSyncStatus } from "@/lib/files-tab-batch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFilesStore } from "@/stores/filesStore";
import {
  fileCollectionViews,
  useFilesViews,
} from "./FilesViews";
import { BreadcrumbBar } from "./breadcrumb/BreadcrumbBar";
import type { CurrentLocation } from "./navigation";
import { useFileTransfers } from "./FileTransfers";
import { QuickOpenDialog } from "./quick-open/QuickOpenDialog";

// ponytail: portal only controls, not state or mutation handlers. ceiling: single shared header slot. upgrade: separate floating toolbar if sub-panels require decoupled toolbars.
import { FilesHeaderContext, FilesHeaderSlot } from "./FilesHeaderSlot";
export { FilesHeaderSlot } from "./FilesHeaderSlot";
import { OpenInIdeButton, OpenInIdeSheet } from "./OpenInIdeButton";

export function FilesHeader({
  projectId,
  projectSlug,
  location,
  canOpenGitHub = false,
  children,
}: {
  projectId: string;
  projectSlug?: string;
  location: CurrentLocation | null;
  canOpenGitHub?: boolean;
  children: React.ReactNode;
}) {
  const workspace = useFilesViews();
  const transfers = useFileTransfers();
  const collapsed = useFilesStore(
    (s) => s.byProjectId[projectId]?.ui.sidebarCollapsed ?? false,
  );
  const toggleSidebar = useFilesStore((s) => s.toggleSidebar);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<HTMLDivElement | null>(null);
  const found = fileCollectionViews.find(
    (item) => item.id === workspace?.view,
  );
  const collection = found && workspace ? { ...found, label: workspace.viewLabel(found.id) } : found;
  const isProject = !workspace || workspace.view === "project";
  const isFile = location?.type === "file";
  const hasLocation = location && location.type !== "root";
  return (
    <FilesHeaderContext.Provider value={{ actions, status, canOpenGitHub, ide: { projectId, projectSlug, location, taskId: workspace?.taskId } }}>
      <header
        data-testid="files-header"
        className="flex h-12 min-h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2"
      >
        {collapsed && (
          <button
            type="button"
            data-testid="files-tab-sidebar-expand"
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={() => toggleSidebar(projectId)}
            className="nb-icon-button shrink-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          </button>
        )}
        {isFile && workspace?.query && (
          <button
            type="button"
            aria-label="Back to search results"
            title="Back to search results"
            onClick={workspace.returnToCollection}
            className="nb-icon-button shrink-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
        )}
        {isProject && !isFile && workspace?.query ? (
          <nav
            aria-label="Breadcrumb"
            className="nb-ui-label flex min-w-0 flex-1 items-center gap-2"
          >
            <button
              type="button"
              onClick={() => workspace.selectView("project")}
              className="min-w-0 truncate rounded py-2 hover:underline focus-visible:ring-2"
            >
              All files
            </button>
            <span aria-hidden="true">/</span>
            <span className="min-w-0 truncate">Search results</span>
          </nav>
        ) : isProject ? (
          <BreadcrumbBar projectId={projectId} location={location} />
        ) : (
          <nav
            aria-label="Breadcrumb"
            className="nb-ui-label flex min-w-0 flex-1 items-center gap-2"
          >
            {workspace?.taskId || hasLocation ? (
              <button
                type="button"
                onClick={() => workspace?.selectView(workspace.view)}
                title={collection?.label}
                className="min-w-0 truncate rounded py-2 hover:underline focus-visible:ring-2"
              >
                {collection?.label}
              </button>
            ) : (
              <span className="truncate font-medium">{collection?.label}</span>
            )}
            {workspace?.taskId && (
              <>
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  title={workspace.taskTitle || "Task files"}
                  onClick={workspace.returnToCollection}
                  className="min-w-0 truncate rounded py-2 hover:underline focus-visible:ring-2"
                >
                  {workspace.taskTitle || "Task files"}
                </button>
              </>
            )}
            {hasLocation && (
              <>
                <span aria-hidden="true">/</span>
                <span className="min-w-0 truncate" title={location.node.name}>
                  {location.node.name}
                </span>
              </>
            )}
          </nav>
        )}
        {!isFile && workspace?.query && (
          <button
            type="button"
            aria-label={`Clear search: ${workspace.query}`}
            title={`Search: ${workspace.query} — clear`}
            onClick={() => workspace.setQuery("")}
            className="flex min-h-9 max-w-[25%] min-w-0 items-center gap-1 rounded-[3px] border border-[#DBD5C8] bg-[#F3F0EA] px-2 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-[#141A1E] focus-visible:ring-2 focus-visible:ring-[#D14E24] dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <Search className="size-3 shrink-0 text-[#D14E24]" aria-hidden="true" />
            <span className="truncate">{workspace.query}</span>
            <X className="size-3 shrink-0 text-[#4C5A61]" aria-hidden="true" />
          </button>
        )}
        {!isFile && workspace?.taskId && workspace.fileRole !== "all" && (
          <button
            type="button"
            onClick={() => workspace.setFileRole("all")}
            aria-label="Clear file role filter"
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-[3px] border border-[#DBD5C8] bg-[#F3F0EA] px-2 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-[#141A1E] focus-visible:ring-2 focus-visible:ring-[#D14E24] dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            {workspace.fileRole === "reference" ? "References" : "Working"}
            <X className="size-3 text-[#4C5A61]" aria-hidden="true" />
          </button>
        )}
        <div
          ref={setStatus}
          className="nb-meta flex shrink-0 items-center gap-2"
        />
        {/* Phones keep the row to tree, breadcrumb, Upload and ⋯; GitHub and the IDE handoff live in ⋯ (spec §23). */}
        {canOpenGitHub && workspace?.view !== "trash" && (
          <span className="hidden md:contents"><HeaderGitHubSyncButton projectId={projectId} /></span>
        )}
        {workspace?.view !== "trash" && (
          <span className="hidden md:contents">
            <OpenInIdeButton
              projectId={projectId}
              projectSlug={projectSlug}
              location={location}
              taskId={workspace?.taskId}
            />
          </span>
        )}
        <div ref={setActions} className="flex shrink-0 items-center gap-1" />
        {!!transfers?.active && <button type="button" onClick={transfers.open} className="nb-ui-label min-h-[var(--ui-control-height)] shrink-0 rounded-md px-2" aria-label={`Show ${transfers.active} active transfers`}>↑ {transfers.active}</button>}
      </header>
      {children}
    </FilesHeaderContext.Provider>
  );
}

type HeaderStatus = {
  connected: boolean;
  authorized: boolean;
  repository: string | null;
  branch: string | null;
  hasIncoming: boolean;
  activeRun: {
    id: string;
    stage: string;
    direction: "push" | "pull";
  } | null;
  latestRunStatus: string | null;
  latestCommitSha?: string | null;
  latestDirection?: "push" | "pull" | null;
  latestSyncAt?: string | null;
  syncComment?: string | null;
};

function HeaderGitHubSyncButton({ projectId }: { projectId: string }) {
  const workspace = useFilesViews();
  const [status, setStatus] = useState<HeaderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    let active = true;
    const fetchStatus = () => {
      readHeaderGitHubSyncStatus(projectId)
        .then((res) => {
          if (active && res.success) {
            setStatus(res.data);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    fetchStatus();

    const handleFilesChanged = () => fetchStatus();
    window.addEventListener("project:task-files-changed", handleFilesChanged);

    return () => {
      active = false;
      window.removeEventListener("project:task-files-changed", handleFilesChanged);
    };
  }, [projectId, workspace?.view]);

  if (loading && !status) {
    return null;
  }

  const isGitHubView = workspace?.view === "github";

  if (!status?.connected || !status.authorized) {
    const needsAccess = Boolean(status?.connected && !status.authorized);
    return (
      <button
        type="button"
        onClick={() => workspace?.selectView("github")}
        title={needsAccess ? "Restore GitHub access" : "Connect GitHub Repository"}
        aria-label={needsAccess ? "Restore GitHub access" : "Connect GitHub Repository"}
        className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors border ${
          isGitHubView
            ? "border-[#2563C9] bg-[#EEF4FD] text-[#1B4BA8] dark:bg-[#1B4BA8]/20 dark:text-[#DCE7F8]"
            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Github className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{needsAccess ? "GitHub needs access" : "GitHub"}</span>
      </button>
    );
  }

  const isSyncing = Boolean(status.activeRun);
  const hasIncoming = status.hasIncoming;
  const branchName = status.branch || "main";
  const shortSha = status.latestCommitSha;
  const repoName = status.repository || "workspace";

  const openGitHubSync = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (workspace?.selectView) {
      workspace.selectView("github");
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("path");
      url.searchParams.delete("fileId");
      url.searchParams.delete("filesNav");
      url.searchParams.set("tab", "files");
      url.searchParams.set("filesView", "github");
      window.location.href = url.toString();
    }
  };

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={openGitHubSync}
        aria-label={`GitHub sync status for ${repoName}: ${branchName}${shortSha ? ` (commit ${shortSha})` : ""}`}
        className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors border ${
          isGitHubView
            ? "border-[#2563C9] bg-[#EEF4FD] text-[#1B4BA8] dark:bg-[#1B4BA8]/20 dark:text-[#DCE7F8]"
            : hasIncoming
            ? "border-[#C08A00] bg-[#FBF4E2] text-[#9A6B00] dark:border-[#C08A00]/40 dark:bg-amber-950/30 dark:text-amber-300"
            : isSyncing
            ? "border-[#2563C9] bg-[#EEF4FD] text-[#1B4BA8] dark:border-[#2563C9]/40 dark:bg-[#1B4BA8]/20 dark:text-[#DCE7F8]"
            : "border-border bg-card text-foreground hover:bg-muted"
        }`}
      >
        {isSyncing ? (
          <Loader2 className="size-3.5 animate-spin text-[#2563C9] dark:text-[#DCE7F8]" />
        ) : (
          <Github className="size-3.5" aria-hidden="true" />
        )}
        <span className="font-mono text-[11px] font-medium">
          {branchName}
        </span>
        {shortSha && !isSyncing && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
              commit {shortSha}
            </span>
          </>
        )}
        {hasIncoming && (
          <span className="flex size-2 rounded-[2px] bg-[#9A6B00] ring-2 ring-card animate-none" />
        )}
      </button>

      {/* Rich Professional Hover Popover (Zero DOM-churn, pure CSS visibility) */}
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 w-80 opacity-0 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[130ms] group-hover:pointer-events-auto group-hover:opacity-100">
        <div className="rounded-[8px] border border-border bg-card p-3 shadow-xl space-y-2.5 text-left">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div className="flex items-center gap-1.5 truncate">
              <Github className="size-3.5 shrink-0 text-foreground" />
              <span className="truncate text-xs font-semibold text-foreground">
                {status.repository}
              </span>
            </div>
            <span
              className={`shrink-0 rounded-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.09em] px-1.5 py-0.5 ${
                isSyncing
                  ? "bg-[#EEF4FD] text-[#1B4BA8] dark:bg-[#1B4BA8]/20 dark:text-[#DCE7F8]"
                  : hasIncoming
                  ? "bg-[#FBF4E2] text-[#9A6B00] border border-[#F6E7C2] dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-[#EDF5F0] text-[#1E7E34] border border-[#CDE5D4] dark:bg-emerald-950/40 dark:text-emerald-300"
              }`}
            >
              {isSyncing ? "Syncing..." : hasIncoming ? "Incoming" : "Synced"}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-mono text-[11px]">
              Branch: <strong className="font-semibold text-foreground">{branchName}</strong>
            </span>
            {shortSha && status.repository && (
              <a
                href={`https://github.com/${status.repository}/commit/${shortSha}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#2563C9] hover:underline dark:text-[#DCE7F8] font-medium"
                onClick={(e) => e.stopPropagation()}
              >
                Commit: {shortSha}
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={openGitHubSync}
            className="flex w-full items-center justify-between border-t border-border pt-2 text-xs font-medium text-[#2563C9] hover:underline dark:text-[#DCE7F8] transition-colors cursor-pointer group/link"
          >
            <span>Open repository sync</span>
            <span aria-hidden="true" className="transition-transform group-hover/link:translate-x-0.5"></span>
          </button>
        </div>
      </div>
    </div>
  );
}

const collectionInfo = {
  github: "Review selected workspace files before publishing to GitHub or importing changes. Task drafts and Trash are excluded. GitHub permissions and workspace membership remain separate.",
  project:
    "Workspace files are stored in folders. Search finds accessible filenames across the workspace, not just the currently loaded rows. Upload and New use the open folder.",
  tasks:
    "Draft files and references are grouped by task. Linked files stay in their original location. Open a task to add or link files with an explicit role.",
  deliverables:
    "Submitted outputs with version-specific review status. New versions require a new approval; a completed task does not automatically approve every file.",
  recent:
    "Recent files are shortcuts saved in this browser, ordered by when you opened them. Deleted files and files you can no longer access are excluded.",
  starred:
    "Starred files are shortcuts saved in this browser. Star or unstar a file from its actions menu. Deleted files and inaccessible files are excluded.",
  trash:
    "Restore an item and the contents deleted with it. Earlier deletions stay in Trash. Permanent deletion cannot be undone and does not delete anything from GitHub.",
};

export function FilesViewsMenu({
  projectId,
  children,
  selectionMode = false,
}: {
  projectId: string;
  children?: React.ReactNode;
  selectionMode?: boolean;
}) {
  const workspace = useFilesViews();
  const transfers = useFileTransfers();
  const header = useContext(FilesHeaderContext);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingSurface = useRef<"search" | "info" | "ide" | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [surface, setSurface] = useState<"search" | "info" | "ide" | null>(null);
  const [draft, setDraft] = useState("");
  const view = workspace?.view ?? "project";
  const label = workspace?.viewLabel(view) ?? fileCollectionViews.find((item) => item.id === view)!.label;
  const searchLabel = workspace?.taskId
    ? `Search ${workspace.taskTitle || "task files"}`
    : `Search ${label.toLowerCase()}`;
  function closeSurface() {
    setSurface(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <>
      <FilesHeaderSlot>
        {/* The destination dialog owns modality. A modal menu can retain its
          body pointer lock when a dialog opens during the menu exit. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              ref={trigger}
              type="button"
              aria-label={
                selectionMode ? "Selected file actions" : "Files actions"
              }
              title={selectionMode ? "Selected file actions" : "Files actions"}
              data-testid="files-views-menu"
              className="nb-touch-target flex size-8 items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-[#D14E24]"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionPadding={8}
            className="w-56 max-w-[calc(100vw-16px)] [&_[role=menuitem]]:min-h-10 [&_[role=menuitemradio]]:min-h-10"
            onCloseAutoFocus={(event) => {
              if (pendingSurface.current) {
                event.preventDefault();
                setSurface(pendingSurface.current);
                pendingSurface.current = null;
              }
            }}
          >
            {!selectionMode && (
              <DropdownMenuItem
                onSelect={() => {
                  setDraft(workspace?.query ?? "");
                  pendingSurface.current = "search";
                }}
              >
                <Search className="size-4" />
                Search…
              </DropdownMenuItem>
            )}
            {children}
            {!selectionMode && (
              <>
                <DropdownMenuSeparator />
                {header?.canOpenGitHub && view !== "trash" && workspace?.selectView ? (
                  <DropdownMenuItem className="md:hidden" onSelect={() => workspace.selectView("github")}>
                    <Github className="size-4" />
                    GitHub sync
                  </DropdownMenuItem>
                ) : null}
                {header?.ide && view !== "trash" ? (
                  <DropdownMenuItem
                    className="md:hidden"
                    onSelect={() => {
                      pendingSurface.current = "ide";
                    }}
                  >
                    <Laptop className="size-4" />
                    Connect desktop IDE…
                  </DropdownMenuItem>
                ) : null}
                {transfers && <DropdownMenuItem onSelect={transfers.open}>Transfers…</DropdownMenuItem>}
                <DropdownMenuItem
                  onSelect={() => {
                    pendingSurface.current = "info";
                  }}
                >
                  <Info className="size-4" />
                  About {label.toLowerCase()}…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </FilesHeaderSlot>
      {view === "project" && (
        <QuickOpenDialog
          projectId={projectId}
          open={surface === "search"}
          query={draft}
          onQueryChange={setDraft}
          onOpenChange={(open) => {
            if (!open) closeSurface();
          }}
          includeFolders
          onApplyQuery={(query) => {
            workspace?.setQuery(query);
            closeSurface();
          }}
        />
      )}
      {header?.ide ? (
        <OpenInIdeSheet open={surface === "ide"} onOpenChange={(open) => { if (!open) closeSurface(); }} {...header.ide} />
      ) : null}
      <Dialog
        open={
          surface === "info" || (surface === "search" && view !== "project")
        }
        onOpenChange={(open) => {
          if (!open) closeSurface();
        }}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            if (surface === "search") {
              event.preventDefault();
              searchInput.current?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          className="max-w-[calc(100vw-2rem)] sm:max-w-lg"
        >
          <DialogTitle>{surface === "info" ? label : searchLabel}</DialogTitle>
          <DialogDescription>
            {surface === "info"
              ? collectionInfo[view]
              : view === "tasks" || view === "deliverables"
                ? workspace?.taskId
                  ? "Find filenames in this task. Your role filter is retained."
                  : "Find tasks by title or their attached filenames."
                : "Find file names in this view."}
          </DialogDescription>
          {surface === "search" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                workspace?.setQuery(draft.trim());
                closeSurface();
              }}
              className="space-y-4"
            >
              <label className="block text-sm">
                Search
                <input
                  ref={searchInput}
                  type="search"
                  maxLength={256}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="nb-touch-target mt-2 h-9 w-full rounded-[5px] border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D14E24]"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeSurface}
                  className="nb-touch-target h-9 rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="nb-touch-target h-9 rounded-[5px] bg-primary px-3 text-xs font-medium text-primary-foreground transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                >
                  Show results
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
