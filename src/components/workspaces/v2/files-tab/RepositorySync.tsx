"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  GitBranch,
  Github,
  Search,
  X,
} from "lucide-react";
import * as sync from "@/app/actions/github-sync";
import {
  fetchGithubImportBranches,
  fetchGithubImportRepositories,
} from "@/lib/github/import-client";
import type { GithubImportAccessState } from "@/lib/github/import-types";
import { startGithubSyncAuthorization } from "@/lib/github/oauth-client";
import { clearGithubOAuthReturn, githubOAuthReturnFailure } from "@/lib/github/oauth-errors";
import {
  normalizeGithubRepoUrl,
  isValidGithubBranchName,
} from "@/lib/github/repo-validation";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";
import type {
  SyncFile,
  SyncFileUpdate,
  SyncManifest,
  SyncRunView,
} from "@/lib/github/sync-contract";
import { isGithubWorkflowPermissionError } from "@/lib/github/sync-contract";
import { GITHUB_SYNC_LIMITS } from "@/lib/github/sync-limits";
import {
  authFailureText,
  canRetryRun,
  changeLabel,
  eligibleSyncFile,
  formatSyncBytes,
  formatSyncDate,
  isActiveRun,
  needsRunAttention,
  readSyncDraft,
  restoreSyncChoices,
  runProgress,
  selectionProblem,
  selectEligibleChanges,
  syncChoice,
  setupProblem,
  type SyncChoices,
  type SyncDraft,
  type SyncSetup,
} from "@/lib/github/repository-sync";
import { cn } from "@/lib/utils";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFilesStore } from "@/stores/filesStore";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonGitHubSync } from "@/components/workspaces/skeletons/SkeletonGitHubSync";
import { ContributorIdentitySection } from "./github-sync/ContributorIdentitySection";
import { scanForSecrets } from "./github-sync/secret-scan";
import { button, quietButton } from "./github-sync/sync-styles";
const primaryButton =
  "inline-flex min-h-[34px] max-w-full items-center justify-center gap-1.5 rounded-[5px] border border-primary bg-primary px-3 py-1.5 text-[13px] font-medium leading-snug text-primary-foreground hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background pointer-coarse:min-h-11";
import {
  ChangeBadge,
  FileActor,
  FileMetadata,
  SyncBadge,
  SyncHeading,
  TransferRoute,
} from "./github-sync/SyncPrimitives";
import styles from "./github-sync/RepositorySync.module.css";
import { TerminalBlock } from "@/components/ui/terminal-block";
import { formatRelativeTime } from "./folder/format";

type Success<T> =
  Extract<T, { success: true }> extends { data: infer D } ? D : never;
type RepositorySyncState = Success<
  Awaited<ReturnType<typeof sync.getGitHubSyncState>>
>;
type View =
  | "overview"
  | "setup"
  | "review"
  | "confirmation"
  | "run"
  | "result"
  | "recovery"
  | "settings"
  | "attribution"
  | "connect";
type Filter = "all" | "selected" | "conflicts" | "excluded";
type Modal =
  | "branch"
  | "discard"
  | "cancel"
  | "disconnect"
  | "target"
  | "history"
  | "diff"
  | null;
type Diff = {
  path: string;
  edge: string;
  github: string;
  base: string;
  binary: boolean;
};
const PAGE_SIZE = 20;
const draftKey = (projectId: string, viewerId: string) =>
  `github-sync-draft:${projectId}:${viewerId}`;
const shortRepo = (value: string) =>
  value.replace(/^https:\/\/github\.com\//, "");

function DiffContentPane({
  content,
  emptyLabel = "(File absent or empty)",
}: {
  content?: string | null;
  emptyLabel?: string;
}) {
  // The shared code style (CLI report A9.9): line numbers never copied, long files collapse with "Show all".
  return (
    <TerminalBlock variant="code" lines={Boolean(content)} collapseAfter={500} copy={Boolean(content)}>
      {content || emptyLabel}
    </TerminalBlock>
  );
}

export function RepositorySync({
  projectId,
  canManage,
  access,
  projectName = "Workspace",
  projectSlug,
}: {
  projectId: string;
  canManage: boolean;
  access: GithubImportAccessState | null;
  projectName?: string;
  projectSlug?: string;
}) {
  const [state, setState] = useState<RepositorySyncState | null>(null);
  const [view, setView] = useState<View>("overview");
  const [setup, setSetup] = useState<SyncSetup>({
    repository: "",
    branch: "main",
    direction: "push",
    mode: "direct",
    newRepository: {
      owner: "",
      name:
        projectName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "networkbase-project",
      private: true,
      organization: false,
    },
  });
  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [choices, setChoices] = useState<SyncChoices>({});
  const [message, setMessage] = useState(
    "Update workspace files from NetworkBase",
  );
  // Push from an applied change set (report G18): its title and message become the commit message, once.
  useEffect(() => {
    const url = new URL(window.location.href);
    const given = url.searchParams.get("syncMessage");
    if (!given) return;
    setMessage(given.slice(0, 2000));
    url.searchParams.delete("syncMessage");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);
  const [run, setRun] = useState<SyncRunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pollError, setPollError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [authWaiting, setAuthWaiting] = useState(false);
  const [resume, setResume] = useState<SyncDraft | null>(null);
  const [repos, setRepos] = useState<
    Array<{ fullName: string; htmlUrl: string; defaultBranch: string | null }>
  >([]);
  const [repoCursor, setRepoCursor] = useState<string | null>(null);
  const [repoStatus, setRepoStatus] = useState<
    "idle" | "loading" | "empty" | "failed" | "ready"
  >("idle");
  const [repoError, setRepoError] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [owners, setOwners] = useState<{
    personal: string;
    organizations: string[];
  } | null>(null);
  const [ownersError, setOwnersError] = useState("");
  const [ownersRetry, setOwnersRetry] = useState(0);
  const [branchError, setBranchError] = useState("");
  const [branchRefresh, setBranchRefresh] = useState(0);
  const [repositoryWritable, setRepositoryWritable] = useState<boolean | null>(
    null,
  );
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [newBranchError, setNewBranchError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [cleanPage, setCleanPage] = useState(0);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [inspectPath, setInspectPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [merged, setMerged] = useState("");
  const [mergeError, setMergeError] = useState("");
  const [updates, setUpdates] = useState<Record<string, SyncFileUpdate>>({});
  const [metadataError, setMetadataError] = useState("");
  const [metadataRetry, setMetadataRetry] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [target, setTarget] = useState({ repository: "", branch: "" });
  const [returnView, setReturnView] = useState<View>("overview");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inspectorRef = useRef<HTMLHeadingElement>(null);
  const seeded = useRef(false);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const inspectRequest = useRef(0);
  const branchRequest = useRef(0);
  const busyRef = useRef(false);
  const authAttempt = useRef(0);
  const authReturnedError = useRef(false);
  const applied = useRef(new Set<string>());
  const setBadge = useFilesStore((s) => s.setGitSyncBadge);
  const creating = Boolean(setup.newRepository);
  const activeRun =
    state?.runs.find(isActiveRun) || (isActiveRun(run) ? run : null);
  const unfinished =
    activeRun ||
    (state?.runs[0] && needsRunAttention(state.runs[0]) ? state.runs[0] : null);
  const selected = useMemo(
    () =>
      manifest?.files.filter((file) =>
        Boolean(syncChoice(choices, file.path)),
      ) || [],
    [manifest, choices],
  );
  const selectedProblem = selectionProblem(manifest, choices, message);
  const pendingChanges = useMemo(
    () =>
      manifest?.files.filter(
        (file) => file.change !== "unchanged" || file.blocked,
      ) || [],
    [manifest],
  );
  const eligible = useMemo(
    () => pendingChanges.filter(eligibleSyncFile),
    [pendingChanges],
  );
  const clean = useMemo(
    () =>
      manifest?.files.filter(
        (file) => file.change === "unchanged" && !file.blocked,
      ) || [],
    [manifest],
  );
  const visible = useMemo(
    () =>
      pendingChanges.filter(
        (file) =>
          (!query.trim() ||
            file.path
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())) &&
          (filter === "all" ||
            (filter === "selected" &&
              Boolean(syncChoice(choices, file.path))) ||
            (filter === "conflicts" && file.change === "conflict") ||
            (filter === "excluded" && Boolean(file.blocked))),
      ),
    [pendingChanges, query, filter, choices],
  );
  const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageFiles = visible.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const visibleSelected = visible.filter((file) =>
    syncChoice(choices, file.path),
  ).length;
  const inspectFile = manifest?.files.find((file) => file.path === inspectPath);
  const workflowRequired = isGithubWorkflowPermissionError(error || run?.error);

  const load = useCallback(async () => {
    if (!canManage) return null;
    const id = ++requestId.current;
    const result = await sync.getGitHubSyncState(projectId);
    if (!mounted.current || id !== requestId.current) return null;
    if (!result.success) throw new Error(result.error);
    const current = result.data;
    setState(current);
    setCheckedAt(new Date().toISOString());
    setPollError("");
    setRun((previous) =>
      previous
        ? current.runs.find((item) => item.id === previous.id) || previous
        : previous,
    );
    if (!seeded.current) {
      seeded.current = true;
      setSetup((previous) =>
        current.connection
          ? {
              repository: current.connection.repository,
              branch: current.connection.branch,
              direction: "push",
              mode: "pr",
            }
          : {
              ...previous,
              newRepository: {
                ...previous.newRepository!,
                owner: current.account.username || "",
              },
            },
      );
      let draft: SyncDraft | null = null;
      try {
        draft = readSyncDraft(
          sessionStorage.getItem(draftKey(projectId, current.viewerId)),
          projectId,
          current.viewerId,
        );
      } catch {
        /* Sign-in will explain if this browser cannot retain a draft. */
      }
      if (draft) {
        setSetup(draft.setup);
        setMessage(draft.message);
        const retained = draft.runId
          ? current.runs.find((item) => item.id === draft.runId)
          : null;
        if (current.canAuthenticate && !authReturnedError.current) {
          if (retained) {
            setRun(retained);
            setView(
              retained.status === "review"
                ? "confirmation"
                : isActiveRun(retained)
                  ? "run"
                  : retained.status === "completed"
                    ? "result"
                    : "recovery",
            );
            sessionStorage.removeItem(draftKey(projectId, current.viewerId));
          } else setResume(draft);
        } else setView("connect");
      } else if (!current.canAuthenticate) {
        const active = current.runs.find(isActiveRun);
        if (active) {
          setRun(active);
          setView("run");
        } else setView("connect");
      } else if (!current.connection) setView("setup");
    }
    for (const item of current.runs) {
      const key = `${item.id}:${item.result.applied?.length || 0}`;
      if (
        item.direction === "pull" &&
        item.result.applied?.length &&
        !applied.current.has(key)
      ) {
        applied.current.add(key);
        window.dispatchEvent(
          new CustomEvent("project:task-files-changed", {
            detail: { projectId },
          }),
        );
      }
    }
    return current;
  }, [projectId, canManage]);
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Couldn’t load repository sync.",
        );
    });
    return () => {
      mounted.current = false;
      requestId.current++;
      inspectRequest.current++;
      branchRequest.current++;
    };
  }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = githubOAuthReturnFailure(url);
    if (code) {
      authReturnedError.current = true;
      setError(authFailureText(code));
      setView("connect");
      clearGithubOAuthReturn(url);
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "nearest" });
  }, [view]);
  useEffect(() => {
    if (view === "run" && run && !isActiveRun(run))
      setView(
        run.status === "completed"
          ? "result"
          : run.status === "review"
            ? "confirmation"
            : "recovery",
      );
  }, [view, run]);
  const loadRef = useRef(load);
  loadRef.current = load;

  // Heartbeat using lightweight getActiveSyncRun (1 query, 1ms, zero heavy joins)
  useEffect(() => {
    if (!activeRun || !canManage) return;
    let pending = false;
    const runId = activeRun.id;
    return createVisibilityAwareInterval(() => {
      if (pending) return;
      pending = true;
      void sync
        .getActiveSyncRun(projectId, runId)
        .then((res) => {
          if (res.success && mounted.current) {
            setRun(res.data);
            if (!isActiveRun(res.data)) {
              void loadRef.current().catch(() => {});
            }
          }
        })
        .catch((e) =>
          setPollError(
            e instanceof Error ? e.message : "Progress could not refresh.",
          ),
        )
        .finally(() => {
          pending = false;
        });
    }, 3500);
  }, [Boolean(activeRun), canManage]);
  useEffect(() => {
    if (!state) return;
    const latest = state.runs[0];
    setBadge(
      projectId,
      activeRun
        ? {
            status: "syncing",
            tooltip:
              activeRun.status === "queued"
                ? "Synchronization queued"
                : activeRun.stage,
          }
        : latest && ["failed", "needs_review"].includes(latest.status)
          ? {
              status: "failed",
              tooltip: latest.error || "Repository sync needs attention",
            }
          : state.connection?.incomingSha
            ? {
                status: "incoming",
                count: 1,
                tooltip: "Incoming changes require review",
              }
            : latest?.status === "completed"
              ? {
                  status: "completed",
                  tooltip: latest.result.pullRequestUrl
                    ? "Pull request awaiting merge"
                    : "Last synchronization completed",
                }
              : null,
    );
  }, [state, activeRun, projectId, setBadge]);

  async function perform(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "The operation could not finish. Try again.",
        );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function resetReview() {
    inspectRequest.current++;
    setManifest(null);
    setChoices({});
    setInspectPath(null);
    setDiff(null);
    setDiffError("");
    setFilter("all");
    setQuery("");
    setPage(0);
    setCleanPage(0);
    setCleanOpen(false);
    setUpdates({});
    setNotice("");
  }
  async function compare(input = setup, draft?: SyncDraft) {
    if (activeRun) {
      setError(
        "Open the unfinished operation before starting another transfer.",
      );
      return;
    }
    const problem = setupProblem(input);
    if (problem) {
      setError(problem);
      return;
    }
    setComparing(true);
    await perform(async () => {
      const result = await sync.compareGitHubSync(projectId, {
        ...input,
        repository: input.newRepository ? undefined : input.repository,
      });
      if (!result.success) throw new Error(result.error);
      if (!mounted.current) return;
      resetReview();
      setSetup({ ...input, mode: result.data.mode });
      setManifest(result.data);
      setView("review");
      setRun(null);
      if (draft) {
        const restored = restoreSyncChoices(result.data, draft);
        setChoices(restored.choices);
        setNotice(
          restored.changed
            ? `${restored.changed} previously selected changes were updated or became unavailable. Review them again.`
            : "Your file selection was restored. Review it before confirming.",
        );
      }
      if (state) sessionStorage.removeItem(draftKey(projectId, state.viewerId));
    });
    setComparing(false);
  }
  const compareRef = useRef(compare);
  compareRef.current = compare;
  useEffect(() => {
    if (resume && state?.canAuthenticate) {
      setResume(null);
      void compareRef.current(resume.setup, resume);
    }
  }, [resume, state?.canAuthenticate]);
  async function prepare() {
    if (selectedProblem) {
      setError(selectedProblem);
      return;
    }
    await perform(async () => {
      if (run?.status === "review") {
        const cancelled = await sync.cancelGitHubSyncReview(projectId, run.id);
        if (!cancelled.success) throw new Error(cancelled.error);
      }
      const result = await sync.prepareGitHubSync(
        projectId,
        {
          ...setup,
          repository: setup.newRepository ? undefined : setup.repository,
        },
        selected.map((file) => ({
          path: file.path,
          ...syncChoice(choices, file.path),
          expectedLocalHash: file.localHash,
          expectedRemoteSha: file.remoteSha,
        })),
        message,
      );
      if (!result.success) throw new Error(result.error);
      setRun(result.data);
      setView("confirmation");
      await load();
    });
  }
  async function execute(value: SyncRunView) {
    if (!["review", "failed", "queued"].includes(value.status)) return;
    setRun({
      ...value,
      status: "queued",
      stage: "Submitting reviewed operation",
    });
    setView("run");
    await perform(async () => {
      const result = await sync.executeGitHubSync(projectId, value.id);
      if (!result.success) {
        await load();
        throw new Error(result.error);
      }
      setRun(result.data);
      setView(
        result.data.status === "completed"
          ? "result"
          : isActiveRun(result.data)
            ? "run"
            : "recovery",
      );
      await load();
    });
    // Refresh authoritative status after transport errors; never infer completion from an action envelope.
    if (mounted.current) void load().catch((e) => setPollError(e.message));
  }
  function openOperation(value: SyncRunView) {
    setRun(value);
    setError("");
    setView(
      value.status === "review"
        ? "confirmation"
        : isActiveRun(value)
          ? "run"
          : value.status === "completed"
            ? "result"
            : "recovery",
    );
  }
  async function cancelOperation(value: SyncRunView) {
    await perform(async () => {
      const result = await sync.cancelGitHubSyncReview(projectId, value.id);
      if (!result.success) {
        setModal(null);
        await load();
        throw new Error(result.error);
      }
      setModal(null);
      setRun(null);
      resetReview();
      setView("overview");
      await load();
    });
  }
  function back() {
    if (
      (view === "review" && Object.keys(choices).length) ||
      (view === "confirmation" && run?.status === "review")
    ) {
      setModal("discard");
      return;
    }
    setError("");
    setView("overview");
  }
  async function authorize() {
    const attempt = ++authAttempt.current;
    setError("");
    setAuthWaiting(true);
    try {
      if (state) {
        const draft: SyncDraft = {
          version: 1,
          projectId,
          viewerId: state.viewerId,
          savedAt: Date.now(),
          setup,
          message,
          runId: run?.id,
          selected: selected.map((file) => ({
            path: file.path,
            localHash: file.localHash,
            remoteSha: file.remoteSha,
            choice: syncChoice(choices, file.path)!,
          })),
        };
        const encoded = JSON.stringify(draft);
        if (encoded.length > 2 * 1024 * 1024)
          throw new Error(
            "Your combined text is too large to retain during sign-in. Save it before renewing access.",
          );
        sessionStorage.setItem(draftKey(projectId, state.viewerId), encoded);
      }
      const nextPath = projectSlug
        ? `/workspaces/${projectSlug}?tab=files&filesView=github`
        : undefined;
      await startGithubSyncAuthorization({
        nextPath,
        isCurrent: () => attempt === authAttempt.current,
      });
    } catch (e) {
      if (attempt === authAttempt.current) {
        setAuthWaiting(false);
        setError(
          e instanceof Error ? e.message : "GitHub sign-in could not start.",
        );
      }
    }
  }
  useEffect(() => {
    if (!authWaiting) return;
    const timeout = setTimeout(() => {
      authAttempt.current++;
      setAuthWaiting(false);
      setError(
        "GitHub sign-in has not completed. Your setup is retained; try again when ready.",
      );
    }, 30_000);
    const returned = () => {
      authAttempt.current++;
      setAuthWaiting(false);
      void loadRef.current().catch((e) => setError(e.message));
    };
    window.addEventListener("pageshow", returned);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("pageshow", returned);
    };
  }, [authWaiting]);
  async function browse(more = false) {
    setRepoStatus("loading");
    setRepoError("");
    try {
      const result = await fetchGithubImportRepositories({
        perPage: 50,
        ...(more && repoCursor ? { cursor: repoCursor } : {}),
      });
      if (!mounted.current) return;
      setRepos((previous) =>
        more
          ? [
              ...previous,
              ...result.items.filter(
                (item) => !previous.some((old) => old.htmlUrl === item.htmlUrl),
              ),
            ]
          : result.items,
      );
      setRepoCursor(result.cursor);
      setRepoStatus(result.items.length || more ? "ready" : "empty");
    } catch (e) {
      setRepoStatus("failed");
      setRepoError(
        e instanceof Error ? e.message : "Repositories could not load.",
      );
    }
  }
  const branchRepository =
    view === "settings" ? target.repository : setup.repository;
  useEffect(() => {
    const repository = normalizeGithubRepoUrl(branchRepository);
    if (
      !repository ||
      (creating && view !== "settings") ||
      !["setup", "settings"].includes(view)
    )
      return;
    const id = ++branchRequest.current;
    setBranchesLoading(true);
    setBranchError("");
    setRepositoryWritable(null);
    setBranches([]);
    void Promise.all([
      fetchGithubImportBranches({ repoUrl: repository }),
      sync.getGitHubSyncRepositoryDetails(projectId, repository),
    ])
      .then(([result, details]) => {
        if (id !== branchRequest.current) return;
        if (!details.success) throw new Error(details.error);
        setRepositoryWritable(details.data.writable);
        setBranches(result.branches);
        if (
          view === "setup" &&
          !setup.newBranch &&
          setup.branch &&
          !result.branches.includes(setup.branch) &&
          result.branches.length
        ) {
          setSetup((previous) => ({ ...previous, branch: "" }));
          setNotice(
            "The selected branch is unavailable. Choose an existing branch explicitly.",
          );
        }
      })
      .catch((e) => {
        if (id === branchRequest.current)
          setBranchError(
            e instanceof Error ? e.message : "Branches could not load.",
          );
      })
      .finally(() => {
        if (id === branchRequest.current) setBranchesLoading(false);
      });
    return () => {
      branchRequest.current++;
    };
  }, [branchRepository, creating, view, branchRefresh, projectId]);
  useEffect(() => {
    if (!creating || !state?.canAuthenticate || !canManage || owners !== null) return;
    let cancelled = false;
    void sync
      .getGitHubSyncOwners(projectId)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setOwners(result.data);
        setOwnersError("");
      })
      .catch((error) => {
        if (!cancelled)
          setOwnersError(
            error instanceof Error
              ? error.message
              : "Repository owners could not load.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [creating, state?.canAuthenticate, canManage, projectId, ownersRetry]);

  function switchMode(create: boolean) {
    setSetup((previous) => ({
      repository: previous.repository,
      branch: "main",
      direction: "push",
      mode: create ? "direct" : "pr",
      ...(create
        ? {
            newRepository: {
              owner: state?.account.username || "",
              name: projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"),
              private: true,
              organization: false,
            },
          }
        : {}),
    }));
    setBranches([]);
    setError("");
  }
  function openNewBranch() {
    setBranchName(
      creating ? setup.branch : setup.newBranch ? setup.branch : "",
    );
    setBaseBranch(
      setup.newBranch?.base ||
        branches.find((item) => item === setup.branch) ||
        branches[0] ||
        "",
    );
    setNewBranchError("");
    setModal("branch");
  }
  function useNewBranch() {
    const value = branchName.trim();
    if (!value || !isValidGithubBranchName(value)) {
      setNewBranchError(
        "Enter a valid Git branch name. Spaces, HEAD, dot segments and .lock names are not allowed.",
      );
      return;
    }
    if (!creating && (branches.includes(value) || value === baseBranch)) {
      setNewBranchError("This branch already exists. Choose another name.");
      return;
    }
    if (!creating && !branches.includes(baseBranch)) {
      setNewBranchError("Choose an existing starting branch.");
      return;
    }
    setSetup((previous) => ({
      ...previous,
      branch: value,
      mode: creating ? "direct" : previous.newBranch ? previous.mode : "direct",
      newBranch: creating
        ? undefined
        : {
            base: baseBranch,
            previousMode: previous.newBranch?.previousMode || previous.mode,
          },
    }));
    setModal(null);
  }
  async function inspect(path: string) {
    const id = ++inspectRequest.current;
    setInspectPath(path);
    setDiff(null);
    setDiffError("");
    setMergeError("");
    setDiffLoading(true);
    setTimeout(() => {
      inspectorRef.current?.focus();
      inspectorRef.current?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
    }, 0);
    try {
      const file = manifest?.files.find((item) => item.path === path);
      if (!file || !manifest) return;
      const result = await sync.getSingleFileDiff(projectId, {
        repository: manifest.repository,
        path,
        nodeId: file.nodeId,
        storageKey: file.storageKey,
        remoteSha: file.remoteSha,
        baseSha: file.baseSha,
        size: file.size,
      });
      if (id !== inspectRequest.current) return;
      if (!result.success) throw new Error(result.error);
      setDiff({ path, ...result.data });
      setMerged(
        syncChoice(choices, path)?.content ??
          (manifest.direction === "push"
            ? result.data.edge
            : result.data.github),
      );
    } catch (e) {
      if (id === inspectRequest.current)
        setDiffError(
          e instanceof Error ? e.message : "File comparison could not load.",
        );
    } finally {
      if (id === inspectRequest.current) setDiffLoading(false);
    }
  }
  function chooseSource(file: SyncFile) {
    setChoices((previous) => ({
      ...previous,
      [file.path]: {
        resolution: manifest?.direction === "push" ? "edge" : "github",
      },
    }));
  }
  function skipFile(path: string) {
    setChoices((previous) => {
      const next = { ...previous };
      delete next[path];
      return next;
    });
  }
  function combine() {
    if (!inspectFile || !diff || diff.binary) return;
    const scan = scanForSecrets(inspectFile.path, merged);
    if (
      scan.blocked ||
      merged.includes("\0") ||
      new TextEncoder().encode(merged).length > 1024 * 1024
    ) {
      setMergeError(
        scan.reason ||
          "Merged text must be plain text under 1 MB.",
      );
      return;
    }
    setChoices((previous) => ({
      ...previous,
      [inspectFile.path]: { resolution: "merge", content: merged },
    }));
    setMergeError("");
    setNotice("Combined text saved for this review.");
  }
  const metadataPaths = pageFiles.map((file) => file.path).join("\0");
  useEffect(() => {
    if (
      !manifest ||
      manifest.direction !== "pull" ||
      !manifest.headSha ||
      view !== "review"
    )
      return;
    const paths = metadataPaths
      .split("\0")
      .filter(
        (path) => path && !Object.prototype.hasOwnProperty.call(updates, path),
      );
    if (!paths.length) return;
    let cancelled = false;
    setMetadataError("");
    void sync
      .getGitHubSyncFileUpdates(
        projectId,
        manifest.repository,
        manifest.headSha,
        paths,
      )
      .then((result) => {
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setUpdates((previous) => ({
          ...previous,
          ...Object.fromEntries(
            result.data.map((item) => [item.path, item.updated]),
          ),
        }));
      })
      .catch((e) => {
        if (!cancelled)
          setMetadataError(
            e instanceof Error ? e.message : "File details could not load.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, manifest, metadataPaths, metadataRetry, view]);

  function branchControl() {
    const options = [
      ...new Set(
        [...(creating ? ["main"] : branches), setup.branch].filter(Boolean),
      ),
    ];
    return (
      <div className={styles.branchControl}>
        <div className={styles.branchLabel}>
          <label htmlFor="github-sync-branch">
            {creating
              ? "Initial branch"
              : setup.direction === "pull"
                ? "Source branch"
                : "Target branch"}
          </label>
          {setup.direction === "push" && (
            <button
              type="button"
              className={quietButton}
              disabled={
                busy ||
                Boolean(activeRun) ||
                (!creating &&
                  (!branches.length || repositoryWritable === false))
              }
              onClick={openNewBranch}
            >
              Create new branch
            </button>
          )}
        </div>
        <select
          className={cn(styles.input, styles.mono)}
          id="github-sync-branch"
          value={setup.branch}
          disabled={busy || branchesLoading}
          aria-describedby={branchError ? "github-branch-error" : undefined}
          onChange={(e) =>
            setSetup((previous) => ({
              ...previous,
              branch: e.target.value,
              newBranch:
                e.target.value === previous.branch
                  ? previous.newBranch
                  : undefined,
            }))
          }
        >
          <option value="" disabled>
            Choose a branch
          </option>
          {options.map((value) => (
            <option key={value} value={value}>
              {value}
              {setup.newBranch && value === setup.branch ? " · new branch" : ""}
            </option>
          ))}
        </select>
        {branchesLoading && (
          <div className="space-y-1.5 mt-2" role="status" aria-busy="true" aria-label="Loading branches">
            <p className={cn(styles.small, styles.muted)}>
              Loading branches…
            </p>
            <Skeleton className="h-9 w-full rounded-[6px]" />
          </div>
        )}
        {branchError && (
          <div id="github-branch-error">
            <ErrorNotice
              message={branchError}
              onRetry={() => setBranchRefresh((value) => value + 1)}
            />
          </div>
        )}
        {!creating && repositoryWritable === false && (
          <p className={cn(styles.small, styles.muted)}>
            Branch creation and pushing require GitHub write access. Pull can
            still use an existing source branch.
          </p>
        )}
        {setup.newBranch ? (
          <div className={styles.branchDraft}>
            <p>
              New branch from{" "}
              <span className={styles.mono} dir="auto">
                {setup.newBranch.base}
              </span>
              . Created only when you confirm publication.
            </p>
            <button
              type="button"
              className={quietButton}
              onClick={openNewBranch}
            >
              Edit
            </button>
            <button
              type="button"
              className={quietButton}
              onClick={() =>
                setSetup((previous) => ({
                  ...previous,
                  branch: previous.newBranch!.base,
                  newBranch: undefined,
                  mode: previous.newBranch?.previousMode || "pr",
                }))
              }
            >
              Use existing branch
            </button>
          </div>
        ) : creating ? (
          <p className={cn(styles.small, styles.muted)}>
            Created with the first published commit.
          </p>
        ) : null}
      </div>
    );
  }
  function setupView() {
    return (
      <>
        <div className={styles.setupHeader}>
          <SyncHeading
            title="Repository setup"
            description="Compare before transferring."
            onBack={back}
            headingRef={headingRef}
          />
          <div
            className={styles.segmented}
            role="group"
            aria-label="Repository setup mode"
          >
            <button
              type="button"
              className={quietButton}
              aria-label="Create a repository"
              aria-pressed={creating}
              disabled={busy}
              onClick={() => switchMode(true)}
            >
              Create new
            </button>
            <button
              type="button"
              className={quietButton}
              aria-label="Connect an existing repository"
              aria-pressed={!creating}
              disabled={busy}
              onClick={() => switchMode(false)}
            >
              Connect existing
            </button>
          </div>
        </div>
        {creating ? (
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="github-repository-owner">Owner</label>
              <select
                id="github-repository-owner"
                value={
                  setup.newRepository!.organization &&
                  !owners?.organizations.includes(setup.newRepository!.owner)
                    ? "__organization"
                    : setup.newRepository!.owner
                }
                onChange={(event) => {
                  const value = event.target.value;
                  setSetup((previous) => ({
                    ...previous,
                    newRepository: {
                      ...previous.newRepository!,
                      owner: value === "__organization" ? "" : value,
                      organization:
                        value === "__organization" ||
                        Boolean(owners?.organizations.includes(value)),
                    },
                  }));
                }}
              >
                <option value="" disabled>
                  Choose an owner
                </option>
                <option
                  value={
                    owners?.personal ||
                    state?.account.username ||
                    setup.newRepository!.owner
                  }
                >
                  {owners?.personal ||
                    state?.account.username ||
                    setup.newRepository!.owner}{" "}
                  · personal account
                </option>
                {owners?.organizations.map((value) => (
                  <option key={value} value={value}>
                    {value} · organization
                  </option>
                ))}
                <option value="__organization">Other organization…</option>
              </select>
              {setup.newRepository!.organization &&
                !owners?.organizations.includes(setup.newRepository!.owner) && (
                  <label className={styles.field}>
                    Organization name
                    <input
                      value={setup.newRepository!.owner}
                      onChange={(event) =>
                        setSetup((previous) => ({
                          ...previous,
                          newRepository: {
                            ...previous.newRepository!,
                            owner: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                )}
              {ownersError && (
                <ErrorNotice
                  message={ownersError}
                  onRetry={() => setOwnersRetry((value) => value + 1)}
                />
              )}
            </div>
            <label className={styles.field}>
              Repository name
              <input
                value={setup.newRepository!.name}
                maxLength={100}
                className={styles.mono}
                onChange={(e) =>
                  setSetup((previous) => ({
                    ...previous,
                    newRepository: {
                      ...previous.newRepository!,
                      name: e.target.value,
                    },
                  }))
                }
              />
            </label>
          </div>
        ) : (
          <div className={styles.section}>
            <label className={styles.field} htmlFor="github-repository-url">
              Repository URL
            </label>
            <div className={styles.row}>
              <input
                id="github-repository-url"
                className={cn(styles.input, styles.mono)}
                style={{ flex: 1 }}
                value={setup.repository}
                placeholder="https://github.com/owner/repository"
                onChange={(e) => {
                  setSetup((previous) => ({
                    ...previous,
                    repository: e.target.value,
                    branch: "",
                    newBranch: undefined,
                  }));
                  setRepos([]);
                  setRepoStatus("idle");
                }}
              />
              <button
                type="button"
                className={button}
                disabled={repoStatus === "loading"}
                onClick={() => void browse()}
              >
                Browse
              </button>
            </div>
            {repoStatus === "loading" && (
              <div className="space-y-2 mt-2" role="status" aria-busy="true" aria-label="Loading accessible repositories">
                <p className={cn(styles.small, styles.muted)}>
                  Loading accessible repositories…
                </p>
                <div className="space-y-1.5 rounded-[6px] border border-border bg-card p-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2.5">
                        <Skeleton className="size-4 rounded-[3px]" />
                        <Skeleton
                          className="h-4 rounded-[3px]"
                          style={{ width: `${120 + ((i * 35) % 80)}px` }}
                        />
                      </div>
                      <Skeleton className="h-3 w-16 rounded-[3px]" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {repoStatus === "failed" && (
              <ErrorNotice
                message={repoError}
                onRetry={() => void browse()}
                actionLabel="Retry lookup"
              />
            )}
            {repoStatus === "empty" && (
              <p className={cn(styles.info, styles.small)}>
                No accessible repositories found. Paste a repository URL or
                check organization access.
              </p>
            )}
            {repos.length > 0 && (
              <div className={cn(styles.row, styles.section)}>
                <select
                  className={styles.input}
                  aria-label="Accessible GitHub repositories"
                  style={{ flex: 1 }}
                  value={
                    repos.some((item) => item.htmlUrl === setup.repository)
                      ? setup.repository
                      : ""
                  }
                  onChange={(e) => {
                    const repo = repos.find(
                      (item) => item.htmlUrl === e.target.value,
                    );
                    setSetup((previous) => ({
                      ...previous,
                      repository: e.target.value,
                      branch: repo?.defaultBranch || "",
                      newBranch: undefined,
                    }));
                  }}
                >
                  <option value="" disabled>
                    Choose a repository
                  </option>
                  {repos.map((repo) => (
                    <option key={repo.htmlUrl} value={repo.htmlUrl}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
                {repoCursor && (
                  <button
                    type="button"
                    className={button}
                    onClick={() => void browse(true)}
                    disabled={repoStatus === "loading"}
                  >
                    Load more
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className={styles.fields}>
          {creating ? (
            <div>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={setup.newRepository!.private}
                  onChange={(e) =>
                    setSetup((previous) => ({
                      ...previous,
                      newRepository: {
                        ...previous.newRepository!,
                        private: e.target.checked,
                      },
                    }))
                  }
                  aria-describedby="github-visibility-help"
                />
                Private repository
              </label>
              <p
                id="github-visibility-help"
                className={cn(styles.small, styles.muted)}
              >
                {setup.newRepository!.private
                  ? "Visible only to people with repository access."
                  : "Public · published files can be viewed by anyone."}
              </p>
            </div>
          ) : (
            <div className={styles.transferGroup}>
              <fieldset className={styles.fieldset}>
                <legend>Transfer direction</legend>
                <div className={styles.row}>
                  {(["push", "pull"] as const).map((value) => (
                    <label key={value} className={styles.check}>
                      <input
                        type="radio"
                        name="sync-direction"
                        checked={setup.direction === value}
                        onChange={() =>
                          setSetup((previous) => ({
                            ...previous,
                            direction: value,
                            newBranch:
                              value === "pull" ? undefined : previous.newBranch,
                            branch:
                              value === "pull" && previous.newBranch
                                ? previous.newBranch.base
                                : previous.branch,
                          }))
                        }
                      />
                      {value === "push"
                        ? "Push to GitHub"
                        : "Pull into NetworkBase"}
                    </label>
                  ))}
                </div>
              </fieldset>
              {setup.direction === "push" && (
                <label className={styles.field}>
                  Publication method
                  <select
                    value={setup.mode}
                    onChange={(e) =>
                      setSetup((previous) => ({
                        ...previous,
                        mode: e.target.value as "pr" | "direct",
                      }))
                    }
                  >
                    <option value="pr">Open pull request</option>
                    <option value="direct">Commit directly to branch</option>
                  </select>
                  <small>Branch protections remain enforced.</small>
                </label>
              )}
            </div>
          )}
          {branchControl()}
        </div>
        <TransferRoute
          projectName={projectName}
          manifest={{
            ...setup,
            repository: creating
              ? `https://github.com/${setup.newRepository!.owner}/${setup.newRepository!.name}`
              : setup.repository,
          }}
        />
        {limits()}
        <div className={styles.footer}>
          <button
            type="button"
            className={primaryButton}
            disabled={
              busy ||
              Boolean(setupProblem(setup)) ||
              (!creating &&
                setup.direction === "push" &&
                repositoryWritable === false)
            }
            onClick={() => void compare()}
          >
            Compare files
          </button>
          <p>
            {!creating &&
            setup.direction === "push" &&
            repositoryWritable === false
              ? "GitHub write access is required for this direction."
              : setupProblem(setup) || "No files change during comparison."}
          </p>
        </div>
      </>
    );
  }
  function limits() {
    return (
      <details className={styles.limits}>
        <summary>Sync limits and excluded files</summary>
        <p>
          Up to {GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} selected
          file operations, 512 MB per transfer and 10 MB per file. Dependencies,
          generated files, potential credentials, private task-system files, LFS
          pointers, submodules and symlinks are excluded when unsupported.
        </p>
      </details>
    );
  }
  function overviewView() {
    const connection = state?.connection;
    return (
      <>
        <SyncHeading
          title={
            connection ? shortRepo(connection.repository) : "Repository setup"
          }
          description={
            connection
              ? "Choose a direction and compare files."
              : "Choose or create a repository."
          }
          headingRef={headingRef}
        />
        {connection ? (
          <>
            <div className={styles.repoRow}>
              <span className={styles.muted}>Linked repository</span>
              <a
                href={connection.repository}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shortRepo(connection.repository)}
              </a>
              <span className={cn(styles.row, styles.mono)}>
                <GitBranch aria-hidden="true" />
                {connection.branch}
              </span>
              <button
                type="button"
                className={button}
                disabled={busy || Boolean(unfinished)}
                onClick={() => {
                  setTarget(connection);
                  setView("settings");
                }}
              >
                Settings
              </button>
            </div>
            <div className={styles.path}>
              <span>1 Compare files</span>
              <span>2 Review selection</span>
              <span>3 Confirm transfer</span>
            </div>
            <div className={styles.next}>
              <fieldset
                className={styles.fieldset}
                disabled={Boolean(unfinished) || busy}
              >
                <legend>Transfer direction</legend>
                <div className={styles.row}>
                  {(["push", "pull"] as const).map((value) => (
                    <label key={value} className={styles.check}>
                      <input
                        type="radio"
                        name="overview-direction"
                        checked={setup.direction === value}
                        onChange={() =>
                          setSetup((previous) => ({
                            ...previous,
                            direction: value,
                          }))
                        }
                      />
                      {value === "push"
                        ? "Push to GitHub"
                        : "Pull into NetworkBase"}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                className={primaryButton}
                disabled={Boolean(unfinished) || busy}
                onClick={() =>
                  void compare({
                    ...setup,
                    repository: connection.repository,
                    branch: connection.branch,
                    newRepository: undefined,
                    newBranch: undefined,
                    mode: "pr",
                  })
                }
              >
                Compare files
              </button>
              <p>Choose files after comparison.</p>
            </div>
          </>
        ) : (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setView("setup")}
          >
            Set up repository
          </button>
        )}
        {unfinished && (
          <div className={styles.info}>
            <div className={cn(styles.row, styles.spread)}>
              <p>
                An unfinished operation needs review before another transfer.
              </p>
              <button
                type="button"
                className={button}
                onClick={() => openOperation(unfinished)}
              >
                Sync details
              </button>
            </div>
          </div>
        )}
        <div className={styles.activity}>
          <span className={styles.muted}>Last activity</span>
          <p>
            {state?.runs[0]
              ? `${state.runs[0].manifest.files.length} file operations · ${formatSyncDate(state.runs[0].createdAt)}`
              : "No uploads or downloads yet."}
          </p>
          {state?.runs[0] && (
            <SyncBadge
              tone={
                state.runs[0].status === "completed"
                  ? "good"
                  : needsRunAttention(state.runs[0])
                    ? "warn"
                    : undefined
              }
            >
              {state.runs[0].result.pullRequestUrl
                ? "PR awaiting merge"
                : state.runs[0].status.replace("_", " ")}
            </SyncBadge>
          )}
          <button
            type="button"
            className={button}
            onClick={() => setModal("history")}
          >
            History
          </button>
        </div>
      </>
    );
  }
  function fileRows(files: SyncFile[], readOnly = false) {
    return files.map((file) => {
      const updated =
        manifest?.direction === "pull" ? updates[file.path] : file.updated;
      return (
        <div key={file.path} className={styles.file} data-file-path={file.path}>
          <label className={styles.fileSelect}>
            <input
              type="checkbox"
              checked={Boolean(syncChoice(choices, file.path))}
              disabled={
                busy ||
                readOnly ||
                Boolean(file.blocked) ||
                file.change === "unchanged"
              }
              aria-label={`Select ${file.path}`}
              onChange={(e) =>
                e.target.checked
                  ? setChoices((previous) => ({ ...previous, [file.path]: {} }))
                  : skipFile(file.path)
              }
            />
          </label>
          <div className={styles.fileName}>
            <div dir="auto" className={styles.mono}>
              {file.path}
            </div>
            <div className={styles.fileMeta}>
              <ChangeBadge
                file={file}
                resolved={Boolean(syncChoice(choices, file.path)?.resolution)}
              />
              {file.renamedFrom && (
                <span>
                  from <span dir="auto">{file.renamedFrom}</span>
                </span>
              )}
            </div>
            {file.blocked && (
              <p className={cn(styles.small, styles.muted)}>{file.blocked}</p>
            )}
          </div>
          <div
            className={cn(styles.cell, styles.updated)}
            aria-label={`Last updated: ${formatRelativeTime(updated?.at)}`}
            title={formatRelativeTime(updated?.at)}
          >
            <span className={styles.cellLabel}>Last updated</span>
            {formatSyncDate(updated?.at)}
          </div>
          <div
            className={cn(styles.cell, styles.size)}
            aria-label={`Size: ${formatSyncBytes(file.size)}`}
          >
            <span className={styles.cellLabel}>Size</span>
            {formatSyncBytes(file.size)}
          </div>
          <div
            className={cn(styles.cell, styles.by)}
            aria-label={`Updated by: ${updated?.person?.name || "not recorded"}`}
          >
            <span className={styles.cellLabel}>Updated by</span>
            <FileActor person={updated?.person} />
          </div>
          <button
            type="button"
            className={cn(quietButton, styles.inspect)}
            onClick={() => void inspect(file.path)}
            aria-label={`Inspect ${file.path}`}
            aria-expanded={inspectPath === file.path}
          >
            Inspect
          </button>
        </div>
      );
    });
  }
  function inspector() {
    if (!inspectFile || !manifest) return null;
    const source = manifest.direction === "push" ? "NetworkBase" : "GitHub";
    const destination =
      manifest.direction === "push" ? "GitHub" : "NetworkBase";
    return (
      <aside className={styles.inspector} aria-labelledby="sync-inspect-title">
        <div className={styles.inspectTitle}>
          <h3
            id="sync-inspect-title"
            ref={inspectorRef}
            tabIndex={-1}
            dir="auto"
          >
            {inspectFile.path}
          </h3>
          <button
            type="button"
            className={quietButton}
            aria-label="Close details"
            onClick={() => {
              inspectRequest.current++;
              setInspectPath(null);
              setDiff(null);
              const row = Array.from(
                document.querySelectorAll<HTMLElement>("[data-file-path]"),
              ).find(
                (element) => element.dataset.filePath === inspectFile.path,
              );
              row?.querySelector<HTMLButtonElement>("button")?.focus();
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <FileMetadata
          file={inspectFile}
          update={
            manifest.direction === "pull"
              ? updates[inspectFile.path]
              : inspectFile.updated
          }
        />
        <p className={cn(styles.small, styles.muted)}>
          {source} → {destination}. No file changes until confirmation.
        </p>
        {inspectFile.blocked ? (
          <p className={styles.warning}>{inspectFile.blocked}</p>
        ) : null}
        {diffLoading ? (
          <div role="status" aria-busy="true" aria-label="Loading file comparison" className={cn(styles.section, "space-y-3")}>
            <p className={styles.info}>Loading file comparison…</p>
            <div className="space-y-2">
              <Skeleton className="h-4 w-44 rounded-[3px]" />
              <div className="rounded-[6px] border border-border bg-card p-4 space-y-2">
                <Skeleton className="h-3.5 w-full rounded-[3px]" />
                <Skeleton className="h-3.5 w-4/5 rounded-[3px]" />
                <Skeleton className="h-3.5 w-3/4 rounded-[3px]" />
                <Skeleton className="h-3.5 w-5/6 rounded-[3px]" />
              </div>
            </div>
          </div>
        ) : diffError ? (
          <ErrorNotice
            message={diffError}
            onRetry={() => void inspect(inspectFile.path)}
          />
        ) : diff?.binary ? (
          <p className={styles.info}>
            Binary files and files larger than 1 MB cannot be compared as text.
            Source and destination remain explicit; review the original file
            before selecting it.
          </p>
        ) : (
          diff && (
            <>
              <div className={styles.section}>
                <pre className={styles.code}>
                  {syncChoice(choices, inspectFile.path)?.resolution === "merge"
                    ? syncChoice(choices, inspectFile.path)?.content
                    : manifest.direction === "push"
                      ? diff.edge
                      : diff.github}
                </pre>
                <button
                  type="button"
                  className={button}
                  onClick={() => setModal("diff")}
                >
                  View full comparison
                </button>
              </div>
            </>
          )
        )}
        {inspectFile.change === "conflict" && !inspectFile.blocked && (
          <div className={styles.rule}>
            <p className={styles.small}>
              Both copies changed. Choose what should reach {destination}.
            </p>
            <div className={cn(styles.row, styles.section)}>
              <button
                type="button"
                className={button}
                onClick={() => chooseSource(inspectFile)}
              >
                Use {source} version
              </button>
              <button
                type="button"
                className={button}
                onClick={() => skipFile(inspectFile.path)}
              >
                Skip · keep {destination}
              </button>
            </div>
            {diff && !diff.binary && !diffError && (
              <>
                <label className={styles.field}>
                  Merge text
                  <textarea
                    className={styles.mono}
                    value={merged}
                    onChange={(e) => {
                      setMerged(e.target.value);
                      setMergeError("");
                    }}
                  />
                </label>
                {mergeError && <ErrorNotice message={mergeError} />}
                <div className={styles.footer}>
                  <button type="button" className={button} onClick={combine}>
                    Save combined text
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {inspectFile.change !== "conflict" &&
          !inspectFile.blocked &&
          inspectFile.change !== "unchanged" && (
            <div className={styles.footer}>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  syncChoice(choices, inspectFile.path)
                    ? skipFile(inspectFile.path)
                    : setChoices((previous) => ({
                        ...previous,
                        [inspectFile.path]: {},
                      }))
                }
              >
                {syncChoice(choices, inspectFile.path)
                  ? "Remove from selection"
                  : "Select change"}
              </button>
            </div>
          )}
      </aside>
    );
  }
  function reviewView() {
    if (!manifest) return null;
    const noChanges = !pendingChanges.length;
    return (
      <>
        <SyncHeading
          title={
            manifest.direction === "push"
              ? "Outgoing changes"
              : "Incoming changes"
          }
          description={
            manifest.direction === "push"
              ? "Choose the files to publish to GitHub."
              : manifest.local
                ? `Choose the files to save on the NetworkBase branch ${manifest.local.name}; main isn’t changed.`
                : "Choose the files to import into workspace files."
          }
          onBack={back}
          headingRef={headingRef}
        />
        <TransferRoute manifest={manifest} projectName={projectName} />
        {noChanges ? (
          <div className={styles.empty}>
            <h3>No pending changes</h3>
            <p>Workspace files match the reviewed GitHub branch.</p>
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div
                className={styles.filters}
                role="group"
                aria-label="Filter changes"
              >
                {(["all", "selected", "conflicts", "excluded"] as const).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filter === value}
                      onClick={() => {
                        setFilter(value);
                        setPage(0);
                      }}
                    >
                      {value === "all"
                        ? "All changes"
                        : value === "selected"
                          ? `Selected ${selected.length}`
                          : value === "conflicts"
                            ? "Conflicts"
                            : "Excluded"}
                    </button>
                  ),
                )}
              </div>
              <label className={styles.search}>
                <Search aria-hidden="true" />
                <input
                  className={styles.input}
                  type="search"
                  value={query}
                  placeholder="Filter files by path…"
                  aria-label="Filter files by path"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <button
                type="button"
                className={quietButton}
                disabled={busy || !eligible.length}
                onClick={() =>
                  setChoices((previous) =>
                    selectEligibleChanges(
                      eligible.slice(0, GITHUB_SYNC_LIMITS.operationFiles),
                      previous,
                    ),
                  )
                }
              >
                Select eligible ({eligible.length})
              </button>
              <button
                type="button"
                className={quietButton}
                disabled={busy || !selected.length}
                onClick={() => setChoices({})}
              >
                Clear
              </button>
            </div>
            {selected.length > visibleSelected && (
              <p role="status" className={cn(styles.small, styles.muted)}>
                {selected.length - visibleSelected} selected files are hidden by
                this filter. They remain in your selection.
              </p>
            )}
            {metadataError && (
              <ErrorNotice
                message={`File details could not load. Names and times are not guessed. ${metadataError}`}
                onRetry={() => setMetadataRetry((value) => value + 1)}
              />
            )}
            <div className={styles.reviewLayout}>
              <div>
                <div className={styles.table}>
                  <div className={styles.tableHead}>
                    <span>{visible.length.toLocaleString()} changes shown</span>
                    <span className={styles.provenance}>
                      Updated by:{" "}
                      {manifest.direction === "push"
                        ? "latest workspace-file version"
                        : "GitHub author of the source change"}
                    </span>
                    <span>{selected.length.toLocaleString()} selected</span>
                  </div>
                  <div className={styles.columns} aria-hidden="true">
                    <span>Name</span>
                    <span>Last updated</span>
                    <span>Size</span>
                    <span>Updated by</span>
                    <span />
                  </div>
                  {pageFiles.length ? (
                    fileRows(pageFiles)
                  ) : (
                    <div className={styles.empty}>
                      <p>No changes match this filter.</p>
                      <button
                        type="button"
                        className={button}
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                          setPage(0);
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
                {visible.length > PAGE_SIZE && (
                  <div className={styles.pagination}>
                    <span>
                      {(currentPage * PAGE_SIZE + 1).toLocaleString()}–
                      {Math.min(
                        (currentPage + 1) * PAGE_SIZE,
                        visible.length,
                      ).toLocaleString()}{" "}
                      of {visible.length.toLocaleString()}
                    </span>
                    <div className={styles.row}>
                      <button
                        type="button"
                        className={button}
                        disabled={currentPage === 0}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className={button}
                        disabled={currentPage === lastPage}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {inspector()}
            </div>
          </>
        )}
        {clean.length > 0 && (
          <details
            className={styles.limits}
            open={cleanOpen}
            onToggle={(e) => setCleanOpen(e.currentTarget.open)}
          >
            <summary>Unchanged files · {clean.length.toLocaleString()}</summary>
            {cleanOpen && (
              <>
                <ul className={styles.plainList}>
                  {clean
                    .slice(cleanPage * PAGE_SIZE, (cleanPage + 1) * PAGE_SIZE)
                    .map((file) => (
                      <li key={file.path} className={styles.mono} dir="auto">
                        {file.path}
                      </li>
                    ))}
                </ul>
                <div className={styles.pagination}>
                  <span>
                    {(cleanPage * PAGE_SIZE + 1).toLocaleString()}–
                    {Math.min(
                      (cleanPage + 1) * PAGE_SIZE,
                      clean.length,
                    ).toLocaleString()}{" "}
                    of {clean.length.toLocaleString()}
                  </span>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={button}
                      disabled={!cleanPage}
                      onClick={() =>
                        setCleanPage((previous) => Math.max(0, previous - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={(cleanPage + 1) * PAGE_SIZE >= clean.length}
                      onClick={() => setCleanPage((previous) => previous + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </details>
        )}
        {!noChanges && (
          <>
            <div className={styles.commit}>
              <label className={styles.field}>
                {manifest.direction === "push"
                  ? "Commit message"
                  : "Import note"}
                <textarea
                  value={message}
                  maxLength={2000}
                  rows={message.includes("\n") ? 4 : 1}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              {manifest.direction === "push" && (
                <label className={styles.field}>
                  Publish via
                  <select
                    value={setup.mode}
                    disabled={!manifest.headSha}
                    onChange={(e) => {
                      const mode = e.target.value as "pr" | "direct";
                      setSetup((previous) => ({ ...previous, mode }));
                      setManifest((previous) =>
                        previous ? { ...previous, mode } : null,
                      );
                    }}
                  >
                    <option value="pr">Pull request</option>
                    <option value="direct">Direct commit</option>
                  </select>
                </label>
              )}
              <button
                type="button"
                className={quietButton}
                onClick={() => {
                  setReturnView("review");
                  setView("attribution");
                }}
              >
                Attribution
              </button>
            </div>
            <div className={styles.selectionFooter}>
              <div>
                <strong>
                  {selected.length} selected ·{" "}
                  {formatSyncBytes(
                    selected.reduce((sum, file) => sum + file.size, 0),
                  )}
                </strong>
                <p id="github-selection-help">
                  {selectedProblem ||
                    "Review your selection before confirming."}
                </p>
              </div>
              <button
                type="button"
                className={primaryButton}
                disabled={busy || Boolean(selectedProblem)}
                aria-describedby="github-selection-help"
                onClick={() => void prepare()}
              >
                {busy ? "Preparing selection…" : "Review selection"}
              </button>
            </div>
          </>
        )}
      </>
    );
  }
  function confirmationView() {
    if (!run) return null;
    const value = run.manifest;
    const push = value.direction === "push";
    return (
      <>
        <SyncHeading
          title={push ? "Confirm publication" : "Confirm import"}
          description="Only the reviewed files below will change."
          onBack={() => {
            if (manifest) {
              setView("review");
            } else {
              setView("overview");
            }
          }}
          headingRef={headingRef}
        />
        <TransferRoute manifest={value} projectName={projectName} />
        <dl className={styles.confirmation}>
          <div>
            <dt>Selection</dt>
            <dd>
              {value.files.length} files ·{" "}
              {formatSyncBytes(
                value.files.reduce((sum, file) => sum + file.size, 0),
              )}
            </dd>
          </div>
          <div>
            <dt>{push ? "Commit message" : "Import note"}</dt>
            <dd>{value.message}</dd>
          </div>
          <div>
            <dt>{push ? "Publish via" : "Source version"}</dt>
            <dd>
              {push
                ? value.mode === "pr"
                  ? `Pull request into ${value.newBranch?.base || value.branch}`
                  : `Direct commit to ${value.branch}`
                : value.headSha?.slice(0, 7) || "—"}
            </dd>
          </div>
          <div>
            <dt>Visibility</dt>
            <dd>
              {value.newRepository
                ? value.newRepository.private
                  ? "Private repository"
                  : "Public repository"
                : value.visibility || "Repository access rules"}
            </dd>
          </div>
        </dl>
        {value.newRepository && !value.newRepository.private && (
          <p className={styles.warning}>
            Public repository: these files will be visible to anyone.
          </p>
        )}
        {value.newRepository && (
          <p className={styles.info}>
            Create {shortRepo(value.repository)}, then publish the reviewed
            files.
          </p>
        )}
        {value.newBranch && (
          <p className={styles.info}>
            Create branch{" "}
            <span className={styles.mono} dir="auto">
              {value.branch}
            </span>{" "}
            from{" "}
            <span className={styles.mono} dir="auto">
              {value.newBranch.base}
            </span>{" "}
            only when you confirm.
          </p>
        )}
        {value.files.some((file) => file.change === "delete") && (
          <p className={styles.warning}>
            {value.files.filter((file) => file.change === "delete").length}{" "}
            selected deletions.{" "}
            {push
              ? "Deleted paths will be removed from the published branch."
              : "Deleted workspace files move to Trash."}
          </p>
        )}
        {push && value.mode === "pr" && (
          <p className={cn(styles.small, styles.muted)}>
            The pull request must be reviewed and merged separately. This action
            does not merge it.
          </p>
        )}
        <ul className={styles.plainList}>
          {value.files.map((file) => (
            <li key={file.path}>
              <div className={styles.row}>
                <span dir="auto" className={styles.mono}>
                  {file.path}
                </span>
                <ChangeBadge file={file} resolved={Boolean(file.resolution)} />
              </div>
              {file.renamedFrom && (
                <p className={cn(styles.small, styles.muted)}>
                  Renamed from {file.renamedFrom}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className={styles.selectionFooter}>
          <div>
            <p>
              Prepared {formatSyncDate(run.createdAt)}. Changes after review
              require comparison again.
            </p>
          </div>
          <button
            type="button"
            className={primaryButton}
            disabled={busy || Boolean(activeRun)}
            onClick={() => void execute(run)}
          >
            {push ? (
              <ArrowUpToLine aria-hidden="true" />
            ) : (
              <ArrowDownToLine aria-hidden="true" />
            )}
            {push
              ? value.newBranch
                ? "Create branch and publish"
                : value.newRepository
                  ? "Create repository and publish"
                  : value.mode === "pr"
                    ? "Open pull request"
                    : "Push reviewed files"
              : "Import reviewed files"}
          </button>
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className={quietButton}
            disabled={busy}
            onClick={() => setModal("discard")}
          >
            Discard review
          </button>
        </div>
      </>
    );
  }
  function runView() {
    if (!run) return null;
    const progress = runProgress(run);
    return (
      <>
        <SyncHeading
          title={
            run.status === "queued"
              ? "Synchronization queued"
              : run.direction === "push"
                ? "Publishing to GitHub"
                : "Importing into workspace files"
          }
          description="Progress comes from the sync."
          onBack={() => setView("overview")}
          headingRef={headingRef}
        />
        <TransferRoute manifest={run.manifest} projectName={projectName} />
        <div className={styles.statusLine}>
          <span className={styles.mono}>Operation {run.id}</span>
          <span>Last checked {formatSyncDate(checkedAt)}</span>
        </div>
        {pollError && (
          <ErrorNotice
            message={`Connection interrupted. Showing the last recorded state. ${pollError}`}
            onRetry={() =>
              void perform(async () => {
                await load();
              })
            }
          />
        )}
        <ol className={styles.steps}>
          {progress.labels.map((label, index) => (
            <li
              key={label}
              aria-current={index === progress.index ? "step" : undefined}
            >
              <span className={styles.stepDot}>
                {index < progress.index ? (
                  <Check aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <div>
                <strong>{label}</strong>
                {index === progress.index && (
                  <>
                    <small role="status">{run.stage}</small>
                    {run.direction === "pull" && index === 2 && (
                      <>
                        <progress
                          className={styles.progress}
                          aria-label="Recorded file operations applied"
                          value={progress.applied}
                          max={progress.total || 1}
                        />
                        <small>
                          {progress.applied} of {progress.total} file operations
                          recorded. Verification is still pending.
                        </small>
                      </>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className={cn(styles.small, styles.muted)}>
          You can leave this page and reopen the operation.{" "}
          {run.status === "queued"
            ? "Cancellation is available until execution starts."
            : "An executing transfer cannot be rolled back from this page."}
        </p>
        {run.status === "queued" && (
          <div className={styles.footer}>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => setModal("cancel")}
            >
              Cancel sync
            </button>
            <button
              type="button"
              className={quietButton}
              disabled={busy}
              onClick={() => void execute(run)}
            >
              Resume sync
            </button>
          </div>
        )}
      </>
    );
  }
  function resultView() {
    if (!run) return null;
    const pr = Boolean(run.result.pullRequestUrl);
    return (
      <>
        <SyncHeading
          title={
            pr
              ? "Pull request opened"
              : run.direction === "push"
                ? "Publication completed"
                : "Import completed"
          }
          description={
            pr
              ? "Review and merge the pull request in GitHub."
              : "The sync finished."
          }
          onBack={() => {
            resetReview();
            setView("overview");
          }}
          headingRef={headingRef}
        />
        <TransferRoute manifest={run.manifest} projectName={projectName} />
        <ul className={styles.plainList}>
          <li>
            {run.manifest.files.length} reviewed file operations completed.
          </li>
          {run.result.commitSha && (
            <li>
              Commit{" "}
              <span className={styles.mono}>
                {run.result.commitSha.slice(0, 7)}
              </span>
            </li>
          )}
          {run.result.branch && (
            <li>
              Published branch{" "}
              <span className={styles.mono}>{run.result.branch}</span>
            </li>
          )}
          {pr && (
            <li>
              Not merged into{" "}
              <span className={styles.mono}>
                {run.manifest.newBranch?.base || run.manifest.branch}
              </span>
              . Workspace files and the target branch may still differ until the
              PR is merged.
            </li>
          )}
          {run.direction === "pull" &&
            run.manifest.files.some((file) => file.change === "delete") && (
              <li>
                {
                  run.manifest.files.filter((file) => file.change === "delete")
                    .length
                }{" "}
                selected deletions moved to Trash.
              </li>
            )}
        </ul>
        {run.result.pullRequestUrl && (
          <a
            className={primaryButton}
            href={run.result.pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View pull request
          </a>
        )}
        <div className={styles.footer}>
          <button
            type="button"
            className={quietButton}
            onClick={() => setModal("history")}
          >
            Operation details
          </button>
        </div>
      </>
    );
  }
  function recoveryView() {
    if (!run) return null;
    const partial = run.result.applied?.length || 0;
    return (
      <>
        <SyncHeading
          title="Synchronization needs attention"
          description="Review what was recorded before continuing."
          onBack={() => setView("overview")}
          headingRef={headingRef}
        />
        <TransferRoute manifest={run.manifest} projectName={projectName} />
        <ErrorNotice
          message={run.error || run.stage || "The operation did not complete."}
        />
        {run.result.pushed && (
          <p className={styles.warning}>
            The commit was already published to GitHub. Retry continues the
            retained follow-up; it must not publish a duplicate commit.
          </p>
        )}
        {run.result.repositoryCreated && !run.result.pushed && (
          <p className={styles.warning}>
            The repository was created. Retry uses that repository and the same
            reviewed operation.
          </p>
        )}
        {partial > 0 && (
          <p className={styles.warning}>
            {partial} of {run.manifest.files.length} imports were recorded.
            Those workspace changes remain. A safe retry skips recorded files; a
            changed baseline requires a fresh comparison.
          </p>
        )}
        {run.result.commitSha && (
          <p className={cn(styles.small, styles.mono)}>
            Recorded commit {run.result.commitSha}
          </p>
        )}
        <div className={styles.footer}>
          {canRetryRun(run) ? (
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={() => void execute(run)}
            >
              {run.result.pushed
                ? "Try again"
                : workflowRequired
                  ? "Retry publication"
                  : "Retry operation"}
            </button>
          ) : (
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={() => {
                const value = run.manifest;
                resetReview();
                setSetup({
                  repository: value.repository,
                  branch: value.branch,
                  direction: value.direction,
                  mode: value.mode,
                  ...(value.newRepository && !run.result.repositoryCreated
                    ? { newRepository: value.newRepository }
                    : {}),
                  ...(value.newBranch ? { newBranch: value.newBranch } : {}),
                });
                setView("setup");
                setRun(null);
              }}
            >
              Compare again
            </button>
          )}
          {canRetryRun(run) && !run.result.pushed && (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                const value = run.manifest;
                resetReview();
                setSetup({
                  repository: value.repository,
                  branch: value.branch,
                  direction: value.direction,
                  mode: /protect|pull request/i.test(run.error || "")
                    ? "pr"
                    : value.mode,
                  ...(value.newRepository && !run.result.repositoryCreated
                    ? { newRepository: value.newRepository }
                    : {}),
                  ...(value.newBranch ? { newBranch: value.newBranch } : {}),
                });
                setRun(null);
                setView("setup");
              }}
            >
              Change setup
            </button>
          )}
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => setModal("history")}
          >
            Operation details
          </button>
        </div>
      </>
    );
  }
  function settingsView() {
    const valid = Boolean(
      normalizeGithubRepoUrl(target.repository) &&
      target.branch.trim() &&
      isValidGithubBranchName(target.branch),
    );
    return (
      <>
        <SyncHeading
          title="Repository settings"
          description="Changes stay in this form until confirmed."
          onBack={() => setView("overview")}
          headingRef={headingRef}
        />
        <div className={styles.target}>
          <label className={styles.field}>
            Repository URL
            <input
              className={styles.mono}
              value={target.repository}
              onChange={(e) =>
                setTarget((previous) => ({
                  ...previous,
                  repository: e.target.value,
                  branch: "",
                }))
              }
            />
          </label>
          <label className={styles.field}>
            Branch
            <select
              value={target.branch}
              onChange={(e) =>
                setTarget((previous) => ({
                  ...previous,
                  branch: e.target.value,
                }))
              }
            >
              <option value="" disabled>
                Choose a branch
              </option>
              {[...new Set([...branches, target.branch].filter(Boolean))].map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {branchesLoading && (
          <div className="space-y-1.5 mt-2" role="status" aria-busy="true" aria-label="Loading branches">
            <p className={styles.info}>Loading branches…</p>
            <Skeleton className="h-9 w-full rounded-[6px]" />
          </div>
        )}
        {branchError && (
          <ErrorNotice
            message={branchError}
            onRetry={() => setBranchRefresh((value) => value + 1)}
          />
        )}
        <div className={styles.footer}>
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !valid || Boolean(unfinished)}
            onClick={() => setModal("target")}
          >
            Review destination
          </button>
          <p>
            Existing files remain in both locations. Future transfers use the
            confirmed target.
          </p>
        </div>
        <div className={styles.rule}>
          <button
            type="button"
            className={button}
            onClick={() => {
              setReturnView("settings");
              setView("attribution");
            }}
          >
            Commit attribution and team access
          </button>
        </div>
        <div className={styles.rule}>
          <button
            type="button"
            className={button}
            disabled={busy || Boolean(activeRun)}
            onClick={() => setModal("disconnect")}
          >
            Disconnect repository
          </button>
          <p className={cn(styles.small, styles.muted)}>
            Disconnecting stops future synchronization. It does not delete
            workspace files or the GitHub repository.
          </p>
        </div>
      </>
    );
  }
  function attributionView() {
    return (
      <>
        <SyncHeading
          title="Commit author"
          description="Credit uses verified identities and actual contributions."
          onBack={() => setView(returnView)}
          headingRef={headingRef}
        />
        <ContributorIdentitySection
          identity={state?.identity}
          onApproved={async (email) => {
            const result = await sync.approveGitHubCommitIdentity(email);
            if (!result.success) throw new Error(result.error);
            if (canManage) await load();
          }}
        />
        <div className={styles.section}>
          <h3>Team GitHub access</h3>
          <p className={cn(styles.small, styles.muted)}>
            Each member links their own GitHub account in Settings →
            Integrations. Unlinked members do not block a transfer.
          </p>
          {state?.teamMembers.map((member) => (
            <div key={member.userId} className={styles.teamRow}>
              <FileActor
                person={{ name: member.name, avatarUrl: member.avatarUrl }}
              />
              <span className={cn(styles.small, styles.muted)}>
                {member.githubLogin
                  ? `@${member.githubLogin} · linked`
                  : "Not linked"}
              </span>
            </div>
          ))}
        </div>
      </>
    );
  }
  function connectView() {
    return (
      <>
        <SyncHeading
          title={
            state?.account.linked
              ? "Restore repository access"
              : "Connect GitHub"
          }
          description="Link your account and verify repository access before transferring files."
          onBack={state?.connection ? () => setView("overview") : undefined}
          headingRef={headingRef}
        />
        <p className={cn(styles.small, styles.muted)}>
          {state?.account.linked
            ? "A linked identity can still need renewed repository permission or organization approval. Your setup and selection stay here."
            : "Choose or create a repository after connecting. No files are published during sign-in."}
        </p>
        {authWaiting ? (
          <div className={styles.info} role="status">
            <div className={cn(styles.row, styles.spread)}>
              <span>Continue in GitHub. Return here after sign-in.</span>
              <button
                type="button"
                className={button}
                onClick={() => {
                  authAttempt.current++;
                  setAuthWaiting(false);
                  setNotice(
                    "Sign-in was canceled on this page. Your setup is retained.",
                  );
                }}
              >
                Cancel sign-in
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.footer}>
            <button
              type="button"
              className={primaryButton}
              onClick={() => void authorize()}
            >
              <Github aria-hidden="true" />
              {state?.account.linked ? "Renew GitHub access" : "Connect GitHub"}
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const current = await load();
                  if (current?.canAuthenticate) {
                    setView(current.connection ? "overview" : "setup");
                    setNotice(
                      "Repository access checked. Continue reviewing before confirming.",
                    );
                  } else {
                    setNotice(
                      "Repository access is still unavailable. Check GitHub authorization and organization approval.",
                    );
                  }
                })
              }
            >
              Check repository access
            </button>
          </div>
        )}
        <details className={styles.limits}>
          <summary>Permissions and data access</summary>
          <p>
            Account sign-in and repository permission are separate. Organization
            repositories may require approval. Nothing is published until you
            review and confirm the transfer. You can revoke access in GitHub.
          </p>
        </details>
      </>
    );
  }
  function modalContent() {
    switch (modal) {
      case "branch":
        return (
          <>
            <DialogTitle>
              {creating ? "Name initial branch" : "Create new branch"}
            </DialogTitle>
            <DialogDescription>
              {creating
                ? "This branch is created with the first published commit."
                : "Choose a name and starting branch. No branch is created until you confirm publication."}
            </DialogDescription>
            <label className={styles.field}>
              Branch name
              <input
                className={styles.mono}
                value={branchName}
                maxLength={255}
                aria-invalid={Boolean(newBranchError)}
                aria-describedby={
                  newBranchError ? "sync-new-branch-error" : undefined
                }
                onChange={(e) => {
                  setBranchName(e.target.value);
                  setNewBranchError("");
                }}
              />
            </label>
            {!creating && (
              <label className={styles.field}>
                Start from
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                >
                  <option value="" disabled>
                    Choose existing branch
                  </option>
                  {branches.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {newBranchError && (
              <div id="sync-new-branch-error">
                <ErrorNotice message={newBranchError} />
              </div>
            )}
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={button}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={primaryButton}
                onClick={useNewBranch}
              >
                {creating ? "Use initial branch" : "Use new branch"}
              </button>
            </div>
          </>
        );
      case "discard":
        return (
          <>
            <DialogTitle>Discard this review?</DialogTitle>
            <DialogDescription>
              Your selection and prepared review will be removed. No transfer
              has started.
            </DialogDescription>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Keep reviewing
              </button>
              <button
                type="button"
                className={primaryButton}
                disabled={busy}
                onClick={() =>
                  run?.status === "review"
                    ? void cancelOperation(run)
                    : (setModal(null), resetReview(), setView("overview"))
                }
              >
                Discard review
              </button>
            </div>
          </>
        );
      case "cancel":
        return (
          <>
            <DialogTitle>Cancel sync?</DialogTitle>
            <DialogDescription>
              Cancellation is possible only before execution starts. If
              execution has started, its progress will remain available.
            </DialogDescription>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Keep operation
              </button>
              <button
                type="button"
                className={primaryButton}
                disabled={busy || !run}
                onClick={() => run && void cancelOperation(run)}
              >
                Cancel operation
              </button>
            </div>
          </>
        );
      case "disconnect":
        return (
          <>
            <DialogTitle>Disconnect repository?</DialogTitle>
            <DialogDescription>
              Workspace files and the GitHub repository are kept. Unsubmitted
              reviews will be canceled; running operations must finish first.
            </DialogDescription>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Keep connection
              </button>
              <button
                type="button"
                className={primaryButton}
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result =
                      await sync.disconnectGitHubSyncRepository(projectId);
                    if (!result.success) throw new Error(result.error);
                    setModal(null);
                    resetReview();
                    setRun(null);
                    switchMode(true);
                    setView("setup");
                    await load();
                  })
                }
              >
                Disconnect
              </button>
            </div>
          </>
        );
      case "target":
        return (
          <>
            <DialogTitle>Change sync destination?</DialogTitle>
            <DialogDescription>
              This changes the destination for future transfers. No files are
              transferred by changing the connection.
            </DialogDescription>
            <p className={styles.mono} dir="auto">
              {target.repository} · {target.branch}
            </p>
            <div className={styles.dialogFooter}>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Keep current target
              </button>
              <button
                type="button"
                className={primaryButton}
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await sync.connectGitHubSyncRepository(
                      projectId,
                      target.repository,
                      target.branch,
                    );
                    if (!result.success) throw new Error(result.error);
                    setSetup((previous) => ({
                      ...previous,
                      repository: normalizeGithubRepoUrl(target.repository)!,
                      branch: target.branch,
                      newBranch: undefined,
                      newRepository: undefined,
                    }));
                    setModal(null);
                    setView("overview");
                    await load();
                  })
                }
              >
                Confirm destination
              </button>
            </div>
          </>
        );
      case "history":
        return (
          <>
            <DialogTitle>Synchronization history</DialogTitle>
            <DialogDescription>
              Syncs and their results for this workspace.
            </DialogDescription>
            {!state?.runs.length ? (
              <p>No syncs yet.</p>
            ) : (
              <ul className={styles.plainList}>
                {state.runs.map((item) => (
                  <li key={item.id}>
                    <div className={cn(styles.row, styles.spread)}>
                      <span>
                        {item.direction === "push" ? "Outgoing" : "Incoming"} ·{" "}
                        {item.manifest.files.length} files
                      </span>
                      <SyncBadge
                        tone={
                          item.status === "completed"
                            ? "good"
                            : item.status === "failed" ||
                                item.status === "needs_review"
                              ? "warn"
                              : undefined
                        }
                      >
                        {item.result.pullRequestUrl
                          ? "PR awaiting merge"
                          : item.status.replace("_", " ")}
                      </SyncBadge>
                    </div>
                    <p className={cn(styles.small, styles.muted)}>
                      {formatSyncDate(item.createdAt)} · {item.stage}
                    </p>
                    <p className={cn(styles.small, styles.mono)}>
                      Operation {item.id}
                    </p>
                    {item.result.commitSha && (
                      <p className={cn(styles.small, styles.mono)}>
                        Commit {item.result.commitSha.slice(0, 7)}
                      </p>
                    )}
                    {item.result.applied?.length ? (
                      <p className={styles.small}>
                        {item.result.applied.length} file operations recorded
                      </p>
                    ) : null}
                    {item.error && <p className={styles.small}>{item.error}</p>}
                    <button
                      type="button"
                      className={quietButton}
                      onClick={() => {
                        setModal(null);
                        openOperation(item);
                      }}
                    >
                      Open details
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      case "diff":
        return (
          <>
            <DialogTitle>File comparison</DialogTitle>
            <DialogDescription>
              {inspectPath} · NetworkBase and the reviewed GitHub version
            </DialogDescription>
            {diff ? (
              <>
                <div className={styles.diffGrid}>
                  <section>
                    <h3>NetworkBase workspace file</h3>
                    <DiffContentPane content={diff.edge} />
                  </section>
                  <section>
                    <h3>
                      GitHub · {manifest?.newBranch?.base || manifest?.branch}
                    </h3>
                    <DiffContentPane content={diff.github} />
                  </section>
                </div>
                <details className={styles.limits}>
                  <summary>Common baseline</summary>
                  <DiffContentPane
                    content={diff.base}
                    emptyLabel="(No recorded baseline content)"
                  />
                </details>
              </>
            ) : !diffError ? (
              <div
                role="status"
                aria-busy="true"
                aria-label="Loading diff"
                className={cn(styles.diffGrid, styles.section)}
              >
                <section className="space-y-2">
                  <Skeleton className="h-4 w-32 rounded-[3px]" />
                  <div className="rounded-[6px] border border-border bg-card p-4 space-y-2">
                    <Skeleton className="h-3.5 w-full rounded-[3px]" />
                    <Skeleton className="h-3.5 w-4/5 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-3/4 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-2/3 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-5/6 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-1/2 rounded-[3px]" />
                  </div>
                </section>
                <section className="space-y-2">
                  <Skeleton className="h-4 w-32 rounded-[3px]" />
                  <div className="rounded-[6px] border border-border bg-card p-4 space-y-2">
                    <Skeleton className="h-3.5 w-full rounded-[3px]" />
                    <Skeleton className="h-3.5 w-4/5 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-3/4 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-2/3 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-5/6 rounded-[3px]" />
                    <Skeleton className="h-3.5 w-1/2 rounded-[3px]" />
                  </div>
                </section>
              </div>
            ) : null}
          </>
        );
      default:
        return null;
    }
  }
  let content;
  if (!canManage)
    content = (
      <>
        <SyncHeading
          title="Repository sync"
          description="Only the owner can set up or run a sync."
          headingRef={headingRef}
        />
        <p className={styles.info}>
          You can set your own commit author. Only the owner can connect a
          repository or sync files.
        </p>
        <ContributorIdentitySection
          onApproved={async (email) => {
            const result = await sync.approveGitHubCommitIdentity(email);
            if (!result.success) throw new Error(result.error);
          }}
        />
      </>
    );
  else if (!state)
    content = error ? (
      <>
        <SyncHeading
          title="Couldn’t load repository sync"
          description="Your workspace files have not changed."
          headingRef={headingRef}
        />
        <div className={styles.footer}>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await load();
              })
            }
          >
            Retry connection
          </button>
          <button
            type="button"
            className={button}
            onClick={() => void authorize()}
          >
            Renew GitHub access
          </button>
        </div>
      </>
    ) : (
      <SkeletonGitHubSync className="p-0 bg-transparent overflow-visible" />
    );
  else if (comparing)
    content = (
      <>
        <SyncHeading
          title="Comparing files"
          description="No files change during comparison."
          headingRef={headingRef}
        />
        <TransferRoute
          manifest={{
            ...setup,
            repository: setup.newRepository
              ? `https://github.com/${setup.newRepository.owner}/${setup.newRepository.name}`
              : setup.repository,
          }}
          projectName={projectName}
        />
        <p role="status" className={styles.info}>
          Reading the branch and workspace file versions. Keep this page open
          until the comparison returns.
        </p>
        <div
          role="status"
          aria-busy="true"
          aria-label="Comparing files"
          className="mt-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-24 rounded-[4px]" />
              <Skeleton className="h-8 w-24 rounded-[4px]" />
              <Skeleton className="h-8 w-20 rounded-[4px]" />
            </div>
            <Skeleton className="h-8 w-48 rounded-[4px]" />
          </div>

          <div className="rounded-[6px] border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-4 rounded-[3px]" />
                <Skeleton className="h-4 w-28 rounded-[3px]" />
              </div>
              <div className="flex items-center gap-8">
                <Skeleton className="h-4 w-16 rounded-[3px]" />
                <Skeleton className="h-4 w-12 rounded-[3px]" />
              </div>
            </div>
            <div className="divide-y divide-border/40">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-4 rounded-[3px]" />
                    <Skeleton
                      className="h-4 rounded-[3px]"
                      style={{ width: `${140 + ((i * 47) % 120)}px` }}
                    />
                  </div>
                  <div className="flex items-center gap-8">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-3.5 w-12 rounded-[3px]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  else if (
    view === "connect" ||
    (!state.canAuthenticate &&
      !["run", "result", "recovery", "confirmation", "overview"].includes(view))
  )
    content = connectView();
  else if (view === "setup") content = setupView();
  else
    content =
      (
        {
          overview: overviewView,
          review: reviewView,
          confirmation: confirmationView,
          run: runView,
          result: resultView,
          recovery: recoveryView,
          settings: settingsView,
          attribution: attributionView,
        } as Partial<Record<View, () => React.ReactNode>>
      )[view]?.() || overviewView();
  return (
    <section
      aria-label="Repository sync"
      className={styles.workspace}
    >
      <div className={styles.body}>
        {workflowRequired && !error && (
          <div className={styles.footer}>
            <button
              type="button"
              className={button}
              disabled={authWaiting}
              onClick={() => void authorize()}
            >
              Authorize workflow publishing
            </button>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <ErrorNotice message={error} />
            {(workflowRequired ||
              /authoriz|permission|access|sign.in|token|organization|not found/i.test(
                error,
              )) && (
              <div className={styles.footer}>
                <button
                  type="button"
                  className={button}
                  disabled={busy || authWaiting}
                  onClick={() => void authorize()}
                >
                  {workflowRequired
                    ? "Authorize workflow publishing"
                    : "Renew GitHub access"}
                </button>
              </div>
            )}
          </div>
        )}
        {notice && (
          <div
            className={cn(styles.info, styles.row, styles.spread)}
            role="status"
          >
            <p>{notice}</p>
            <button
              type="button"
              className={quietButton}
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        )}
        {content}
        <Dialog
          open={Boolean(modal)}
          onOpenChange={(open) => {
            if (!open && !busy) setModal(null);
          }}
        >
          <DialogContent
            role={
              ["discard", "cancel", "disconnect", "target"].includes(
                modal || "",
              )
                ? "alertdialog"
                : "dialog"
            }
            className={cn(
              styles.dialog,
              modal === "diff" ? "sm:max-w-[720px]" : "sm:max-w-[520px]",
            )}
            onInteractOutside={(event) => {
              if (busy) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <DialogHeader className="sr-only">
              <span>Repository sync</span>
            </DialogHeader>
            {modalContent()}
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
