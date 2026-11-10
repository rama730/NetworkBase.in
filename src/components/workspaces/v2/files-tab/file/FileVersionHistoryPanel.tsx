// Task 7.2 — `FileVersionHistoryPanel` component.
//
// A collapsible right-side drawer on FileView that displays all File_Version
// records for the currently viewed file, ordered by versionNumber descending.
//
// Requirements covered:
//   - Req 10.2: Display all File_Version records ordered by versionNumber desc
//   - Req 10.3: "View history" button visible to all roles
//   - Req 10.4: Role_Owner/Role_Member: render "Restore" action on each historical version row
//   - Req 10.5: Role_Viewer: no "Restore" action visible
//   - Req 10.6: On "Restore" click: call useFileVersions.restoreVersion(versionNumber), update MetadataStrip
//   - Req 10.7: Soft-deleted node: read-only mode, "This file is in the trash" banner, Restore disabled
//   - Req 14.1: Soft-deleted node: display all File_Version records in read-only mode
//   - Req 14.2: Soft-deleted node: display "This file is in the trash" notice
//   - Req 14.3: Soft-deleted node: "Restore" action disabled for all roles
//   - Req 17.2: performance.mark on first interactive state
//   - Req 24.2: Role_Viewer: no "Restore" actions on version rows

"use client";

import { toast, feedbackError } from "@/lib/feedback";

import * as React from "react";
import {
  Download,
  GitCompare,
  History,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useFileVersions } from "@/hooks/useFileVersions";
import { useFilesStore } from "@/stores/filesStore";
import { ViaLabel } from "@/components/ui/via-label";
import type { FileVersion } from "@/lib/db/schema";
import { VersionPill } from "../VersionPill";
import { FileInspectorPanelHeader } from "./FileInspectorPanelHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes, formatFileActor } from "../folder/format";
import { downloadFile, workspaceFileUrl } from "@/lib/download";

type FileVersionWithUploader = FileVersion & {
  uploadedByName?: string | null;
  uploadedByUsername?: string | null;
};

/** Formats timestamp to date and year only (e.g. "22 Jun 2026"), omitting time. */
function formatFileVersionDate(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// ─── Props ───────────────────────────────────────────────────────────

export interface FileVersionHistoryPanelProps {
  projectId: string;
  nodeId: string;
  nodeName: string;
  /** Whether the current user can perform mutations (Role_Owner or Role_Member). */
  canEdit: boolean;
  /** Deleting history needs manage_files (owner/admin), not just edit rights. */
  canDeleteVersions?: boolean;
  /** Why Restore/Delete are off right now (e.g. your own editor holds the file). */
  actionsLockedReason?: string | null;
  /** Current version number from the node — used to highlight the active row. */
  currentVersion: number;
  /** Whether the node is soft-deleted (deletedAt is not null). Req 10.7, 14.1–14.3. */
  isDeleted?: boolean;
  /** Optional uploader display names keyed by user id. */
  uploaderNames?: Record<string, string>;
  isTextKind?: boolean;
  onCompareClick?: (versionNumber: number, targetVersionNumber?: number) => void;
  onVersionChangeStart?: () => void;
  onVersionChanged?: (versionNumber: number | null) => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function FileVersionHistoryPanel({
  projectId,
  nodeId,
  nodeName,
  canEdit,
  canDeleteVersions = false,
  actionsLockedReason = null,
  currentVersion,
  isDeleted = false,
  uploaderNames,
  isTextKind = true,
  onCompareClick,
  onVersionChangeStart,
  onVersionChanged,
  onClose,
}: FileVersionHistoryPanelProps): React.JSX.Element {
  const {
    versions,
    isLoading,
    error,
    hasMore,
    listVersions,
    loadMoreVersions,
    restoreVersion,
    deleteVersion,
  } = useFileVersions(projectId, nodeId);

  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const [pendingDeleteVersion, setPendingDeleteVersion] =
    React.useState<FileVersion | null>(null);

  // ponytail: listVersions dependency re-fetches when nodeId changes. ceiling: single file version panel. upgrade: React Query cache if version lists are shared across multiple drawer tabs.
  React.useEffect(() => {
    perfMarkedRef.current = false;
    void listVersions();
  }, [listVersions]);

  // ── Performance mark (Req 17.2) ────────────────────────────────────
  const perfMarkedRef = React.useRef(false);
  React.useEffect(() => {
    if (isLoading) return;
    if (perfMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:version-history-interactive");
    perfMarkedRef.current = true;
  }, [isLoading]);

  // ── Restore handler (Req 10.6) ─────────────────────────────────────
  const handleRestore = React.useCallback(
    async (version: FileVersion) => {
      // Req 14.3: Soft-deleted node — Restore disabled for all roles
      if (isDeleted) return;
      // Req 10.5, 24.2: Role_Viewer — no Restore action
      if (!canEdit) return;

      const actionKey = `restore:${version.id}`;
      setPendingAction(actionKey);
      onVersionChangeStart?.();
      try {
        const result = await restoreVersion(version.version);
        if (result.success) {
          const { previousVersion } = result;
          // Nothing was copied or deleted, so Undo just makes the earlier active version active again.
          toast.success(`Now using v${version.version}`, previousVersion !== version.version ? {
            action: { label: "Undo", onClick: () => void restoreVersion(previousVersion).then((back) => {
              if (!back.success) return void toast.error(feedbackError(back.error, "Couldn’t undo"));
              useFilesStore.getState().setNodes(projectId, [back.node]);
              window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
              void listVersions();
            }) },
          } : undefined);

          useFilesStore.getState().setNodes(projectId, [result.node]);
          window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));

          // Emit telemetry (Req 16.4) — Task 7.5 wires this
          logger.metric("files_tab.version_restored", {
            module: "files-tab",
            projectId,
            nodeId,
            restoredFromVersion: previousVersion,
            newVersion: result.version.version,
          });
          // Refresh the list to show the updated active version
          await listVersions();
        } else {
          toast.error(feedbackError(result.error || "Restore failed", "Restore failed"));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Restore failed";
        toast.error(feedbackError(message, "Action couldn’t finish"));
      } finally {
        setPendingAction(null);
        onVersionChanged?.(null);
      }
    },
    [canEdit, isDeleted, projectId, nodeId, restoreVersion, listVersions, onVersionChangeStart, onVersionChanged],
  );

  // ── Download handler with client cache ──────────────────────────────
  const handleDownload = React.useCallback(
    async (version: FileVersion) => {
      const actionKey = `dl:${version.id}`;
      setPendingAction(actionKey);
      try {
        await downloadFile(workspaceFileUrl(projectId, nodeId, version.version));
      } finally {
        setPendingAction(null);
      }
    },
    [projectId, nodeId, nodeName],
  );

  // ── Delete handler (Lead / Co-Lead) ─────────────────────────────────
  const handleDelete = React.useCallback(
    async (version: FileVersion) => {
      if (isDeleted) return;
      if (!canDeleteVersions) return;

      const actionKey = `delete:${version.id}`;
      setPendingAction(actionKey);
      onVersionChangeStart?.();
      try {
        const result = await deleteVersion(version.version);
        if (result.success) {
          toast.success(`Deleted version ${version.version}`);
          
          if (result.node) {
            useFilesStore.getState().setNodes(projectId, [result.node]);
          }
          window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
          await listVersions();
        } else {
          toast.error(feedbackError(result.error || "Delete failed", "Delete failed"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Delete failed";
        toast.error(feedbackError(message, "Action couldn’t finish"));
      } finally {
        setPendingAction(null);
        onVersionChanged?.(null);
      }
    },
    [canDeleteVersions, isDeleted, projectId, nodeId, deleteVersion, listVersions, onVersionChangeStart, onVersionChanged]
  );

  // ── Uploader label helper ───────────────────────────────────────────
  const uploaderLabel = React.useCallback(
    (version: FileVersionWithUploader) => {
      const directName =
        typeof version.uploadedByName === "string"
          ? version.uploadedByName.trim()
          : "";
      if (directName) return directName;
      const directUsername =
        typeof version.uploadedByUsername === "string"
          ? version.uploadedByUsername.trim()
          : "";
      if (directUsername) return directUsername;
      const userId = version.uploadedBy;
      return formatFileActor({ updatedByName: userId ? uploaderNames?.[userId] : null });
    },
    [uploaderNames],
  );

  // ── Tabular Size Deltas relative to prior revision ───────────────────
  const sizeDeltaMap = React.useMemo(() => {
    const map = new Map<number, { label: string; tone: "positive" | "negative" | "neutral" }>();
    if (!versions.length) return map;

    // Sort ascending by version number to compute sequential diff
    const sortedAsc = [...versions].sort((a, b) => a.version - b.version);
    const byNumber = new Map(sortedAsc.map((v) => [v.version, v]));
    for (let i = 0; i < sortedAsc.length; i++) {
      const current = sortedAsc[i]!;
      // Compared with the version it was saved from ("based on v1"), else the one before it.
      const prev = (current.basedOnVersion != null ? byNumber.get(current.basedOnVersion) : undefined) ?? sortedAsc[i - 1];
      if (!prev || current.size == null || prev.size == null) {
        map.set(current.version, { label: "Base", tone: "neutral" });
      } else {
        const diff = current.size - prev.size;
        if (diff === 0) {
          map.set(current.version, { label: "±0 B", tone: "neutral" });
        } else if (diff > 0) {
          map.set(current.version, { label: `+${formatBytes(diff)}`, tone: "positive" });
        } else {
          map.set(current.version, { label: `-${formatBytes(Math.abs(diff))}`, tone: "negative" });
        }
      }
    }
    return map;
  }, [versions]);

  // Determine if Restore should be shown at all:
  // - canEdit must be true (Role_Owner/Role_Member)
  // - node must NOT be soft-deleted
  const showRestoreAction = canEdit && !isDeleted;

  // The active version first, then the rest newest first (versions only grow; going back moves the active one).
  // ponytail: an active version older than the loaded page stays in its page until "Load older versions"; the header pill still names it.
  const orderedVersions = React.useMemo(
    () => [...versions].sort((a, b) => Number(b.version === currentVersion) - Number(a.version === currentVersion) || b.version - a.version),
    [versions, currentVersion],
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <>
    <div
      data-testid="file-version-history-panel"
      className={cn(
        "flex h-full w-full shrink-0 flex-col bg-white",
        "dark:bg-card",
      )}
    >
      <FileInspectorPanelHeader
        title="Version"
        onClose={onClose}
        closeLabel="Close version history"
        closeTestId="files-tab-version-history-close"
        subtitle={
          <div className="flex items-center gap-1.5">
          <p className="truncate text-[11px] text-muted-foreground">
            {nodeName}
          </p>
          <VersionPill v={currentVersion} className="h-3.5 px-1 text-[11px]" />
          </div>
        }
      />

      {actionsLockedReason && !isDeleted ? (
        <p role="status" className="border-b border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
          {actionsLockedReason}
        </p>
      ) : null}

      {/* Soft-deleted banner (Req 10.7, 14.2) */}
      {isDeleted && (
        <div
          data-testid="file-version-history-panel-deleted-banner"
          className={cn(
            "flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2",
            "dark:border-amber-800/50 dark:bg-amber-950/30",
          )}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            This file is in the trash
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading && versions.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading versions…
          </div>
        ) : error ? (
          <div role="alert" className="px-3 py-6 text-center text-xs text-red-500">
            {error}
            <button type="button" onClick={() => void listVersions()} className="mx-auto mt-3 block min-h-10 rounded border px-3">Retry</button>
          </div>
        ) : versions.length === 0 ? (
          <div className="p-3">
            <div className="nb-empty-state nb-grid-ground py-8 text-center" role="status">
              <div className="nb-empty-state-icon-box">
                <History className="nb-empty-state-icon" />
              </div>
              <h4 className="nb-empty-state-title">No version history</h4>
              <p className="nb-empty-state-desc">No version history available for this file yet.</p>
            </div>
          </div>
        ) : (
          <ul role="list" className="p-2 space-y-2">
            {orderedVersions.map((version) => {
              const isCurrent = version.version === currentVersion;
              const notActive = version.version > currentVersion;
              const basedOn = version.basedOnVersion != null && version.basedOnVersion !== version.version - 1 ? version.basedOnVersion : null;
              const dlKey = `dl:${version.id}`;
              const restoreKey = `restore:${version.id}`;

              return (
                <li
                  key={version.id}
                  data-testid={`version-row-${version.version}`}
                  className={cn(
                    "rounded-[6px] border p-3 transition-colors",
                    isCurrent
                      ? "border-[#D14E24] bg-[#FCF0EA]/40 dark:border-[#D14E24]/60 dark:bg-[#D14E24]/10 shadow-xs"
                      : "border-[#DBD5C8] bg-white hover:border-[#B6C0C5] dark:border-border dark:bg-card dark:hover:border-border",
                  )}
                >
                  {/* Top Row: Version Badge + Size + Delta + (Active Pill or Delete action) */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "flex h-5 px-1.5 items-center justify-center rounded-[3px] border font-mono text-[11px] font-semibold",
                          isCurrent
                            ? "border-[#D14E24]/40 bg-white text-[#D14E24] dark:border-[#D14E24]/50 dark:bg-card"
                            : "border-[#DBD5C8] bg-white text-[#141A1E] dark:border-border dark:bg-card dark:text-foreground",
                        )}
                      >
                        v{version.version}
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-[12px]">
                        <span className="text-[#4C5A61] dark:text-muted-foreground">
                          {formatBytes(version.size) || "Size not recorded"}
                        </span>
                        {sizeDeltaMap.has(version.version) && (
                          <span
                            className={cn(
                              "px-1 py-0.2 rounded-[2px] text-[10px] max-md:text-[11px] font-semibold tabular-nums",
                              sizeDeltaMap.get(version.version)?.tone === "positive" &&
                                "bg-[#EDF5F0] text-[#245A41] dark:bg-emerald-950/40 dark:text-emerald-300",
                              sizeDeltaMap.get(version.version)?.tone === "negative" &&
                                "bg-[#FCEDEB] text-[#96201A] dark:bg-red-950/40 dark:text-red-300",
                              sizeDeltaMap.get(version.version)?.tone === "neutral" &&
                                "bg-[#F3F0EA] text-[#6B7880] dark:bg-muted dark:text-muted-foreground",
                            )}
                            title="Size change"
                          >
                            {sizeDeltaMap.get(version.version)?.label}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {notActive ? (
                        <span className="rounded-[2px] border border-[#DBD5C8] bg-[#F3F0EA] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-medium text-[#6B7880] dark:border-border dark:bg-muted dark:text-muted-foreground">
                          Newer · not active
                        </span>
                      ) : null}
                      {isCurrent ? (
                        <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#D8E8DF] bg-[#EDF5F0] px-1.5 py-0.5 font-mono text-[10px] max-md:text-[11px] font-semibold uppercase tracking-wider text-[#245A41] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-[2px] bg-[#2F6B4F]" aria-hidden="true" />
                          Active
                        </span>
                      ) : canDeleteVersions && !isDeleted ? (
                        <button
                          type="button"
                          disabled={pendingAction === `delete:${version.id}`}
                          onClick={() => setPendingDeleteVersion(version)}
                          aria-label={`Delete version ${version.version}`}
                          title="Delete version"
                          className="inline-flex size-6 items-center justify-center rounded-[3px] text-[#96201A] transition-colors hover:bg-[#FCEDEB] disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          {pendingAction === `delete:${version.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Author & Date Row (Name, date, year — NO TIME) */}
                  <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#374349] dark:text-muted-foreground">
                    <span className="font-medium text-[#141A1E] dark:text-foreground truncate max-w-[140px]">
                      {uploaderLabel(version)}
                    </span>
                    <ViaLabel via={version.via} agentName={version.agentName} />
                    <span className="text-[#DBD5C8] dark:text-muted-foreground/40">·</span>
                    <span className="font-mono text-[11px] text-[#6B7880] dark:text-muted-foreground whitespace-nowrap">
                      {formatFileVersionDate(version.uploadedAt)}
                    </span>
                  </div>

                  {basedOn ? (
                    <p className="mt-1 text-[11px] text-[#6B7880] dark:text-muted-foreground">Based on v{basedOn}</p>
                  ) : null}

                  {/* Comment/Note if present */}
                  {version.comment && (
                    <div className="mt-2 rounded-[3px] border border-[#DBD5C8] bg-[#F3F0EA] px-2 py-1 text-[11px] text-[#374349] dark:border-border dark:bg-card dark:text-muted-foreground leading-relaxed font-sans">
                      {version.comment}
                    </div>
                  )}

                  {/* 28px Action Toolbar */}
                  {isCurrent ? (
                    <div className="mt-2.5 flex items-center justify-between border-t border-[#DBD5C8]/60 pt-2 dark:border-border">
                      <button
                        type="button"
                        disabled={pendingAction === dlKey}
                        onClick={() => void handleDownload(version)}
                        aria-label={`Download version ${version.version}`}
                        title="Download"
                        className="nb-touch-target inline-flex h-7 items-center justify-center gap-1.5 rounded-[5px] border border-[#DBD5C8] bg-white px-2.5 text-[12px] font-medium text-[#141A1E] whitespace-nowrap transition-colors hover:bg-[#F3F0EA] disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
                      >
                        {pendingAction === dlKey ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5 text-[#4C5A61] dark:text-muted-foreground shrink-0" />
                        )}
                        <span>Download</span>
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2.5 border-t border-[#DBD5C8]/60 pt-2 dark:border-border">
                      {/* Three identical equal-sized buttons: Download, Compare, Restore */}
                      <div className="flex items-center gap-1.5">
                        {/* Download button */}
                        <button
                          type="button"
                          disabled={pendingAction === dlKey}
                          onClick={() => void handleDownload(version)}
                          aria-label={`Download version ${version.version}`}
                          title="Download"
                          className="nb-touch-target inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-[5px] border border-[#DBD5C8] bg-white px-1.5 text-[11px] font-medium text-[#141A1E] whitespace-nowrap transition-colors hover:bg-[#F3F0EA] disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
                        >
                          {pendingAction === dlKey ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5 text-[#4C5A61] dark:text-muted-foreground shrink-0" />
                          )}
                          <span>Download</span>
                        </button>

                        {/* Compare button */}
                        {onCompareClick && !isCurrent && isTextKind && (
                          <button
                            type="button"
                            onClick={() => onCompareClick(version.version)}
                            aria-label={`Compare version ${version.version} with active`}
                            title="Compare with active"
                            className="nb-touch-target inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-[5px] border border-[#DBD5C8] bg-white px-1.5 text-[11px] font-medium text-[#141A1E] whitespace-nowrap transition-colors hover:bg-[#F3F0EA] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
                          >
                            <GitCompare className="h-3.5 w-3.5 text-[#4C5A61] dark:text-muted-foreground shrink-0" />
                            <span>Compare</span>
                          </button>
                        )}

                        {/* Restore button */}
                        {showRestoreAction && !isCurrent && (
                          <button
                            type="button"
                            disabled={pendingAction === restoreKey}
                            onClick={() => void handleRestore(version)}
                            aria-label={`Use version ${version.version}`}
                            title={`Make v${version.version} the active version`}
                            data-testid={`version-restore-${version.version}`}
                            className="nb-touch-target inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-[5px] border border-[#D14E24]/30 bg-[#FCF0EA] px-1.5 text-[11px] font-medium text-[#D14E24] whitespace-nowrap transition-colors hover:bg-[#F7DFD5] disabled:opacity-50 dark:border-[#D14E24]/50 dark:bg-[#D14E24]/20 dark:text-[#FCF0EA]"
                          >
                            {pendingAction === restoreKey ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span>Use this version</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
            {hasMore ? (
              <li className="flex justify-center py-2">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void loadMoreVersions()}
                  className="nb-touch-target inline-flex min-h-9 items-center justify-center gap-2 rounded-[5px] border border-[#DBD5C8] bg-white px-3 text-xs font-medium text-[#141A1E] transition-colors hover:bg-[#F3F0EA] disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
                >
                  {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Load older versions
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {/* Footer note */}
      <div className="shrink-0 border-t border-[#DBD5C8] bg-[#F3F0EA] px-4 py-2.5 dark:border-border dark:bg-card/50">
        <p className="text-[11px] text-[#6B7880] dark:text-muted-foreground leading-normal">
          Using another version never deletes or rewrites one. Saving after it adds a new version.
        </p>
      </div>
    </div>
    <ConfirmDialog
      open={Boolean(pendingDeleteVersion)}
      onOpenChange={(open) => !open && setPendingDeleteVersion(null)}
      title="Delete file version"
      description={
        pendingDeleteVersion
          ? `Permanently delete version ${pendingDeleteVersion.version}? This version’s file will be deleted and this can’t be undone.`
          : "This version will be permanently deleted."
      }
      confirmLabel="Delete version"
      variant="destructive"
      onConfirm={async () => {
        const version = pendingDeleteVersion;
        if (!version) return;
        await handleDelete(version);
        setPendingDeleteVersion(null);
      }}
    />
    </>
  );
}

export default FileVersionHistoryPanel;
