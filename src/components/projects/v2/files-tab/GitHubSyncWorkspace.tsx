"use client";

import dynamic from 'next/dynamic';
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Github,
  ArrowUpToLine,
  ArrowDownToLine,
  ExternalLink,
  Loader2,
  AlertTriangle,
  MoreHorizontal,
  Search,
  ShieldCheck,
  CheckCircle2,
  GitBranch,
  GitPullRequest,
  Check,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  FileText,
  RefreshCw,
  X,
  Pencil,
} from "lucide-react";
import * as sync from "@/app/actions/github-sync";
import {
  fetchGithubImportBranches,
  fetchGithubImportRepositories,
} from "@/lib/github/import-client";
import type { GithubImportAccessState } from "@/lib/github/import-types";
import { startGithubRepositoryAuthorization } from "@/lib/github/oauth-client";
import { publicAvatarVariantUrl } from "@/lib/profile/avatar-variants";
import {
  GITHUB_SYNC_LIMITS,
  formatSyncMegabytes,
} from "@/lib/github/sync-limits";
import { isGithubWorkflowPermissionError } from "@/lib/github/sync-contract";
import type {
  SyncManifest,
  SyncRunView,
  SyncResolution,
} from "@/lib/github/sync-contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { ContributorIdentitySection } from '@/components/projects/v2/files-tab/github-sync/ContributorIdentitySection';
import { button } from '@/components/projects/v2/files-tab/github-sync/sync-styles';
import { scanForSecrets } from '@/components/projects/v2/files-tab/github-sync/secret-scan';

const SplitDiffViewer = dynamic(() => import('@/components/projects/v2/files-tab/github-sync/SplitDiffViewer').then((mod) => mod.SplitDiffViewer));

// Primary actions intentionally do not extend `button`: Tailwind resolves overlapping
// arbitrary background/text utilities by generated CSS order, which can make a
// primary control inherit the neutral surface and look absent.
const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-[background-color,border-color,color,box-shadow] duration-150 ease-in-out hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:border-[var(--primary-active)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-50 outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0";
const input =
  "min-h-10 w-full min-w-0 rounded-[5px] border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";
type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;
type State = Success<Awaited<ReturnType<typeof sync.getGitHubSyncState>>>;
type Choice = { resolution?: SyncResolution; content?: string };
type CompareInput = Parameters<typeof sync.compareGitHubSync>[1];

export function GitHubSyncWorkspace({
  projectId,
  canManage,
  access,
  projectName,
  projectSlug,
}: {
  projectId: string;
  canManage: boolean;
  access: GithubImportAccessState | null;
  projectName?: string;
  projectSlug?: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [newRepo, setNewRepo] = useState(true);
  const [setupMode, setSetupMode] = useState<"create" | "existing">("create");
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [organization, setOrganization] = useState(false);
  const [direction, setDirection] = useState<"push" | "pull">("push");
  const [mode, setMode] = useState<"pr" | "direct">("direct");
  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [message, setMessage] = useState("Update project files from NetworkBase");
  const [review, setReview] = useState<SyncRunView | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [repos, setRepos] = useState<
    Array<{ fullName: string; htmlUrl: string; defaultBranch: string | null }>
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [customBranchMode, setCustomBranchMode] = useState(false);
  const [diff, setDiff] = useState<{
    path: string;
    edge: string;
    github: string;
    base: string;
    binary: boolean;
  } | null>(null);
  const [merged, setMerged] = useState("");
  const [activeInspectPath, setActiveInspectPath] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [executingRun, setExecutingRun] = useState<{
    id: string;
    branch: string;
    direction: "push" | "pull";
    mode: "direct" | "pr";
    fileCount: number;
    message: string;
    stage: string;
  } | null>(null);
  const [syncSuccessToast, setSyncSuccessToast] = useState<{
    sha?: string;
    branch: string;
    direction: "push" | "pull";
    fileCount: number;
  } | null>(null);
  const [changeRepoDialogOpen, setChangeRepoDialogOpen] = useState(false);
  const [changeRepoUrl, setChangeRepoUrl] = useState("");
  const [changeRepoBranch, setChangeRepoBranch] = useState("main");
  const [customBranchInput, setCustomBranchInput] = useState("");
  const [showCustomBranch, setShowCustomBranch] = useState(false);
  const appliedOperations = useRef(new Set<string>());
  const lastLoadedRepoRef = useRef<string>("");
  const latestInspectPathRef = useRef<string | null>(null);
  const config = useMemo<CompareInput>(
    () => ({
      direction,
      branch,
      mode,
      ...(newRepo
        ? { newRepository: { owner, name, private: isPrivate, organization } }
        : {}),
    }),
    [direction, branch, mode, newRepo, owner, name, isPrivate, organization],
  );
  const isChangeRepoUrlValid = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(
    changeRepoUrl.trim(),
  );
  const canSaveTargetRepository = isChangeRepoUrlValid && Boolean(changeRepoBranch.trim());

  const inspectFile = async (filePath: string) => {
    latestInspectPathRef.current = filePath;
    setActiveInspectPath(filePath);
    setLoadingDiff(true);
    try {
      const file = manifest?.files.find((f) => f.path === filePath);
      let result;
      if (file && manifest?.repository) {
        // ponytail: fast-path direct blob fetch by pre-computed SHA (115ms vs 2,300ms). ceiling: single file blobs <= 1MB. upgrade: stream directly from Git Data API if blob exceeds 10MB.
        result = await sync.getSingleFileDiff(projectId, {
          repository: manifest.repository,
          path: filePath,
          storageKey: file.storageKey,
          remoteSha: file.remoteSha,
          baseSha: file.baseSha,
          size: file.size,
        });
      } else {
        result = await sync.getGitHubSyncDiff(projectId, config, filePath);
      }
      if (latestInspectPathRef.current !== filePath) return;
      if (result.success) {
        setDiff({ path: filePath, ...result.data });
        setMerged(choices[filePath]?.content || result.data.edge);
      }
    } catch {
      // Ignore transient diff loading error
    } finally {
      if (latestInspectPathRef.current === filePath) {
        setLoadingDiff(false);
      }
    }
  };

  const selectedContributors = useMemo(() => {
    if (!manifest) return [];
    const map = new Map<
      string,
      {
        name: string;
        email?: string | null;
        avatarUrl?: string | null;
        login?: string | null;
      }
    >();
    for (const file of manifest.files) {
      if (choices[file.path]) {
        for (const author of file.contributors) {
          const key = author.userId || author.githubId || author.name;
          if (key && !map.has(String(key))) {
            map.set(String(key), {
              name: author.name,
              email: author.email,
              avatarUrl: author.avatarUrl,
              login: author.githubLogin,
            });
          }
        }
      }
    }
    return [...map.values()];
  }, [manifest, choices]);

  const [filterSearch, setFilterSearch] = useState("");
  const [showCleanFiles, setShowCleanFiles] = useState(false);
  const [filterCategory, setFilterCategory] = useState<
    "all" | "staged" | "add" | "modify" | "conflict" | "delete"
  >("all");

  const filterCounts = useMemo(() => {
    if (!manifest)
      return { all: 0, actionable: 0, staged: 0, add: 0, modify: 0, conflict: 0, delete: 0, unchanged: 0 };
    let staged = 0,
      add = 0,
      modify = 0,
      conflict = 0,
      del = 0,
      unchanged = 0;
    for (const f of manifest.files) {
      if (choices[f.path]) staged++;
      if (f.change === "add") add++;
      else if (f.change === "modify") modify++;
      else if (f.change === "conflict") conflict++;
      else if (f.change === "delete") del++;
      else if (f.change === "unchanged") unchanged++;
    }
    const actionable = add + modify + conflict + del;
    return {
      all: manifest.files.length,
      actionable,
      staged,
      add,
      modify,
      conflict,
      delete: del,
      unchanged,
    };
  }, [manifest, choices]);

  const { actionableVisibleFiles, cleanVisibleFiles } = useMemo(() => {
    if (!manifest) return { actionableVisibleFiles: [], cleanVisibleFiles: [] };
    const query = filterSearch.trim().toLowerCase();
    const files = manifest.files.filter((f) => {
      if (filterCategory === "staged" && !choices[f.path]) return false;
      if (filterCategory === "add" && f.change !== "add") return false;
      if (filterCategory === "modify" && f.change !== "modify") return false;
      if (filterCategory === "conflict" && f.change !== "conflict") return false;
      if (filterCategory === "delete" && f.change !== "delete") return false;

      if (query && !f.path.toLowerCase().includes(query)) return false;
      return true;
    });

    const actionable = files.filter((f) => f.change !== "unchanged");
    const clean = files.filter((f) => f.change === "unchanged");
    return { actionableVisibleFiles: actionable, cleanVisibleFiles: clean };
  }, [manifest, choices, filterCategory, filterSearch]);

  const detectedSecurityRisk = useMemo(() => {
    if (!manifest) return null;
    for (const f of manifest.files) {
      if (choices[f.path]) {
        const fileContent =
          choices[f.path]?.content ||
          (diff?.path === f.path ? diff.edge : null);
        const scan = scanForSecrets(f.path, fileContent);
        if (scan.blocked) {
          return { path: f.path, reason: scan.reason };
        }
      }
    }
    return null;
  }, [manifest, choices, diff]);
  const active =
    state?.runs.some(
      (run) => run.status === "queued" || run.status === "running",
    ) ?? false;
  const seededConnectionRef = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!canManage) return;
    const result = await sync.getGitHubSyncState(projectId);
    if (!result.success) throw new Error(result.error);
    setState(result.data);
    setReview(
      result.data.runs.find(
        (run) => run.status === "review" || run.status === "failed",
      ) || null,
    );
    // The form is seeded once per connection. The 30 s poll must not overwrite choices the
    // user is still making (owner, name, repository, branch).
    const connectionKey = result.data.connection
      ? `${result.data.connection.repository}#${result.data.connection.branch}`
      : "none";
    if (seededConnectionRef.current !== connectionKey) {
      seededConnectionRef.current = connectionKey;
      setOwner(result.data.account.username || "");
      setName(
        (projectName || "networkbase-project")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "networkbase-project",
      );
      if (result.data.connection) {
        setNewRepo(false);
        setSetupMode("existing");
        setRepository(result.data.connection.repository);
        setBranch(result.data.connection.branch);
      } else {
        setNewRepo(true);
        setSetupMode("create");
      }
    }
    for (const run of result.data.runs) {
      if (
        run.direction === "pull" &&
        run.result.applied?.length &&
        !appliedOperations.current.has(`${run.id}:${run.result.applied.length}`)
      ) {
        appliedOperations.current.add(`${run.id}:${run.result.applied.length}`);
        window.dispatchEvent(
          new CustomEvent("project:task-files-changed", {
            detail: { projectId },
          }),
        );
      }
    }
    return result.data;
  }, [projectId, canManage, projectName]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const authorizationError = url.searchParams.get("githubAuth");
    if (!authorizationError) return;
    setError(
      authorizationError === "account_mismatch"
        ? `GitHub authorized a different account. Choose ${access?.username || "the GitHub account linked to this workspace"} and try again.`
        : "GitHub did not return repository permission. Choose the linked GitHub account and try again.",
    );
    url.searchParams.delete("githubAuth");
    window.history.replaceState(window.history.state, "", url);
  }, [access?.username]);
  useEffect(() => {
    let cancelled = false;
    if (canManage) {
      void load().catch((error) => {
        if (!cancelled) setError(error.message);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [canManage, load]);

  const setGitSyncBadge = useFilesWorkspaceStore((s) => s.setGitSyncBadge);
  const [syncTasks, setSyncTasks] = useState<
    Array<{ id: string; title: string; key: string }>
  >([]);

  useEffect(() => {
    if (!state) return;
    const isRunning = state.runs.some(
      (run) => run.status === "queued" || run.status === "running",
    );
    const latest = state.runs[0] ?? null;
    if (isRunning) {
      setGitSyncBadge(projectId, {
        status: "syncing",
        tooltip: "GitHub synchronization in progress",
      });
    } else if (latest?.status === "failed") {
      setGitSyncBadge(projectId, {
        status: "failed",
        tooltip: latest.error || "GitHub sync failed",
      });
    } else if (state.connection?.incomingSha) {
      setGitSyncBadge(projectId, {
        status: "incoming",
        count: 1,
        tooltip: "New changes available on GitHub",
      });
    } else if (latest?.status === "completed") {
      setGitSyncBadge(projectId, {
        status: "completed",
        tooltip: "GitHub sync up-to-date",
      });
    } else {
      setGitSyncBadge(projectId, null);
    }
  }, [state, projectId, setGitSyncBadge]);

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    void sync
      .getProjectSyncTasks(projectId)
      .then((res) => {
        if (!cancelled && res.success) {
          setSyncTasks(res.data);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [manifest, projectId]);

  const handleApproveIdentity = useCallback(
    async (email: string) => {
      const res = await sync.approveGitHubCommitIdentity(email);
      if (!res.success) throw new Error(res.error);
      if (canManage) await load();
    },
    [canManage, load],
  );

  useEffect(() => {
    if (!syncSuccessToast) return;
    const timer = setTimeout(() => {
      setSyncSuccessToast(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [syncSuccessToast]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!active || !canManage) return;

    return createVisibilityAwareInterval(() => {
      void loadRef.current().catch((error) => setError((error as Error).message));
    }, 30_000);
  }, [active, canManage, projectId]);

  // ponytail: auto-load remote branches on repository selection change. ceiling: 100 branches dropdown. upgrade: virtualized searchable branch combo-box if repositories exceed 100 active branches.
  useEffect(() => {
    const targetRepo = repository || state?.connection?.repository;
    if (
      targetRepo &&
      targetRepo.startsWith("https://github.com/") &&
      !newRepo
    ) {
      void loadBranches(targetRepo);
    }
  }, [setupMode, repository, state?.connection?.repository, newRepo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === "P" || e.key === "p") {
          e.preventDefault();
          if (!busy && !active && state?.connection && !manifest && !review) {
            void compare("push", "direct");
          }
        } else if (e.key === "L" || e.key === "l") {
          e.preventDefault();
          if (!busy && !active && state?.connection && !manifest && !review) {
            void compare("pull", "direct");
          }
        } else if (e.key === "R" || e.key === "r") {
          e.preventDefault();
          if (!busy && !active && state?.connection && !manifest && !review) {
            void compare("push", "pr");
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, active, state?.connection, manifest, review]);

  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function compare(
    nextDirection: "push" | "pull" = direction,
    nextMode: "direct" | "pr" = mode,
  ) {
    setIsComparing(true);
    try {
      await perform(async () => {
        const comparisonConfig: CompareInput = {
          direction: nextDirection,
          branch,
          mode: nextMode,
          ...(!state?.connection && newRepo
            ? { newRepository: { owner, name, private: isPrivate, organization } }
            : {}),
        };
        const result = await sync.compareGitHubSync(projectId, comparisonConfig);
        if (!result.success) throw new Error(result.error);
        setDirection(nextDirection);
        setMode(nextMode);
        setManifest(result.data);
        setReview(null);
        setChoices({});
        // ponytail: refresh runs and state in background without blocking instant comparison review UI. ceiling: client-side background fetch. upgrade: optimistic run state insertion if latency >500ms.
        void load().catch((err) => console.error("Background sync state refresh failed", err));
      });
    } finally {
      setIsComparing(false);
    }
  }
  async function prepare() {
    await perform(async () => {
      const selected = manifest!.files
        .filter((file) => choices[file.path])
        .map((file) => ({
          path: file.path,
          ...choices[file.path],
          expectedLocalHash: file.localHash,
          expectedRemoteSha: file.remoteSha,
        }));
      const result = await sync.prepareGitHubSync(
        projectId,
        config,
        selected,
        message,
      );
      if (!result.success) throw new Error(result.error);
      setReview(result.data);
    });
  }
  async function execute(run: SyncRunView) {
    setExecutingRun({
      id: run.id,
      branch: run.manifest.branch,
      direction: run.direction,
      mode: run.manifest.mode,
      fileCount: run.manifest.files.length,
      message: run.manifest.message,
      stage: "Packaging Git snapshot & verifying signatures...",
    });
    setReview(null);
    setManifest(null);

    await perform(async () => {
      try {
        const result = await sync.executeGitHubSync(projectId, run.id);
        if (!result.success) throw new Error(result.error);
        setSyncSuccessToast({
          sha: result.data.result?.commitSha?.slice(0, 7),
          branch: run.manifest.branch,
          direction: run.direction,
          fileCount: run.manifest.files.length,
        });
        await load();
      } finally {
        setExecutingRun(null);
      }
    });
  }
  async function repositories(more = false) {
    await perform(async () => {
      const result = await fetchGithubImportRepositories({
        perPage: 50,
        ...(more && cursor ? { cursor } : {}),
      });
      setRepos((previous) =>
        more ? [...previous, ...result.items] : result.items,
      );
      setCursor(result.cursor);
    });
  }
  async function loadBranches(repoUrl: string, force = false) {
    if (!repoUrl || !repoUrl.startsWith("https://github.com/")) return;
    if (!force && lastLoadedRepoRef.current === repoUrl && branches.length > 0) return;
    lastLoadedRepoRef.current = repoUrl;
    setLoadingBranches(true);
    try {
      const result = await fetchGithubImportBranches({ repoUrl });
      if (result && Array.isArray(result.branches)) {
        setBranches(result.branches);
        if (result.branches.length > 0 && (!branch || !result.branches.includes(branch))) {
          if (!branch) {
            setBranch(result.branches[0] || "main");
          }
        }
      }
    } catch {
      // Non-blocking: user can still type or enter custom branch manually
    } finally {
      setLoadingBranches(false);
    }
  }

  async function handleSwitchBranch(newBranch: string) {
    if (!state?.connection || !newBranch.trim() || newBranch === state.connection.branch) return;
    await perform(async () => {
      const update = await sync.connectGitHubSyncRepository(
        projectId,
        state.connection!.repository,
        newBranch.trim(),
      );
      if (!update.success) throw new Error(update.error);
      setBranch(newBranch.trim());
      await load();
      toast.success(`Target branch switched to ${newBranch.trim()}`);
    });
  }

  async function handleSaveRepoUrl() {
    if (!state?.connection || !changeRepoUrl.trim() || !changeRepoBranch.trim()) return;
    await perform(async () => {
      const targetRepo = changeRepoUrl.trim();
      const update = await sync.connectGitHubSyncRepository(
        projectId,
        targetRepo,
        changeRepoBranch.trim(),
      );
      if (!update.success) throw new Error(update.error);
      setRepository(targetRepo);
      setBranch(changeRepoBranch.trim());
      setChangeRepoDialogOpen(false);
      await load();
      await loadBranches(targetRepo);
      toast.success("Repository destination updated");
    });
  }

  const openChangeRepoDialog = () => {
    setChangeRepoUrl(state?.connection?.repository || "");
    setChangeRepoBranch(state?.connection?.branch || "main");
    setChangeRepoDialogOpen(true);
  };
  async function reviewSetup() {
    setIsComparing(true);
    try {
      await perform(async () => {
        if (!newRepo) {
          const connected = await sync.connectGitHubSyncRepository(
            projectId,
            repository,
            branch,
          );
          if (!connected.success) throw new Error(connected.error);
        }
        const comparisonConfig: CompareInput = {
          direction: newRepo ? "push" : direction,
          branch,
          mode,
          ...(newRepo
            ? { newRepository: { owner, name, private: isPrivate, organization } }
            : {}),
        };
        const compared = await sync.compareGitHubSync(
          projectId,
          comparisonConfig,
        );
        if (!compared.success) throw new Error(compared.error);
        setDirection(comparisonConfig.direction);
        setManifest(compared.data);
        setReview(null);
        setChoices({});
        await load();
      });
    } finally {
      setIsComparing(false);
    }
  }
  const selectedCount = Object.keys(choices).length;
  const unresolved = manifest?.files.some(
    (file) =>
      choices[file.path] &&
      file.change === "conflict" &&
      !choices[file.path]?.resolution,
  );
  const latestRun = state?.runs[0] ?? null;
  const activeRun = state?.runs.find(
    (run) => run.status === "queued" || run.status === "running",
  );
  const workflowPermissionRequired = isGithubWorkflowPermissionError(
    error || review?.error,
  );
  const authorizeWorkflow = () =>
    perform(() =>
      startGithubRepositoryAuthorization({
        login: access?.username || state?.account.username,
      }),
    );
  return (
    <section
      aria-label="GitHub synchronization workspace"
      className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-page)] p-4 text-[var(--text-strong)] md:p-5"
    >
      <div className="mx-auto max-w-[1200px] space-y-6">
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-md border border-red-500/40 p-3 text-sm"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            {workflowPermissionRequired && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void authorizeWorkflow()}
              >
                Authorize workflow publishing
              </button>
            )}
          </div>
        )}
        {!canManage ? (
          <div className="space-y-4 rounded-[8px] border border-[#DBD5C8] bg-white p-6 shadow-xs dark:border-border dark:bg-card">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-[6px] bg-[#141A1E] text-white shadow-2xs dark:bg-white dark:text-[#141A1E]">
                <Github className="size-5" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-[#141A1E] dark:text-foreground">GitHub Synchronization</h3>
                <p className="text-xs text-[#6B7880] dark:text-muted-foreground">
                  Project files and task attachments are synchronized with GitHub.
                </p>
              </div>
            </div>
            <p className="rounded-[6px] border border-[#DBD5C8] bg-[#F3F0EA] p-3 text-xs text-[#374349] dark:border-border dark:bg-white/5 dark:text-muted-foreground">
              Only the project owner can configure repository connections or execute push/pull synchronization. You can configure your commit attribution below.
            </p>
            <ContributorIdentitySection
              identity={null}
              onApproved={handleApproveIdentity}
            />
          </div>
        ) : !state ? (
          error ? (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const current = await load();
                  if (current) {
                    setRepository(current.connection?.repository || "");
                    setBranch(current.connection?.branch || "main");
                  }
                })
              }
            >
              Retry connection
            </button>
          ) : (
            <div className="rounded-[8px] border border-[#DBD5C8] bg-white p-8 dark:border-border dark:bg-card flex flex-col items-center justify-center gap-3 min-h-64 animate-none shadow-xs">
              <div className="size-10 rounded-[6px] bg-[#F3F0EA] dark:bg-white/5 border border-[#DBD5C8] dark:border-border flex items-center justify-center">
                <Github className="size-5 text-[#6B7880] dark:text-muted-foreground" />
              </div>
              <div className="h-4 w-44 rounded-[4px] bg-[#F3F0EA] dark:bg-white/10" />
              <div className="h-3 w-64 rounded-[4px] bg-[#F3F0EA] dark:bg-white/5" />
            </div>
          )
        ) : !state.canAuthenticate ? (
          <div className="border-y border-[var(--border-subtle)] py-8">
            <div className="max-w-[64ch] space-y-4">
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                <Github className="size-4" aria-hidden="true" />
                <span className="font-mono text-xs uppercase tracking-[0.09em]">GitHub Sync</span>
              </div>
              <div className="space-y-1.5">
                <h2 className="text-xl font-semibold tracking-[-0.015em] text-[var(--text-strong)]">
                  {!state.account.linked ? "Connect GitHub" : "Restore GitHub access"}
                </h2>
                <p className="text-sm leading-relaxed text-[var(--text-body)]">
                  Connect an account to choose or create a repository for this project. Nothing is published until you review and confirm changes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy}
                  onClick={() => void perform(() => startGithubRepositoryAuthorization({ login: access?.username || state.account.username }))}
                >
                  <Github className="size-4" />
                  {state.account.linked ? "Restore access" : "Connect GitHub"}
                </button>
                <details className="text-xs text-[var(--text-muted)]">
                  <summary className="cursor-pointer font-medium text-[var(--text-body)] hover:text-[var(--text-strong)]">Permissions and data access</summary>
                  <p className="mt-2 max-w-[56ch] leading-relaxed">NetworkBase requests repository and profile access only to perform the sync actions you approve. You can change or revoke access from GitHub at any time.</p>
                </details>
              </div>
            </div>
          </div>
        ) : (activeRun || executingRun) ? (
          <div role="status" className="border-y border-[var(--status-info-border)] bg-[var(--status-info-soft)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Loader2 className="size-4 shrink-0 animate-spin text-[var(--status-info)]" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-strong)]">
                    {!executingRun && activeRun?.status === "queued" ? "Synchronization queued" : executingRun?.direction === "pull" || activeRun?.direction === "pull" ? "Importing from GitHub" : "Publishing to GitHub"}
                  </p>
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    {executingRun?.stage || activeRun?.stage || "Preparing the reviewed changes"} · {executingRun?.branch || activeRun?.manifest.branch || state.connection?.branch || "main"}
                  </p>
                </div>
              </div>
              {!executingRun && activeRun?.status === "queued" && (
                <button type="button" className={button} disabled={busy} onClick={() => void execute(activeRun)}>Resume sync</button>
              )}
            </div>
          </div>
        ) : (
          <>
            {!manifest &&
              !review &&
              !executingRun &&
              state.connection && (
                <div className="space-y-4">
                  {syncSuccessToast && (
                    <div className="flex items-center justify-between gap-3 rounded-[6px] border border-[#CDE5D4] bg-[#EDF5F0] p-4 text-xs dark:bg-emerald-950/20 dark:border-emerald-800/30 shadow-xs animate-in fade-in slide-in-from-top-2 duration-[260ms]">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-[5px] bg-[#1E7E34] text-white shadow-2xs">
                          <CheckCircle2 className="size-4" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-xs text-[#141A1E] dark:text-foreground">
                            {syncSuccessToast.direction === "push" ? "Push synchronization completed" : "Pull synchronization completed"}
                          </h4>
                          <p className="text-[11px] text-[#4C5A61] dark:text-muted-foreground mt-0.5">
                            Successfully {syncSuccessToast.direction === "push" ? "pushed" : "merged"} {syncSuccessToast.fileCount} files with branch <strong className="font-mono text-[#141A1E] dark:text-foreground">{syncSuccessToast.branch}</strong>
                            {syncSuccessToast.sha && <> · Commit <span className="font-mono font-semibold text-[#1E7E34] dark:text-emerald-400">{syncSuccessToast.sha}</span></>}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSyncSuccessToast(null)}
                        className="rounded-[4px] p-1.5 text-[#6B7880] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label="Dismiss message"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  )}

                  <div className="border-y border-[var(--border-subtle)]">
                    <div className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div className="flex items-center gap-3.5">
                        <Github className="size-5 shrink-0 text-[var(--text-strong)]" aria-hidden="true" />
                        <div>
                          <div className="flex items-center gap-2">
                            <a
                              className="font-semibold text-base text-[#141A1E] hover:text-[#D14E24] dark:text-foreground dark:hover:text-[#D14E24] inline-flex items-center gap-1.5 transition-colors"
                              href={state.connection.repository}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {state.connection.repository.replace(/^https:\/\/github\.com\//, "")}
                              <ExternalLink className="size-3.5 text-[#6B7880]" aria-hidden="true" />
                            </a>
                            <button
                              type="button"
                              onClick={openChangeRepoDialog}
                              title="Change target repository"
                              className="inline-flex min-h-7 items-center gap-1 rounded-[4px] px-1.5 text-xs font-medium text-[var(--status-info)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-strong)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                            >
                              <Pencil className="size-3" />
                              Change target
                            </button>
                            <span className="rounded-[3px] border border-[var(--status-success-border)] bg-[var(--status-success-soft)] px-2 py-0.5 font-mono text-[10px] max-md:text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--status-success)]">
                              <span className="size-1.5 rounded-[1px] bg-[#1E7E34]" />
                              Connected
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-1 text-xs text-[#6B7880] dark:text-muted-foreground">
                            {/* Inline Target Branch Switcher Dropdown */}
                            <details className="relative group/branch">
                              <summary
                                className="inline-flex items-center gap-1 font-mono font-medium text-[#2563C9] hover:text-[#1B4BA8] dark:text-blue-400 cursor-pointer list-none select-none transition-colors"
                                title="Click to switch target branch"
                              >
                                <GitBranch className="size-3 text-[#2563C9]" />
                                <span>{state.connection.branch}</span>
                                <ChevronDown className="size-3 opacity-70 group-open/branch:rotate-180 transition-transform" />
                              </summary>
                              {/* Click-outside backdrop */}
                              <div
                                className="fixed inset-0 z-40 hidden group-open/branch:block cursor-default"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                }}
                              />
                              <div className="absolute left-0 z-50 mt-1.5 w-64 rounded-[6px] border border-[#DBD5C8] bg-white p-2 shadow-xl dark:border-border dark:bg-card space-y-1.5 text-left">
                                <div className="flex items-center justify-between px-2 py-1 text-[10px] max-md:text-[11px] font-mono font-semibold uppercase tracking-[0.09em] text-[#6B7880] border-b border-[#E8E3D9] dark:border-border">
                                  <span>Target Branch</span>
                                  {loadingBranches ? (
                                    <Loader2 className="size-3 animate-spin text-[#6B7880]" />
                                  ) : (
                                    <span>{branches.length} available</span>
                                  )}
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-0.5">
                                  {branches.map((b) => (
                                    <button
                                      key={b}
                                      type="button"
                                      onClick={async (e) => {
                                        e.currentTarget.closest("details")?.removeAttribute("open");
                                        await handleSwitchBranch(b);
                                      }}
                                      className={`flex w-full items-center justify-between rounded-[4px] px-2.5 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                                        b === state.connection?.branch
                                          ? "bg-[#EEF4FD] text-[#2563C9] font-semibold dark:bg-blue-950/50 dark:text-blue-300"
                                          : "text-[#374349] hover:bg-[#F3F0EA] dark:text-foreground dark:hover:bg-white/5"
                                      }`}
                                    >
                                      <span className="truncate">{b}</span>
                                      {b === state.connection?.branch && (
                                        <Check className="size-3.5 text-[#2563C9] shrink-0" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                                <div className="pt-1 border-t border-[#E8E3D9] dark:border-border">
                                  {showCustomBranch ? (
                                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                                      <input
                                        type="text"
                                        placeholder="Branch name…"
                                        value={customBranchInput}
                                        onChange={(e) => setCustomBranchInput(e.target.value)}
                                        className="w-full rounded-[4px] border border-[#DBD5C8] bg-white px-2 py-1 text-xs font-mono text-[#141A1E] dark:border-border dark:bg-card dark:text-foreground focus:outline-none focus:ring-1 focus:ring-[#D14E24]"
                                        onKeyDown={async (e) => {
                                          if (e.key === "Enter" && customBranchInput.trim()) {
                                            e.currentTarget.closest("details")?.removeAttribute("open");
                                            setShowCustomBranch(false);
                                            await handleSwitchBranch(customBranchInput.trim());
                                            setCustomBranchInput("");
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        disabled={!customBranchInput.trim() || busy}
                                        onClick={async (e) => {
                                          e.currentTarget.closest("details")?.removeAttribute("open");
                                          setShowCustomBranch(false);
                                          await handleSwitchBranch(customBranchInput.trim());
                                          setCustomBranchInput("");
                                        }}
                                        className="rounded-[4px] bg-[#141A1E] px-2 py-1 text-xs font-semibold text-white hover:bg-[#212B30] disabled:opacity-50 shrink-0 cursor-pointer"
                                      >
                                        Set
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setShowCustomBranch(true)}
                                      className="w-full text-left px-2 py-1 text-[11px] font-medium text-[#2563C9] hover:underline cursor-pointer"
                                    >
                                      + Custom branch
                                    </button>
                                  )}
                                </div>
                              </div>
                            </details>
                              <span>·</span>
                              <span>Ready to review changes</span>
                          </div>
                        </div>
                      </div>

                      {/* Direct Primary Sync Actions */}
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={busy || active || isComparing}
                          onClick={() => void compare("push", "direct")}
                          className="inline-flex min-h-9 items-center gap-2 rounded-[5px] bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isComparing ? (
                            <>
                              <Loader2 className="size-3.5 shrink-0 animate-spin" />
                              <span>Loading…</span>
                            </>
                          ) : (
                            <>
                              <ArrowUpToLine className="size-3.5" />
                          <span>Review changes</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={busy || active || isComparing}
                          onClick={() => void compare("pull", "direct")}
                          className="inline-flex min-h-9 items-center gap-2 rounded-[5px] border border-[#DBD5C8] bg-white px-3.5 text-xs font-medium text-[#374349] shadow-xs transition-colors hover:bg-[#F3F0EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D14E24] disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-white/5 cursor-pointer"
                        >
                          <ArrowDownToLine className="size-3.5 text-[#2563C9]" />
                          <span>Sync from GitHub</span>
                        </button>

                        <details className="relative group/more">
                          <summary
                            aria-label="Repository actions"
                            className="flex size-9 cursor-pointer list-none items-center justify-center rounded-[5px] border border-[#DBD5C8] bg-white text-[#374349] hover:bg-[#F3F0EA] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-white/5 transition-colors shadow-xs"
                          >
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </summary>
                          {/* Transparent click-outside backdrop when open */}
                          <div
                            className="fixed inset-0 z-40 hidden group-open/more:block cursor-default"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                          />
                          <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-[6px] border border-[#DBD5C8] bg-white p-1 text-xs shadow-xl dark:border-border dark:bg-card divide-y divide-[#E8E3D9] dark:divide-border">
                            <div className="space-y-0.5 pb-1">
                              <button
                                type="button"
                                disabled={busy || active}
                                onClick={(e) => {
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                  void compare("push", "pr");
                                }}
                                className="flex w-full items-center gap-2 rounded-[4px] px-3 py-2 text-left text-xs text-[#374349] hover:bg-[#F3F0EA] dark:text-foreground dark:hover:bg-white/5 cursor-pointer"
                              >
                                <GitPullRequest className="size-3.5 text-[#2563C9]" />
                                Create Pull Request…
                              </button>
                              <a
                                className="flex w-full items-center gap-2 rounded-[4px] px-3 py-2 text-left text-xs text-[#374349] hover:bg-[#F3F0EA] dark:text-foreground dark:hover:bg-white/5"
                                href={state.connection.repository}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="size-3.5 text-[#6B7880]" />
                                Open on GitHub ↗
                              </a>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-[4px] px-3 py-2 text-left text-xs text-[#374349] hover:bg-[#F3F0EA] dark:text-foreground dark:hover:bg-white/5 cursor-pointer"
                                onClick={(e) => {
                                  e.currentTarget.closest("details")?.removeAttribute("open");
                                  openChangeRepoDialog();
                                }}
                              >
                                <Pencil className="size-3.5 text-[#6B7880]" />
                                Change repository…
                              </button>
                            </div>
                            <div className="pt-1">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-[4px] px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 cursor-pointer"
                                onClick={() => setDisconnectOpen(true)}
                              >
                                <X className="size-3.5 text-red-600 dark:text-red-400" />
                                Disconnect repository…
                              </button>
                            </div>
                          </div>
                        </details>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] py-3 text-xs text-[var(--text-muted)]">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-[2px] bg-[#1E7E34]" />
                        <span>Ready to synchronize with remote branch <strong className="font-mono text-[#141A1E] dark:text-foreground">{state.connection.branch}</strong>.</span>
                      </div>
                      {latestRun?.createdAt && <span className="font-mono text-[11px]">Last sync {new Date(latestRun.createdAt).toLocaleString()}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text-strong)]">Latest activity</p>
                      <p className="mt-1 truncate text-[var(--text-muted)]">
                        {latestRun
                          ? `${latestRun.direction === "push" ? "Published to GitHub" : "Imported from GitHub"} · ${latestRun.status}`
                          : "No sync activity yet."}
                      </p>
                    </div>
                    <details className="text-[var(--text-muted)]">
                      <summary className="cursor-pointer font-medium text-[var(--text-body)] hover:text-[var(--text-strong)]">
                        Attribution &amp; team access · {state.teamMembers.filter((member) => Boolean(member.githubLogin)).length}/{state.teamMembers.length} linked
                      </summary>
                      <div className="mt-3 w-[min(100%,32rem)] space-y-4 border-t border-[var(--border-subtle)] pt-3">
                        <ContributorIdentitySection identity={state.identity} onApproved={handleApproveIdentity} />
                        <section aria-labelledby="github-team-access-title" className="border-t border-[var(--border-subtle)] pt-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <h3 id="github-team-access-title" className="text-sm font-semibold text-[var(--text-strong)]">Team GitHub access</h3>
                              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Linked members can receive Git co-author credit. Each member connects their own account in Settings → Integrations.</p>
                            </div>
                            <span className="font-mono text-[11px] text-[var(--text-muted)]">
                              {state.teamMembers.filter((member) => Boolean(member.githubLogin)).length}/{state.teamMembers.length} linked
                            </span>
                          </div>
                          <ul className="mt-3 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
                            {state.teamMembers.map((member) => (
                              <li key={member.userId} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                                <div className="flex min-w-0 items-center gap-2">
                                  {member.avatarUrl ? (
                                    <img src={publicAvatarVariantUrl(member.avatarUrl, 64)} alt="" className="size-6 rounded-[5px] object-cover" />
                                  ) : (
                                    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-[var(--border-default)] bg-[var(--surface-sunken)] text-[10px] max-md:text-[11px] font-semibold text-[var(--text-body)]">{member.name.charAt(0)}</span>
                                  )}
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium text-[var(--text-strong)]">{member.name}</span>
                                    <span className="block truncate text-[11px] text-[var(--text-muted)]">{member.membershipRole || "Member"}</span>
                                  </span>
                                </div>
                                {member.githubLogin ? (
                                  <span className="shrink-0 font-mono text-[11px] text-[var(--status-success)]">@{member.githubLogin} linked</span>
                                ) : (
                                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">Not connected</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </section>
                      </div>
                    </details>
                  </div>

                </div>
              )}
            {!manifest &&
              !review &&
              !state.connection &&
              setupMode !== null && (
              <div className="border-y border-[var(--border-subtle)] py-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
                  <div>
                      <h2 className="text-xl font-semibold tracking-[-0.015em] text-[var(--text-strong)]">
                        {setupMode === "create"
                          ? "Create repository"
                          : "Connect existing repository"}
                      </h2>
                      <p className="mt-1 text-sm text-[var(--text-body)]">
                        {setupMode === "create"
                          ? "Choose where the reviewed project files will be published."
                          : "Choose the repository and branch to compare before a sync."}
                      </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-[6px] border border-[#DBD5C8] bg-white p-0.5 text-xs shadow-2xs dark:border-border dark:bg-background">
                      <button
                        type="button"
                        onClick={() => {
                          setSetupMode("create");
                          setNewRepo(true);
                          setDirection("push");
                        }}
                        className={`px-3 py-1 rounded-[4px] text-xs font-medium transition-colors ${
                          newRepo
                            ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                            : "text-[#6B7880] hover:text-[#141A1E] dark:text-muted-foreground dark:hover:text-foreground"
                        }`}
                      >
                        Create a repository
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSetupMode("existing");
                          setNewRepo(false);
                          void repositories();
                        }}
                        className={`px-3 py-1 rounded-[4px] text-xs font-medium transition-colors ${
                          !newRepo
                            ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                            : "text-[#6B7880] hover:text-[#141A1E] dark:text-muted-foreground dark:hover:text-foreground"
                        }`}
                      >
                        Connect an existing repository
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-5 pt-5">
                  {newRepo ? (
                    <div className="space-y-3.5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-[#141A1E] dark:text-foreground space-y-1 block">
                          <span>Owner (User or Organization)</span>
                          <input
                            className="min-h-9 w-full min-w-0 rounded-[5px] border border-[#DBD5C8] bg-white px-3 py-1.5 text-xs font-mono text-[#141A1E] placeholder:text-[#6B7880] focus-visible:border-[#D14E24] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] dark:border-border dark:bg-background dark:text-foreground"
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                            placeholder="e.g. your-github-username"
                          />
                        </label>
                        <label className="text-xs font-medium text-[#141A1E] dark:text-foreground space-y-1 block">
                          <span>Repository name</span>
                          <input
                            className="min-h-9 w-full min-w-0 rounded-[5px] border border-[#DBD5C8] bg-white px-3 py-1.5 text-xs font-mono text-[#141A1E] placeholder:text-[#6B7880] focus-visible:border-[#D14E24] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] dark:border-border dark:bg-background dark:text-foreground"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. project-files"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
                        <label className="inline-flex items-center gap-2 text-[#4C5A61] dark:text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={organization}
                            onChange={(e) => setOrganization(e.target.checked)}
                            className="rounded-[3px] border-[#DBD5C8] text-[#D14E24] focus:ring-[#D14E24]"
                          />
                          <span>Organization repository</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-[#4C5A61] dark:text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={(e) => setPrivate(e.target.checked)}
                            className="rounded-[3px] border-[#DBD5C8] text-[#D14E24] focus:ring-[#D14E24]"
                          />
                          <span>Private repository</span>
                        </label>
                      </div>
                      <p className="text-[11px] text-[#6B7880] dark:text-muted-foreground">
                        Nothing is published until you confirm in reviewed staging. Organization creation requires GitHub permissions.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="text-xs font-medium text-[#141A1E] dark:text-foreground space-y-1.5 block">
                        <span className="flex items-center justify-between">
                          <span>Target GitHub Repository URL</span>
                          {repository && repository.startsWith("https://github.com/") && (
                            <span className="text-[11px] text-[#1E7E34] dark:text-emerald-400 font-semibold flex items-center gap-1 font-mono">
                              <Check className="size-2.5" /> Valid URL
                            </span>
                          )}
                        </span>
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                          <div className="relative flex-1 min-w-0">
                            <Github className="absolute left-3 top-2.5 size-3.5 text-[#6B7880]" />
                            <input
                              className="min-h-9 w-full min-w-0 rounded-[5px] border border-[#DBD5C8] bg-white pl-9 pr-3 py-1.5 text-xs font-mono text-[#141A1E] placeholder:text-[#6B7880] focus-visible:border-[#D14E24] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] dark:border-border dark:bg-background dark:text-foreground"
                              value={repository}
                              onChange={(e) => setRepository(e.target.value)}
                              placeholder="https://github.com/owner/repository"
                            />
                          </div>
                          <button
                            type="button"
                            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-[5px] border border-[#DBD5C8] bg-white px-3.5 py-1.5 text-xs font-medium text-[#141A1E] shadow-2xs transition hover:bg-[#FAF8F4] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-white/5"
                            onClick={() => void repositories()}
                          >
                            Browse repositories
                          </button>
                        </div>
                      </label>

                      {repos.length > 0 && (
                        <div className="flex items-center gap-2 p-2.5 rounded-[6px] border border-[#DBD5C8] bg-[#FAF8F4] dark:border-border dark:bg-card/50">
                          <select
                            aria-label="Accessible GitHub repositories"
                            className="flex-1 min-w-0 rounded-[4px] border border-[#DBD5C8] bg-white px-2.5 py-1 text-xs text-[#141A1E] dark:border-border dark:bg-background dark:text-foreground"
                            value={repository}
                            onChange={(e) => {
                              setRepository(e.target.value);
                              const nextBranch =
                                repos.find(
                                  (repo) => repo.htmlUrl === e.target.value,
                                )?.defaultBranch || "main";
                              setBranch(nextBranch);
                              void loadBranches(e.target.value);
                            }}
                          >
                            <option value="">Select from your accessible repositories…</option>
                            {repos.map((repo) => (
                              <option key={repo.htmlUrl} value={repo.htmlUrl}>
                                {repo.fullName}
                              </option>
                            ))}
                          </select>
                          {cursor && (
                            <button
                              type="button"
                              className="rounded-[4px] border border-[#DBD5C8] bg-white px-2.5 py-1 text-xs font-medium text-[#141A1E] hover:bg-[#FAF8F4] dark:border-border dark:bg-card dark:text-foreground shrink-0"
                              onClick={() => void repositories(true)}
                            >
                              Load more
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. Transfer Direction & Branch Configuration (Flat 2-Column Grid) */}
                  <div className="grid gap-4 sm:grid-cols-2 border-t border-[#E8E3D9] pt-4 dark:border-border">
                    {/* Left Column: Transfer Direction */}
                    <div className="space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7880] block">
                        Transfer Direction
                      </span>

                      {newRepo ? (
                        <div className="flex items-center gap-2.5 rounded-[6px] border border-[#DBD5C8] bg-[#FAF8F4] p-3 text-xs dark:border-border dark:bg-card/50">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-[#D14E24]/10 text-[#D14E24]">
                            <ArrowUpToLine className="size-4" />
                          </div>
                          <div>
                            <span className="font-medium text-[#141A1E] dark:text-foreground block">
                              Push to GitHub
                            </span>
                            <span className="text-[11px] text-[#6B7880] dark:text-muted-foreground">
                              Workspace &rarr; Remote (Initial repository publish)
                            </span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setDirection("push")}
                              className={`flex flex-col items-center justify-center p-2.5 rounded-[6px] border text-xs font-medium transition-colors ${
                                direction === "push"
                                  ? "border-[#D14E24] bg-[#FAF8F4] text-[#D14E24] font-semibold shadow-2xs dark:bg-card dark:border-[#D14E24]"
                                  : "border-[#DBD5C8] bg-white text-[#4C5A61] hover:bg-[#FAF8F4] hover:text-[#141A1E] dark:border-border dark:bg-card dark:text-muted-foreground"
                              }`}
                            >
                              <ArrowUpToLine className="size-4 mb-1" />
                              <span>Push to GitHub</span>
                              <span className="text-[10px] max-md:text-[11px] font-normal opacity-80 mt-0.5">Workspace &rarr; Remote</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDirection("pull")}
                              className={`flex flex-col items-center justify-center p-2.5 rounded-[6px] border text-xs font-medium transition-colors ${
                                direction === "pull"
                                  ? "border-[#1E7E34] bg-[#EDF5F0] text-[#1E7E34] font-semibold shadow-2xs dark:bg-emerald-950/30 dark:border-[#1E7E34] dark:text-emerald-400"
                                  : "border-[#DBD5C8] bg-white text-[#4C5A61] hover:bg-[#FAF8F4] hover:text-[#141A1E] dark:border-border dark:bg-card dark:text-muted-foreground"
                              }`}
                            >
                              <ArrowDownToLine className="size-4 mb-1" />
                              <span>Pull into NetworkBase</span>
                              <span className="text-[10px] max-md:text-[11px] font-normal opacity-80 mt-0.5">Remote &rarr; Workspace</span>
                            </button>
                          </div>
                          {direction === "push" && (
                            <div className="pt-2">
                              <label className="text-[11px] font-medium text-[#4C5A61] dark:text-muted-foreground block mb-1">
                                Publication Strategy:
                              </label>
                              <select
                                aria-label="Publication strategy"
                                className="w-full rounded-[4px] border border-[#DBD5C8] bg-white px-2.5 py-1 text-xs text-[#141A1E] dark:border-border dark:bg-background dark:text-foreground"
                                value={mode}
                                onChange={(e) => setMode(e.target.value as "pr" | "direct")}
                              >
                                <option value="pr">Open pull request (recommended for team review)</option>
                                <option value="direct">Direct commit to branch</option>
                              </select>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Right Column: Target Branch & Protection */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7880] block">
                          Target Branch
                        </span>
                        <div className="flex items-center gap-2">
                          {!newRepo && branches.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setCustomBranchMode((prev) => !prev)}
                              className="text-[11px] text-[#D14E24] hover:underline cursor-pointer font-medium"
                            >
                              {customBranchMode ? "Choose from list" : "+ Custom branch"}
                            </button>
                          )}
                          {!newRepo && (
                            <button
                              type="button"
                              onClick={() => void loadBranches(repository)}
                              disabled={loadingBranches || !repository}
                              className="text-[11px] text-[#6B7880] hover:text-[#141A1E] dark:hover:text-foreground flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Refresh branch list from GitHub"
                            >
                              <RefreshCw className={`size-3 ${loadingBranches ? "animate-spin" : ""}`} />
                              <span>{loadingBranches ? "Fetching..." : "Refresh"}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="relative">
                        <GitBranch className="absolute left-2.5 top-2.5 size-3.5 text-[#6B7880]" />
                        {!newRepo && !customBranchMode && branches.length > 0 ? (
                          <select
                            aria-label="Target branch"
                            className="min-h-9 w-full min-w-0 rounded-[5px] border border-[#DBD5C8] bg-white pl-8 pr-3 py-1.5 text-xs font-mono text-[#141A1E] focus-visible:border-[#D14E24] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] dark:border-border dark:bg-background dark:text-foreground"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                          >
                            {branches.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="min-h-9 w-full min-w-0 rounded-[5px] border border-[#DBD5C8] bg-white pl-8 pr-3 py-1.5 text-xs font-mono text-[#141A1E] placeholder:text-[#6B7880] focus-visible:border-[#D14E24] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24] dark:border-border dark:bg-background dark:text-foreground"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            placeholder="e.g. main"
                          />
                        )}
                      </div>

                      <div className="space-y-1 text-[11px] text-[#6B7880] dark:text-muted-foreground">
                        {loadingBranches ? (
                          <p className="text-[11px] text-[#D14E24] flex items-center gap-1">
                            <RefreshCw className="size-2.5 animate-spin" /> Fetching available branches from GitHub...
                          </p>
                        ) : !newRepo && branches.length > 0 && !customBranchMode ? (
                          <p className="text-[11px] text-[#1E7E34] dark:text-emerald-400 flex items-center gap-1">
                            <Check className="size-2.5" /> {branches.length} {branches.length === 1 ? "branch" : "branches"} available on GitHub.
                          </p>
                        ) : (
                          <p className="flex items-center gap-1.5">
                            <Check className="size-3 text-[#1E7E34] shrink-0" />
                            <span>Branch protections and file history preserved.</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <details className="border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
                    <summary className="cursor-pointer font-medium text-[var(--text-body)] hover:text-[var(--text-strong)]">Sync limits and safety checks</summary>
                    <p className="mt-2 font-mono">Up to {GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} files · {formatSyncMegabytes(GITHUB_SYNC_LIMITS.fileBytes)} MB per file · {formatSyncMegabytes(GITHUB_SYNC_LIMITS.operationBytes)} MB per sync</p>
                  </details>

                  {/* 5. Action Execution Bar */}
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[5px] bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        busy ||
                        active ||
                        isComparing ||
                        !state.canAuthenticate ||
                        (newRepo ? !owner || !name : !repository || !branch)
                      }
                      onClick={() => void reviewSetup()}
                    >
                      {isComparing ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                          <span>Loading GitHub data…</span>
                        </>
                      ) : (
                        <>
                          {direction === "push" ? (
                            <ArrowUpToLine className="size-3.5 mr-1.5" />
                          ) : (
                            <ArrowDownToLine className="size-3.5 mr-1.5" />
                          )}
                          <span>Review changes</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[5px] border border-[#DBD5C8] bg-white px-4 py-2 text-xs font-medium text-[#141A1E] shadow-2xs transition hover:bg-[#FAF8F4] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        if (setupMode === "create") {
                          setName(
                            (projectName || "networkbase-project")
                              .trim()
                              .toLowerCase()
                              .replace(/[^a-z0-9._-]+/g, "-")
                              .replace(/^-+|-+$/g, "") || "networkbase-project",
                          );
                          setOwner(state?.account.username || "");
                          setPrivate(true);
                          setOrganization(false);
                        } else {
                          setRepository("");
                          setBranch("main");
                        }
                      }}
                    >
                      Discard changes
                    </button>
                  </div>
                </div>
              </div>
            )}
            {manifest && !review && (
              <section aria-labelledby="github-review-title" className="border-y border-[var(--border-subtle)]">
                {/* 1. Command Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className={`${button} min-h-8 px-2.5 py-1 text-xs`}
                      disabled={busy}
                      onClick={() => {
                        setManifest(null);
                        setChoices({});
                        setActiveInspectPath(null);
                        setDiff(null);
                      }}
                    >
                      <ArrowLeft className="size-3" />
                      <span>Back to Overview</span>
                    </button>
                    <div className="h-4 w-px bg-[var(--border-subtle)]" />
                    <div className="flex items-center gap-2">
                      <h2 id="github-review-title" className="text-sm font-semibold text-[var(--text-strong)]">
                        {direction === "push" ? "Outgoing to GitHub:" : "Incoming from GitHub:"}
                      </h2>
                      <span className="font-mono text-xs font-medium text-[var(--text-muted)]">
                        {state?.connection?.repository ? state.connection.repository.split("/").slice(-2).join("/") : ""}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-mono font-medium text-[var(--text-body)]">
                        <GitBranch className="size-3" />
                        {manifest.branch}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-[var(--border-default)] bg-[var(--surface-sunken)] px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-strong)]">
                      <Check className="size-3 text-[#1E7E34]" />
                      {selectedCount} of {filterCounts.actionable} Staged
                    </span>
                    <div className="h-4 w-px bg-[var(--border-subtle)]" />
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--status-info)] hover:underline"
                      disabled={busy}
                      onClick={() => {
                        const eligible = manifest.files.filter(
                          (file) =>
                            !file.blocked &&
                            file.change !== "unchanged" &&
                            file.change !== "delete" &&
                            file.change !== "conflict",
                        );
                        const selected = eligible.slice(0, GITHUB_SYNC_LIMITS.operationFiles);
                        setChoices(Object.fromEntries(selected.map((file) => [file.path, {}])));
                      }}
                    >
                      Select eligible
                    </button>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <button
                      type="button"
                      className="text-xs text-[var(--text-muted)] hover:underline"
                      disabled={busy}
                      onClick={() => setChoices({})}
                    >
                      Clear selection
                    </button>
                  </div>
                </div>

                {/* 2. Files Navigator & Staging Area */}
                <div className="space-y-3 py-5">
                  {/* Search & Category Filter Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="relative flex-1 min-w-[240px] max-w-md">
                      <Search className="absolute left-2.5 top-2.5 size-3.5 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Filter files by path… (e.g. .pdf, docs/)"
                        className={`${input} min-h-9 py-1.5 pl-8 pr-6 text-xs`}
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                      />
                      {filterSearch && (
                        <button
                          type="button"
                          onClick={() => setFilterSearch("")}
                          className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-600 text-xs"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setFilterCategory("all")}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          filterCategory === "all"
                            ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 font-medium"
                            : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                      >
                        All ({filterCounts.actionable})
                      </button>
                      {filterCounts.staged > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("staged")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "staged"
                              ? "bg-blue-600 text-white font-medium"
                              : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          }`}
                        >
                          Staged ({filterCounts.staged})
                        </button>
                      )}
                      {filterCounts.add > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("add")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "add"
                              ? "bg-emerald-600 text-white font-medium"
                              : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          }`}
                        >
                          Added ({filterCounts.add})
                        </button>
                      )}
                      {filterCounts.modify > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("modify")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "modify"
                              ? "bg-blue-600 text-white font-medium"
                              : "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          }`}
                        >
                          Modified ({filterCounts.modify})
                        </button>
                      )}
                      {filterCounts.conflict > 0 && (
                        <button
                          type="button"
                          onClick={() => setFilterCategory("conflict")}
                          className={`px-2.5 py-1 rounded-md transition-colors ${
                            filterCategory === "conflict"
                              ? "bg-red-600 text-white font-medium"
                              : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                          }`}
                        >
                          Conflicts ({filterCounts.conflict})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* File List Container */}
                  <div className="border-y border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] max-h-[380px] overflow-y-auto">
                    {/* Section 1: Actionable Changes */}
                    <div className="flex items-center justify-between bg-[var(--surface-sunken)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      <span>Pending Changes ({actionableVisibleFiles.length})</span>
                      <span className="text-[11px] font-normal normal-case text-zinc-400">Click &quot;View Diff&quot; to inspect changes</span>
                    </div>

                    {actionableVisibleFiles.length === 0 ? (
                      <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                        {filterSearch ? "No pending changes match filter." : "No pending changes. Local files match GitHub remote."}
                      </div>
                    ) : (
                      actionableVisibleFiles.map((file) => {
                        const isSelected = !!choices[file.path];
                        const isConflict = file.change === "conflict";
                        return (
                          <div
                            key={file.path}
                            className="flex items-center justify-between gap-3 p-3 text-xs hover:bg-[var(--surface-hover)] transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                aria-label={`Select ${file.path}`}
                                disabled={busy || !!file.blocked || file.change === "unchanged"}
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked && selectedCount >= GITHUB_SYNC_LIMITS.operationFiles) {
                                    setError(`Select no more than ${GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} files per operation.`);
                                    return;
                                  }
                                  setChoices((old) => {
                                    const next = { ...old };
                                    if (e.target.checked) next[file.path] = {};
                                    else delete next[file.path];
                                    return next;
                                  });
                                  setError("");
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-medium text-[var(--text-strong)] font-mono text-xs">
                                    {file.path}
                                  </span>
                                  {isConflict ? (
                                    <span className="rounded bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400 px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                                      conflict
                                    </span>
                                  ) : file.change === "add" ? (
                                    <span className="rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                                      +added
                                    </span>
                                  ) : file.change === "modify" ? (
                                    <span className="rounded bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                                      modified
                                    </span>
                                  ) : file.change === "delete" ? (
                                    <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                                      -deleted
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-400">
                                  <span>{(file.size / 1024).toFixed(1)} KB</span>
                                  {file.contributors.length > 0 && (
                                    <>
                                      <span>·</span>
                                      <span className="truncate max-w-[180px]">
                                        {file.contributors.map((a) => a.name).join(", ")}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* View Diff Button on the right of the row */}
                            <button
                              type="button"
                              className={`${button} min-h-8 shrink-0 px-2.5 py-1 text-xs`}
                              onClick={() => void inspectFile(file.path)}
                            >
                              <FileText className="size-3 text-blue-500" />
                              <span>View Diff</span>
                            </button>
                          </div>
                        );
                      })
                    )}

                    {/* Section 2: Clean Repository Files (Collapsible Accordion) */}
                    {cleanVisibleFiles.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowCleanFiles((prev) => !prev)}
                          className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors border-t border-zinc-100 dark:border-zinc-800"
                        >
                          <span className="flex items-center gap-1.5">
                            {showCleanFiles ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            Clean Repository Files ({cleanVisibleFiles.length})
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            {showCleanFiles ? "Click to hide" : "Unchanged"}
                          </span>
                        </button>

                        {showCleanFiles && (
                          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/40 bg-zinc-50/20 dark:bg-zinc-950/20">
                            {cleanVisibleFiles.map((file) => (
                              <div
                                key={file.path}
                                className="flex items-center justify-between p-2.5 px-4 text-xs text-zinc-500 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/30 font-mono text-[11px]"
                              >
                                <span className="truncate">{file.path}</span>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="text-[11px] text-zinc-400">{(file.size / 1024).toFixed(1)} KB</span>
                                  <button
                                    type="button"
                                    className="text-[11px] text-blue-600 hover:underline dark:text-blue-400 font-sans font-medium"
                                    onClick={() => void inspectFile(file.path)}
                                  >
                                    View Diff
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {filterCounts.actionable > 0 && selectedCount === 0 && (
                    <p className="text-xs text-[var(--text-muted)]">Select the files you want to review before choosing how to publish or import them.</p>
                  )}
                </div>

                {/* Publish options only appear once the user has selected changes. */}
                {selectedCount > 0 && <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] py-5 space-y-3.5">
                  {/* Row 1: Strategy & Task Directives */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {direction === "push" && !newRepo && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Strategy:</span>
                        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setMode("direct")}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                              mode === "direct"
                                ? "bg-blue-600 text-white font-semibold shadow-xs"
                                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                            }`}
                          >
                            Direct commit to {manifest.branch}
                          </button>
                          <button
                            type="button"
                            onClick={() => setMode("pr")}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                              mode === "pr"
                                ? "bg-blue-600 text-white font-semibold shadow-xs"
                                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                            }`}
                          >
                            Open Pull Request
                          </button>
                        </div>
                      </div>
                    )}

                    {syncTasks.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-zinc-500 text-[11px]">Auto-action task:</span>
                        <select
                          aria-label="Link task to commit message"
                          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                          defaultValue=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const [directive, key] = val.split(":");
                            setMessage((prev) => {
                              const tag = `${directive} #${key}`;
                              return prev.includes(tag) ? prev : `${prev.trim()} ${tag}`;
                            });
                            e.target.value = "";
                          }}
                        >
                          <option value="">Choose task &amp; action…</option>
                          {syncTasks.map((t) => (
                            <optgroup key={t.id} label={`${t.key}: ${t.title.slice(0, 24)}`}>
                              <option value={`Closes:${t.key}`}>Closes #{t.key} (Mark Done on push)</option>
                              <option value={`Ref:${t.key}`}>Ref #{t.key} (Reference only)</option>
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Commit Message Input with Conventional Commit Chips */}
                  <div className="space-y-1.5">
                    <div className="relative">
                      <input
                        type="text"
                        id="sync-commit-message"
                        className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-900 dark:text-zinc-100 pr-16 font-mono"
                        value={message}
                        maxLength={2000}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="feat: concise commit summary (e.g. Closes #NB-14)..."
                      />
                      <span className="absolute right-2.5 top-2 text-[11px] font-mono text-zinc-400">
                        {message.length}/2000
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[11px] text-zinc-400 font-medium mr-1">Prefix:</span>
                      {["feat:", "fix:", "refactor:", "docs:", "perf:", "chore:"].map((prefix) => (
                        <button
                          key={prefix}
                          type="button"
                          onClick={() => {
                            setMessage((prev) => {
                              const clean = prev.replace(/^(feat|fix|refactor|docs|perf|chore)(\([a-z0-9-]+\))?:\s*/i, "");
                              return `${prefix} ${clean}`.trim();
                            });
                          }}
                          className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-mono font-medium text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          {prefix}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Row 3: Pre-Flight Safety Shield & Action Button */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3 text-[11px]">
                      {detectedSecurityRisk ? (
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold animate-none">
                          <AlertTriangle className="size-3.5" />
                          Security Alert: {detectedSecurityRisk.reason}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <ShieldCheck className="size-3.5" />
                          Secret Scan: Clean
                        </span>
                      )}
                      <span className="text-zinc-300 dark:text-zinc-700">·</span>
                      <span className="text-zinc-500">
                        Payload: &lt; {formatSyncMegabytes(GITHUB_SYNC_LIMITS.operationBytes)} MB
                      </span>
                      {selectedContributors.length > 0 && (
                        <>
                          <span className="text-zinc-300 dark:text-zinc-700">·</span>
                          <span className="text-zinc-500">
                            {selectedContributors.length} credited author{selectedContributors.length > 1 ? "s" : ""}
                          </span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className={`nb-touch-target ${button} bg-blue-600 text-white font-medium px-5 min-h-9 h-9 text-xs shadow-xs`}
                      disabled={busy || !selectedCount || unresolved || !message.trim() || !!detectedSecurityRisk}
                      onClick={() => void prepare()}
                    >
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {direction === "push"
                        ? mode === "direct"
                          ? `Commit & Push ${selectedCount} ${selectedCount === 1 ? "File" : "Files"} directly to ${manifest.branch}`
                          : `Create PR (${selectedCount} ${selectedCount === 1 ? "File" : "Files"})`
                        : `Import ${selectedCount} ${selectedCount === 1 ? "File" : "Files"}`}
                    </button>
                  </div>

                  {detectedSecurityRisk && (
                    <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300">
                      <p className="text-[11px]">
                        <strong>Blocked:</strong> {detectedSecurityRisk.reason} found in <code>{detectedSecurityRisk.path}</code>. Unstage before pushing.
                      </p>
                    </div>
                  )}
                </div>}
              </section>
            )}

            {/* On-Demand Diff Inspector Dialog */}
            <Dialog
              open={!!activeInspectPath}
              onOpenChange={(open) => {
                if (!open) {
                  setActiveInspectPath(null);
                  setDiff(null);
                }
              }}
            >
              <DialogContent className="max-w-4xl w-full max-h-[85vh] flex flex-col p-6 overflow-hidden bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-xl">
                <DialogTitle className="flex items-center justify-between gap-3 text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  <span className="truncate">{activeInspectPath}</span>
                  {activeInspectPath && choices[activeInspectPath]?.resolution && (
                    <span className="rounded-[3px] border border-[#CDE5D4] bg-[#EDF5F0] px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-[#1E7E34] dark:bg-emerald-950/40 dark:text-emerald-400">
                      Resolution: {choices[activeInspectPath]?.resolution}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-500">
                  Comparing NetworkBase workspace against remote {manifest?.branch}
                </DialogDescription>

                {/* 1-Click Conflict Resolution Toolbar */}
                {manifest && activeInspectPath && manifest.files.find((f) => f.path === activeInspectPath)?.change === "conflict" && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs dark:border-amber-700/40 dark:bg-amber-950/30 shrink-0 mt-2">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200 mb-2">
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>Concurrent conflict detected. Choose which version to keep:</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={`rounded px-3 py-1.5 font-medium text-xs transition-colors border shadow-none ${
                          choices[activeInspectPath]?.resolution === "edge"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100"
                        }`}
                        onClick={() => {
                          setChoices((prev) => ({
                            ...prev,
                            [activeInspectPath]: { resolution: "edge" },
                          }));
                        }}
                      >
                        Keep NetworkBase (Mine)
                      </button>
                      <button
                        type="button"
                        className={`rounded px-3 py-1.5 font-medium text-xs transition-colors border shadow-none ${
                          choices[activeInspectPath]?.resolution === "github"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100"
                        }`}
                        onClick={() => {
                          setChoices((prev) => ({
                            ...prev,
                            [activeInspectPath]: { resolution: "github" },
                          }));
                        }}
                      >
                        Keep GitHub (Theirs)
                      </button>
                    </div>
                  </div>
                )}

                {/* Diff Viewer Canvas */}
                <div className="flex-1 overflow-y-auto min-h-0 pt-3">
                  {loadingDiff ? (
                    <div className="flex items-center justify-center p-16 text-xs text-zinc-400 gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Loading file diff…</span>
                    </div>
                  ) : diff && diff.path === activeInspectPath ? (
                    diff.binary ? (
                      <p className="p-8 text-xs text-zinc-500 italic bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 text-center">
                        Binary content cannot be diffed textually.
                      </p>
                    ) : (
                      <SplitDiffViewer
                        leftTitle="NetworkBase Workspace (Local)"
                        leftContent={diff.edge}
                        rightTitle={`GitHub (${manifest?.branch})`}
                        rightContent={diff.github}
                      />
                    )
                  ) : (
                    <p className="p-8 text-xs text-zinc-400 italic text-center">
                      Select a file to inspect diff.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            {review && (
              <section aria-labelledby="github-confirm-title" className="space-y-4 border-y border-[var(--border-subtle)] py-5">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                  <div className="flex items-center gap-2">
                    {review.direction === "push" ? (
                      <ArrowUpToLine className="size-4 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <ArrowDownToLine className="size-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <h2 id="github-confirm-title" className="font-semibold text-lg text-[var(--text-strong)]">
                      Confirm {review.direction === "push" ? "Publication to GitHub" : "Import from GitHub"}
                    </h2>
                  </div>
                  <span className="rounded-[3px] border border-[var(--border-default)] bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-mono font-medium text-[var(--text-body)]">
                    {review.manifest.files.length} file{review.manifest.files.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text-strong)]">
                    {review.manifest.repository.replace(/^https:\/\/github\.com\//, "")}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                    <GitBranch className="size-3" />
                    {review.manifest.branch}
                  </span>
                </div>

                <p className="text-sm leading-relaxed text-[var(--text-body)]">
                  {review.direction === "pull"
                    ? "Incoming changes create new file revisions in workspace. Reviewed deletions move local files safely to Trash."
                    : review.manifest.newRepository
                      ? `Create a ${review.manifest.newRepository.private ? "private" : "PUBLIC"} repository and publish these files.`
                      : review.manifest.mode === "pr"
                        ? "Publish a separate branch and open a pull request on GitHub. Nothing is auto-merged."
                        : `Write a commit directly to '${review.manifest.branch}'. GitHub branch protections and audit rules still apply.`}
                </p>
                {review.error && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
                  >
                    <AlertTriangle className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{review.error}</span>
                    {isGithubWorkflowPermissionError(review.error) && (
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => void authorizeWorkflow()}
                      >
                        Authorize workflow publishing
                      </button>
                    )}
                  </div>
                )}
                <ul className="max-h-52 overflow-auto border-y border-[var(--border-subtle)] py-2 text-sm text-[var(--text-body)]">
                  {review.manifest.files.map((file) => (
                    <li key={file.path} className="break-all py-1">
                      {file.resultBlobSha ? "Write" : "Delete"} · {file.path}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-[var(--text-muted)]">
                  Actual editors retain attribution. NetworkBase automatically uses
                  each linked editor&apos;s privacy-safe GitHub identity when
                  available; unlinked editors remain credited inside NetworkBase.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={busy || active}
                    onClick={() => void execute(review)}
                  >
                    {review.status === "failed"
                      ? "Retry publication"
                      : review.manifest.newRepository
                        ? "Create repository and publish"
                        : review.direction === "push"
                          ? review.manifest.mode === "direct"
                            ? `Confirm & Commit directly to ${review.manifest.branch}`
                            : "Confirm & Open Pull Request"
                          : "Confirm and import"}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await sync.cancelGitHubSyncReview(
                          projectId,
                          review.id,
                        );
                        if (!result.success) throw new Error(result.error);
                        setReview(null);
                        setManifest(null);
                      })
                    }
                  >
                    Cancel review
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <Dialog
        open={!!diff}
        onOpenChange={(open) => {
          if (!open) setDiff(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-5xl overflow-y-auto">
          <DialogTitle>Compare file</DialogTitle>
          <DialogDescription className="break-all">
            {diff?.path}. Review both sides before choosing a conflict
            resolution.
          </DialogDescription>
          {diff?.binary ? (
            <p>
              This file requires a binary viewer. Choose the version to keep;
              text merging is unavailable.
            </p>
          ) : (
            <>
              <SplitDiffViewer
                leftTitle="NetworkBase Workspace (Local)"
                leftContent={diff?.edge || ""}
                rightTitle={`GitHub (${branch})`}
                rightContent={diff?.github || ""}
              />
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer hover:underline">Common baseline</summary>
                <pre className="max-h-40 overflow-auto rounded border p-2 mt-1 text-[11px] font-mono bg-zinc-50 dark:bg-zinc-950 dark:border-zinc-800">
                  {diff?.base || "No recorded baseline"}
                </pre>
              </details>
            </>
          )}
          {diff &&
            manifest?.files.find((file) => file.path === diff.path)?.change ===
              "conflict" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {(["edge", "github"] as const).map((resolution) => (
                    <button
                      key={resolution}
                      type="button"
                      className={button}
                      onClick={() => {
                        if (
                          resolution ===
                          (direction === "push" ? "github" : "edge")
                        ) {
                          setChoices((old) => {
                            const next = { ...old };
                            delete next[diff.path];
                            return next;
                          });
                          setDiff(null);
                          return;
                        }
                        setChoices((old) => ({
                          ...old,
                          [diff.path]: { resolution },
                        }));
                        setDiff(null);
                      }}
                    >
                      {resolution === (direction === "push" ? "github" : "edge")
                        ? "Keep destination · skip this file"
                        : `Use ${resolution === "edge" ? "NetworkBase" : "GitHub"} version`}
                    </button>
                  ))}
                </div>
                {!diff.binary && (
                  <>
                    <label>
                      Resolved text
                      <textarea
                        className={`${input} min-h-40 font-mono`}
                        value={merged}
                        onChange={(e) => setMerged(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        setChoices((old) => ({
                          ...old,
                          [diff.path]: { resolution: "merge", content: merged },
                        }));
                        setDiff(null);
                      }}
                    >
                      Use resolved text
                    </button>
                  </>
                )}
              </>
            )}
        </DialogContent>
      </Dialog>
      {/* Repository destination changes remain deliberate, reversible at the connection level, and fully validated server-side. */}
      <Dialog open={changeRepoDialogOpen} onOpenChange={setChangeRepoDialogOpen}>
        <DialogContent className="z-[200] overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-[var(--border-subtle)] px-5 pb-4 pt-5">
            <DialogTitle className="text-xl tracking-[-0.015em]">Change target repository</DialogTitle>
            <DialogDescription className="max-w-[58ch] pt-1 text-sm leading-6 text-[var(--text-body)]">
              Point this project to a different GitHub repository and branch. No files are published by this change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-5 py-5">
            <dl className="grid gap-2 border-y border-[var(--border-subtle)] py-3 text-xs sm:grid-cols-[8rem_1fr]">
              <dt className="font-medium text-[var(--text-muted)]">Current target</dt>
              <dd className="break-all font-mono text-[var(--text-body)]">
                {state?.connection?.repository.replace(/^https:\/\/github\.com\//, "") || "Not connected"} <span className="text-[var(--text-muted)]">· {state?.connection?.branch || "main"}</span>
              </dd>
            </dl>
            <section aria-labelledby="new-target-title" className="space-y-4">
              <div>
                <h3 id="new-target-title" className="text-sm font-semibold text-[var(--text-strong)]">New destination</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">You need write access to the repository and the branch must already exist.</p>
              </div>
              <label className="block space-y-1.5 text-sm font-medium text-[var(--text-strong)]">
                <span>GitHub repository URL</span>
                <input
                  type="url"
                  value={changeRepoUrl}
                  onChange={(e) => setChangeRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repository"
                  aria-invalid={changeRepoUrl.length > 0 && !isChangeRepoUrlValid}
                  className={`${input} font-mono text-xs ${changeRepoUrl.length > 0 && !isChangeRepoUrlValid ? "border-[var(--status-danger)]" : ""}`}
                />
                {changeRepoUrl.length > 0 && !isChangeRepoUrlValid ? (
                  <span className="text-xs font-normal text-[var(--status-danger)]">Enter a full GitHub repository URL, for example github.com/owner/repository.</span>
                ) : (
                  <span className="text-xs font-normal text-[var(--text-muted)]">The repository is verified before the destination is changed.</span>
                )}
              </label>
              <label className="block max-w-xs space-y-1.5 text-sm font-medium text-[var(--text-strong)]">
                <span>Target branch</span>
                <input
                  value={changeRepoBranch}
                  onChange={(e) => setChangeRepoBranch(e.target.value)}
                  placeholder="main"
                  className={`${input} font-mono text-xs`}
                />
              </label>
            </section>
            <p className="border-l-2 border-[var(--status-info)] pl-3 text-xs leading-5 text-[var(--text-muted)]">Existing project files, recorded history, and completed syncs remain in NetworkBase. Future comparisons will use the new destination.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-5 py-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => setChangeRepoDialogOpen(false)}
              className={`${button} shrink-0`}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSaveTargetRepository || busy}
              onClick={handleSaveRepoUrl}
              className={`${primaryButton} min-w-36 shrink-0`}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Save destination
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogTitle>Disconnect this repository?</DialogTitle>
          <DialogDescription>
            Project files, GitHub files, and recorded contribution history are
            kept. Unexecuted reviews are cancelled. GitHub repository access is
            not revoked.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => setDisconnectOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || active}
              onClick={() =>
                void perform(async () => {
                  const result =
                    await sync.disconnectGitHubSyncRepository(projectId);
                  if (!result.success) throw new Error(result.error);
                  setDisconnectOpen(false);
                  setManifest(null);
                  setReview(null);
                  setRepository("");
                  await load();
                })
              }
            >
              Disconnect
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
