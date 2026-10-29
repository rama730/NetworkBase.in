import { GITHUB_SYNC_LIMITS } from "./sync-limits";
import {
  isValidGithubBranchName,
  normalizeGithubRepoUrl,
} from "./repo-validation";
import type {
  SyncFile,
  SyncManifest,
  SyncRunView,
  SyncResolution,
} from "./sync-contract";

export type SyncChoice = { resolution?: SyncResolution; content?: string };
export type SyncChoices = Record<string, SyncChoice>;
export type SyncSetup = {
  repository: string;
  branch: string;
  direction: "push" | "pull";
  mode: "direct" | "pr";
  newRepository?: NonNullable<SyncManifest["newRepository"]>;
  newBranch?: { base: string; previousMode?: "pr" | "direct" };
};
export function syncChoice(
  choices: SyncChoices,
  path: string,
): SyncChoice | undefined {
  return Object.prototype.hasOwnProperty.call(choices, path)
    ? choices[path]
    : undefined;
}
export function selectEligibleChanges(
  files: SyncFile[],
  previous: SyncChoices,
): SyncChoices {
  const next = { ...previous };
  let count = Object.keys(next).length;
  for (const file of files) {
    if (!eligibleSyncFile(file) || syncChoice(next, file.path)) continue;
    if (count >= GITHUB_SYNC_LIMITS.operationFiles) break;
    Object.defineProperty(next, file.path, {
      value: {},
      enumerable: true,
      writable: true,
      configurable: true,
    });
    count++;
  }
  return next;
}
export function setupProblem(value: SyncSetup) {
  if (!value.branch.trim() || !isValidGithubBranchName(value.branch))
    return "Choose a valid branch.";
  if (value.newRepository) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.newRepository.owner))
      return "Enter a GitHub owner.";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.newRepository.name))
      return "Enter a valid repository name.";
    if (value.direction !== "push")
      return "The first publication must be a push.";
  } else if (!normalizeGithubRepoUrl(value.repository))
    return "Enter an accessible GitHub repository URL.";
  if (
    value.newBranch &&
    (value.direction !== "push" ||
      value.newRepository ||
      !value.newBranch.base.trim() ||
      !isValidGithubBranchName(value.newBranch.base) ||
      value.newBranch.base === value.branch)
  )
    return "Choose an existing starting branch and a different new branch name.";
  return "";
}
export function eligibleSyncFile(file: SyncFile) {
  return (
    !file.blocked && file.change !== "unchanged" && file.change !== "conflict"
  );
}
export function selectionProblem(
  manifest: SyncManifest | null,
  choices: SyncChoices,
  message: string,
) {
  const paths = Object.keys(choices);
  if (!manifest || !paths.length) return "Select at least one eligible change.";
  if (paths.length > GITHUB_SYNC_LIMITS.operationFiles)
    return `Select no more than ${GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} files.`;
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  let size = 0;
  for (const path of paths) {
    const file = files.get(path);
    if (!file || file.blocked || file.change === "unchanged")
      return "Remove excluded or unavailable files from the selection.";
    const choice = choices[path];
    if (file.change === "conflict" && !choice?.resolution)
      return "Resolve selected conflicts before continuing.";
    if (
      choice?.resolution === (manifest.direction === "push" ? "github" : "edge")
    )
      return "Keeping the destination makes no change. Unselect that file.";
    if (
      choice?.resolution === "merge" &&
      (choice.content === undefined || choice.content.includes("\0"))
    )
      return "Provide valid combined text.";
    size += file.size;
  }
  if (size > GITHUB_SYNC_LIMITS.operationBytes)
    return "The selection exceeds the 512 MB transfer limit.";
  if (!message.trim() || message.length > 2000)
    return "Enter a message of 1–2,000 characters.";
  return "";
}
export function isActiveRun(run?: SyncRunView | null) {
  return run?.status === "queued" || run?.status === "running";
}
export function needsRunAttention(run: SyncRunView) {
  return ["review", "queued", "running", "failed", "needs_review"].includes(
    run.status,
  );
}
export function canRetryRun(run: SyncRunView, now = Date.now()) {
  return (
    run.status === "failed" &&
    (Boolean(
      run.result.pushed ||
      run.result.commitSha ||
      run.result.repositoryCreated ||
      run.result.applied?.length,
    ) ||
      now - Date.parse(run.createdAt) < 55 * 60_000)
  );
}
export function runProgress(run: SyncRunView) {
  const labels =
    run.direction === "push"
      ? ["Queued", "Validate and prepare", "Publish to GitHub", "Verify and record"]
      : [
          "Queued",
          "Validate selection",
          "Apply to project files",
          "Verify and record",
        ];
  const stage = run.stage.toLowerCase();
  const index =
    run.status === "completed"
      ? 3
      : run.status === "queued"
        ? 0
        : /recording|remote commit verified|opening pull request/.test(stage)
          ? 3
          : /applying|pushing|publishing commit/.test(stage)
            ? 2
            : 1;
  return {
    labels,
    index,
    applied: Math.min(
      run.result.applied?.length || 0,
      run.manifest.files.length,
    ),
    total: run.manifest.files.length,
  };
}
export function changeLabel(file: SyncFile) {
  return file.blocked
    ? "Excluded"
    : (
        {
          add: "Added",
          modify: "Modified",
          rename: "Renamed",
          delete: "Deleted",
          conflict: "Needs resolution",
          unchanged: "Unchanged",
        } as const
      )[file.change];
}
export function formatSyncBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function formatSyncDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function authFailureText(code: string | null) {
  return (
    (
      {
        identity_already_exists:
          "This GitHub identity is already linked to an account. Try Connect GitHub again to renew an existing link. If it belongs to another NetworkBase account, use that account or choose a different GitHub account in Settings → Integrations.",
        account_mismatch:
          "A different GitHub account returned. Sign in with the GitHub account linked to this workspace.",
        token_missing:
          "GitHub did not return repository access. Renew access using your linked account.",
        access_denied:
          "GitHub access was not granted. Your setup and files are unchanged.",
        expired: "The sign-in attempt expired. Start a fresh attempt.",
        invalid:
          "The GitHub return could not be verified. No transfer was submitted.",
        cancelled: "GitHub sign-in was canceled. Your setup is retained.",
      } as Record<string, string>
    )[code || ""] ||
    "GitHub sign-in could not finish. Your setup is retained; try again."
  );
}
export type SyncDraft = {
  version: 1;
  viewerId: string;
  projectId: string;
  savedAt: number;
  runId?: string;
  setup: SyncSetup;
  message: string;
  selected: Array<{
    path: string;
    localHash: string | null;
    remoteSha: string | null;
    choice: SyncChoice;
  }>;
};
export function readSyncDraft(
  raw: string | null,
  projectId: string,
  viewerId: string,
  now = Date.now(),
): SyncDraft | null {
  try {
    const draft = JSON.parse(raw || "") as SyncDraft;
    if (
      draft.version !== 1 ||
      draft.viewerId !== viewerId ||
      draft.projectId !== projectId ||
      !Number.isFinite(draft.savedAt) ||
      draft.savedAt > now + 60_000 ||
      now - draft.savedAt > 30 * 60_000 ||
      !draft.setup ||
      typeof draft.setup.repository !== "string" ||
      typeof draft.setup.branch !== "string" ||
      !["push", "pull"].includes(draft.setup.direction) ||
      !["pr", "direct"].includes(draft.setup.mode) ||
      typeof draft.message !== "string" ||
      !Array.isArray(draft.selected) ||
      draft.selected.length > GITHUB_SYNC_LIMITS.operationFiles
    )
      return null;
    if (
      draft.selected.some(
        (item) =>
          typeof item.path !== "string" ||
          !item.choice ||
          ![undefined, "edge", "github", "merge"].includes(
            item.choice.resolution,
          ) ||
          (item.choice.content !== undefined &&
            typeof item.choice.content !== "string"),
      )
    )
      return null;
    const repository = draft.setup.newRepository;
    if (
      repository &&
      (typeof repository.owner !== "string" ||
        typeof repository.name !== "string" ||
        typeof repository.private !== "boolean" ||
        typeof repository.organization !== "boolean")
    )
      return null;
    if (draft.setup.newBranch && typeof draft.setup.newBranch.base !== "string")
      return null;
    return draft;
  } catch {
    return null;
  }
}
export function restoreSyncChoices(manifest: SyncManifest, draft: SyncDraft) {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const choices: SyncChoices = {};
  let changed = 0;
  for (const selected of draft.selected) {
    const file = files.get(selected.path);
    if (
      !file ||
      file.blocked ||
      file.change === "unchanged" ||
      file.localHash !== selected.localHash ||
      file.remoteSha !== selected.remoteSha
    ) {
      changed++;
      continue;
    }
    Object.defineProperty(choices, selected.path, {
      value: selected.choice,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { choices, changed };
}
