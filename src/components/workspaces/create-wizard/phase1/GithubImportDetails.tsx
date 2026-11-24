"use client";

import type { ReactNode } from "react";
import { AlertTriangle, GitBranch, Globe2, LockKeyhole } from "@/components/ui/icons";
import { SkillList } from "@/components/skills/SkillList";

type GithubImportDetailsProps = {
  status: "idle" | "loading" | "ready" | "error";
  repositoryName: string;
  visibility: string | null;
  branch: string | null;
  description: string | null;
  technologies: string[];
  counts: { files: number; folders: number; ignored: number; tooLarge: number };
  sizeKb: number | null;
  updatedAt: string | null;
  authSource: string | null;
  warnings: string[];
  errorMessage: string | null;
  branchControl?: ReactNode;
  fileTree?: ReactNode;
};

function formatRepositorySize(sizeKb: number | null) {
  if (sizeKb === null || !Number.isFinite(sizeKb)) return null;
  if (sizeKb < 1024) return `${Math.max(0, Math.round(sizeKb))} KB`;
  return `${(sizeKb / 1024).toFixed(sizeKb >= 10_240 ? 0 : 1)} MB`;
}

function formatUpdatedDate(updatedAt: string | null) {
  if (!updatedAt) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function ImportDetailsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading repository details">
      <div aria-hidden="true" className="nb-skeleton h-5 w-56 rounded-sm" />
      <div aria-hidden="true" className="nb-skeleton h-3 w-4/5 rounded-sm" />
      <div className="grid gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} aria-hidden="true" className="nb-skeleton h-10 rounded-sm" />)}
      </div>
      <div className="space-y-px border-y border-border">
        {[0, 1, 2, 3].map((item) => <div key={item} aria-hidden="true" className="nb-skeleton h-12" />)}
      </div>
    </div>
  );
}

export function GithubImportDetails({
  status,
  repositoryName,
  visibility,
  branch,
  description,
  technologies,
  counts,
  sizeKb,
  updatedAt,
  authSource,
  warnings,
  errorMessage,
  branchControl,
  fileTree,
}: GithubImportDetailsProps) {
  const VisibilityIcon = visibility === "private" ? LockKeyhole : Globe2;
  const repositorySize = formatRepositorySize(sizeKb);
  const repositoryUpdatedAt = formatUpdatedDate(updatedAt);

  return (
    <section className="border-t border-border pt-6" aria-labelledby="github-import-details-title">
      {status === "loading" ? <ImportDetailsSkeleton /> : null}

      {status === "error" ? (
        <div className="flex gap-3 border-y border-[var(--status-danger)]/25 bg-[var(--status-danger-soft)] px-4 py-3 text-[var(--status-danger)]" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <h3 id="github-import-details-title" className="nb-card-title">Repository could not be loaded</h3>
            <p className="nb-compact mt-1">{errorMessage || "Check the repository URL and try again."}</p>
          </div>
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 id="github-import-details-title" className="nb-section-title break-words text-foreground">{repositoryName}</h3>
              {description ? <p className="nb-body mt-2 max-w-[64ch] text-muted-foreground">{description}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {visibility ? (
                <span className="nb-status" data-status="active"><VisibilityIcon className="size-3.5" aria-hidden="true" />{visibility}</span>
              ) : null}
              {branchControl ?? (branch ? (
                <span className="nb-status" data-status="active"><GitBranch className="size-3.5" aria-hidden="true" />{branch}</span>
              ) : null)}
            </div>
          </div>

          <dl className="flex flex-wrap gap-x-5 gap-y-2 border-y border-border py-3">
            <div className="flex gap-2"><dt className="nb-meta text-muted-foreground">Files</dt><dd className="nb-meta text-foreground">{counts.files}</dd></div>
            <div className="flex gap-2"><dt className="nb-meta text-muted-foreground">Folders</dt><dd className="nb-meta text-foreground">{counts.folders}</dd></div>
            {repositorySize ? <div className="flex gap-2"><dt className="nb-meta text-muted-foreground">Size</dt><dd className="nb-meta text-foreground">{repositorySize}</dd></div> : null}
            {repositoryUpdatedAt ? <div className="flex gap-2"><dt className="nb-meta text-muted-foreground">Updated</dt><dd className="nb-meta text-foreground">{repositoryUpdatedAt}</dd></div> : null}
            {authSource ? <div className="flex gap-2"><dt className="nb-meta text-muted-foreground">Access</dt><dd className="nb-meta text-foreground">{authSource}</dd></div> : null}
          </dl>

          {technologies.length > 0 ? (
            <div>
              <div className="nb-meta mb-2 text-muted-foreground">Detected stack</div>
              <SkillList skills={technologies} size="sm" />
            </div>
          ) : null}

          {warnings.length > 0 || counts.ignored > 0 || counts.tooLarge > 0 ? (
            <div className="flex gap-3 border-y border-[var(--status-warning)]/25 bg-[var(--status-warning-soft)] px-4 py-3 text-[var(--status-warning)]" role="status">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="nb-compact">
                {warnings.join(" ") || `${counts.ignored > 0 ? `${counts.ignored} ignored` : ""}${counts.ignored > 0 && counts.tooLarge > 0 ? " · " : ""}${counts.tooLarge > 0 ? `${counts.tooLarge} too large` : ""}`}
              </p>
            </div>
          ) : null}

          {fileTree ? (
            <section aria-labelledby="github-import-files-title">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
                <div>
                  <h4 id="github-import-files-title" className="nb-card-title text-foreground">Files to import</h4>
                  <p className="nb-compact mt-1 text-muted-foreground">Open folders to verify the files that will be imported.</p>
                </div>
                <span className="nb-meta text-muted-foreground">{counts.folders} folders · {counts.files} files</span>
              </div>
              <div className="mt-1" role="tree" aria-label="Repository files to import">{fileTree}</div>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
