"use client";

import { useMemo } from "react";
import { AlertTriangle, File, FolderTree } from "lucide-react";
import type { UploadManifest } from "./upload-manifest";
import { formatUploadBytes } from "./upload-manifest";

const STATE_ORDER = { blocked: 0, warning: 1, ready: 2 } as const;

export function UploadManifestPreview({ manifest }: { manifest: UploadManifest }) {
  const visibleEntries = useMemo(() => {
    return [...manifest.entries]
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
      .slice(0, 12);
  }, [manifest.entries]);
  const remainingCount = Math.max(0, manifest.entries.length - visibleEntries.length);

  return (
    <section className="border-t border-border pt-5" aria-labelledby="upload-manifest-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 id="upload-manifest-title" className="nb-card-title text-foreground">Folder contents</h3>
          <p className="nb-compact mt-1 text-muted-foreground">
            Review what will be attached when the project is created.
          </p>
        </div>
        <div className="nb-meta flex flex-wrap gap-2 text-muted-foreground">
          <span>{manifest.totalFiles} files</span>
          <span aria-hidden="true">·</span>
          <span>{formatUploadBytes(manifest.totalBytes)}</span>
        </div>
      </div>

      {manifest.blockedCount > 0 ? (
        <div role="alert" className="flex gap-3 border-b border-[var(--status-danger)]/25 bg-[var(--status-danger-soft)] px-4 py-3 text-[var(--status-danger)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="nb-compact">
            {manifest.blockedCount} {manifest.blockedCount === 1 ? "file needs" : "files need"} attention before you can continue.
          </p>
        </div>
      ) : manifest.warningCount > 0 ? (
        <div className="flex gap-3 border-b border-[var(--status-warning)]/25 bg-[var(--status-warning-soft)] px-4 py-3 text-[var(--status-warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="nb-compact">
            {manifest.warningCount} {manifest.warningCount === 1 ? "file has" : "files have"} a non-blocking warning.
          </p>
        </div>
      ) : null}

      <div role="list" aria-label="Selected folder files">
        {visibleEntries.map((entry) => (
          <div key={entry.path} role="listitem" className="flex min-h-12 items-center gap-3 border-b border-border py-2 last:border-b-0">
            <File className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="nb-meta block truncate text-foreground" title={entry.path}>{entry.path}</span>
              {entry.message ? <span className="nb-meta mt-0.5 block truncate text-muted-foreground">{entry.message}</span> : null}
            </span>
            <span className="nb-meta shrink-0 text-muted-foreground">{formatUploadBytes(entry.size)}</span>
            {entry.state !== "ready" ? (
              <span
                className="nb-status shrink-0"
                data-status={entry.state === "blocked" ? "blocked" : "draft"}
                aria-label={`${entry.state}: ${entry.message ?? entry.path}`}
              >
                {entry.state}
              </span>
            ) : null}
          </div>
        ))}
        {remainingCount > 0 ? (
          <div className="nb-compact flex min-h-12 items-center gap-3 py-2 text-muted-foreground">
            <FolderTree className="size-4" aria-hidden="true" />
            {remainingCount} more {remainingCount === 1 ? "file" : "files"}
          </div>
        ) : null}
      </div>
    </section>
  );
}
