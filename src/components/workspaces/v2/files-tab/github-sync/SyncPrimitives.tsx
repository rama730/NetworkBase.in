"use client";

import { useState, type ReactNode, type Ref } from "react";
import { ArrowLeft, ArrowRight, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SyncFile,
  SyncFileUpdate,
  SyncManifest,
} from "@/lib/github/sync-contract";
import {
  changeLabel,
  formatSyncBytes,
  formatSyncDate,
} from "@/lib/github/repository-sync";
import { quietButton } from "./sync-styles";
import styles from "./RepositorySync.module.css";
import { formatRelativeTime } from "../folder/format";

export function SyncHeading({
  title,
  description,
  onBack,
  headingRef,
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const heading = (
    <div className={styles.header}>
      <h2 ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      {description && <p>{description}</p>}
    </div>
  );
  return onBack ? (
    <div className={styles.backHeader}>
      <button
        type="button"
        className={cn(quietButton, styles.back)}
        aria-label="Back"
        title="Back"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" />
      </button>
      {heading}
    </div>
  ) : (
    heading
  );
}
export function FileActor({ person }: { person?: SyncFileUpdate["person"] }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!person) return <span aria-label="Updated by not recorded">—</span>;
  return (
    <span className={styles.actor}>
      {person.avatarUrl && failed !== person.avatarUrl && (
        <img
          src={person.avatarUrl}
          alt=""
          width={18}
          height={18}
          className={styles.avatar}
          onError={() => setFailed(person.avatarUrl)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <span dir="auto">{person.name}</span>
    </span>
  );
}
export function ChangeBadge({
  file,
  resolved,
}: {
  file: SyncFile;
  resolved?: boolean;
}) {
  const tone =
    file.blocked || file.change === "delete"
      ? "bad"
      : file.change === "conflict"
        ? resolved
          ? "good"
          : "warn"
        : file.change === "add"
          ? "good"
          : file.change === "unchanged"
            ? ""
            : "info";
  return (
    <span className={styles.badge} data-tone={tone}>
      {resolved && file.change === "conflict" ? "Resolved" : changeLabel(file)}
    </span>
  );
}
export function SyncBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}
export function TransferRoute({
  manifest,
  projectName,
}: {
  manifest: Pick<
    SyncManifest,
    "repository" | "branch" | "direction" | "newBranch" | "local"
  >;
  projectName: string;
}) {
  // A GitHub branch other than the default syncs with the NetworkBase branch of the same name (report H6, H-5).
  const local = (
    <div className={styles.endpoint}>
      <small>NetworkBase</small>
      <strong dir="auto">{projectName} / {manifest.local ? "Branch" : "Workspace files"}</strong>
      {manifest.local ? (
        <span className={cn(styles.row, styles.small, styles.mono)}>
          <GitBranch aria-hidden="true" />
          {manifest.local.name}
          {manifest.local.branchId ? null : <small> (new, from main)</small>}
        </span>
      ) : null}
    </div>
  );
  const remote = (
    <div className={styles.endpoint}>
      <small>GitHub</small>
      <strong dir="auto">
        {manifest.repository.replace(/^https:\/\/github.com\//, "") ||
          "Choose repository"}
      </strong>
      <span className={cn(styles.row, styles.small, styles.mono)}>
        <GitBranch aria-hidden="true" />
        {manifest.branch || "Choose branch"}
      </span>
      {manifest.newBranch && (
        <small>
          New branch from{" "}
          <span dir="auto" className={styles.mono}>
            {manifest.newBranch.base}
          </span>
        </small>
      )}
    </div>
  );
  return (
    <div
      className={styles.route}
      aria-label={`Transfer from ${manifest.direction === "push" ? "NetworkBase to GitHub" : "GitHub to NetworkBase"}`}
    >
      {manifest.direction === "push" ? local : remote}
      <ArrowRight aria-hidden="true" />
      {manifest.direction === "push" ? remote : local}
    </div>
  );
}
export function FileMetadata({
  file,
  update,
}: {
  file: SyncFile;
  update?: SyncFileUpdate;
}) {
  return (
    <dl className={styles.metadata}>
      <div>
        <dt>Last updated</dt>
        <dd title={formatSyncDate(update?.at)}>
          {formatRelativeTime(update?.at)}
        </dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd>{formatSyncBytes(file.size)}</dd>
      </div>
      <div>
        <dt>Updated by</dt>
        <dd>
          <FileActor person={update?.person} />
        </dd>
      </div>
    </dl>
  );
}
