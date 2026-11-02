// Files tab root: owns boot, URL/deep-link sync, realtime, quick open, and role context.
// Requirements: Req 1.1, Req 1.7, Req 6.1, Req 9.1, Req 10.1, Req 16.4.

"use client";

import { toast, feedbackError } from "@/lib/feedback";
import { typeProfile } from "@/lib/organizations/type-profile";
import { useQueryClient } from "@tanstack/react-query";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useFilesStore } from "@/stores/filesStore";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { liveTopics } from "@/lib/realtime/subscriptions";
import { getNodeMetadataBatch } from "@/app/actions/files/nodes";

import { useExplorerBoot } from "../explorer/useExplorerBoot";

import { FilesTabRoleProvider, type Role } from "./FilesTabRoleContext";
import { OrgStorageNotice, type OrgFilesInfo } from "@/components/organizations/OrgFilesPanel";
import { FilesTabSidebar } from "./FilesTabSidebar";
import { FilesTabMain } from "./FilesTabMain";
import { QuickOpenDialog } from "./quick-open/QuickOpenDialog";
import { HydrationProgressBanner } from "@/components/workspaces/HydrationProgressBanner";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import { useFilesTabStartupStage } from "./hooks/useFilesTabStartupStage";
import { useDeepLinkResolver } from "./hooks/useDeepLinkResolver";
import { useFilesTabUrlSync } from "./hooks/useFilesTabUrlSync";
import { useNavigateTo } from "./hooks/useNavigateTo";
import { fetchWorkspaceFileLeases } from "@/lib/files/file-lease-client";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FilesViews } from "./FilesViews";
import { FileTransfersProvider } from "./FileTransfers";
import { confirmFileNavigation } from "@/lib/files/unsaved-navigation";
import { fetchGithubImportAccessState } from "@/lib/github/import-client";
import type { GithubImportAccessState } from "@/lib/github/import-types";

function showFilesToast(
  message: string,
  type: "success" | "error" | "info" | "warning" = "info",
) {
  if (type === "success") toast.success(message);
  else if (type === "error") toast.error(feedbackError(message, "Action couldn’t finish"));
  else if (type === "warning") toast.warning(message);
  else toast.info(message);
}

// ─── Public API ──────────────────────────────────────────────────────

export interface FilesTabRootProps {
  projectId: string;
  projectSlug?: string;
  /** Display name for the project, piped through to sidebar + main. */
  projectName?: string;
  /**
   * The authenticated user's id, when present. `undefined` means the
   * visitor is unauthenticated (treated as `Role_Viewer` per the design).
   */
  currentUserId?: string;
  /**
   * Upstream flag indicating the user is either the project owner or a
   * member. Combined with `currentUserId` to derive the Files-tab role.
   */
  isOwnerOrMember: boolean;
  isOwner?: boolean;
  canManageFiles?: boolean;
  canUploadFiles?: boolean;
  canReadTasks?: boolean;
  /**
   * Whether the Files tab is the active project tab. Forwarded to
   * `useExplorerBoot` to gate background fetches. Defaults to `true`.
   */
  isActive?: boolean;
  /** GitHub import / clone sync status, forwarded to the boot hook. */
  syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
  /**
   * Deep-link path (decoded segments joined by `/`). Honoured as a
   * fallback only when the URL has no `?path=` at mount. The V3 URL
   * contract uses per-segment `encodeURIComponent` joined by `/`, so we
   * re-encode segments before feeding this into the resolver.
   */
  initialOpenPath?: string | null;
  /**
   * Stable file-node deep link. Used by project update mentions so a file
   * attachment opens the exact file after the workspace cache is hydrated,
   * while `initialOpenPath` remains the readable/fallback URL contract.
   */
  initialOpenFileId?: string | null;
  /** Organizations have no GitHub sync in v1 (report §23.3). */
  isOrganization?: boolean;
  /** Education orgs call Deliverables "Submissions" (report §23.3). */
  orgType?: string | null;
  /** The organization this is, or sits inside (report §7.8, §18.6): its left-panel views and folder access. */
  orgFiles?: OrgFilesInfo | null;
}

function findVerticalScrollPane(target: EventTarget | null, boundary: HTMLElement) {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== boundary) {
    const overflowY = window.getComputedStyle(element).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight
    ) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function getFilesRouteScrollContext(filesRoot: HTMLElement) {
  const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
  const projectLayout = filesRoot.closest<HTMLElement>('[data-project-identity-height]');
  const headerScrollRange = Number(projectLayout?.dataset.projectIdentityHeight ?? 0);
  return { routeRoot, headerScrollRange };
}

// ─── Component ───────────────────────────────────────────────────────

export function FilesTabRoot(props: FilesTabRootProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const {
    projectId,
    projectSlug,
    projectName,
    currentUserId,
    isOwnerOrMember,
    isOwner = false,
    canManageFiles = false,
    isActive = true,
    syncStatus,
    initialOpenPath,
    initialOpenFileId,
  } = props;
  // ── 1. Ensure the project workspace entry exists ──────────────────
  const ensureProjectFilesState = useFilesStore(
    (s) => s.ensureProjectFilesState,
  );
  useEffect(() => {
    ensureProjectFilesState(projectId);
  }, [ensureProjectFilesState, projectId]);

  // ── 2. Role derivation ───────────────────────────────────────────
  //
  const role: Role = useMemo<Role>(() => {
    if (!currentUserId) return "Role_Viewer";
    if (isOwner) return "Role_Owner";
    return isOwnerOrMember ? "Role_Member" : "Role_Viewer";
  }, [currentUserId, isOwner, isOwnerOrMember]);
  const canEdit = role !== "Role_Viewer" && props.canUploadFiles !== false;
  const canReadTasks = props.canReadTasks ?? role !== "Role_Viewer";
  const [githubAccess, setGithubAccess] =
    useState<GithubImportAccessState | null>(null);
  const [githubAccessResolved, setGithubAccessResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!isActive || !currentUserId || (!isOwner && !isOwnerOrMember)) {
      setGithubAccess(null);
      setGithubAccessResolved(true);
      return;
    }
    setGithubAccessResolved(false);
    void fetchGithubImportAccessState()
      .then((access) => {
        if (!cancelled) {
          setGithubAccess(access);
          setGithubAccessResolved(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[files-tab] failed to resolve GitHub access", error);
          setGithubAccess(null);
          setGithubAccessResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, isActive, isOwner, isOwnerOrMember]);
  const canOpenGitHub = Boolean(
    githubAccess?.linked === true && (isOwner || isOwnerOrMember) && !props.isOrganization,
  );
  const pendingNavigation = useFilesStore(
    (state) => state.byProjectId[projectId]?.pendingNavigation ?? null,
  );
  const navigateToInitialFile = useNavigateTo(projectId);
  const dirtyFileId = useFilesStore(
    (state) => state.byProjectId[projectId]?.dirtyFileId ?? null,
  );
  useEffect(() => {
    if (!dirtyFileId) return;
    const previousUrl = window.location.href;
    const previousState = window.history.state;
    const guardHistory = (event: PopStateEvent) => {
      if (confirmFileNavigation(projectId)) return;
      event.stopImmediatePropagation();
      // The browser has already traversed. Restore the editor entry before
      // collection/URL listeners can consume the rejected destination.
      window.history.pushState(previousState, "", previousUrl);
    };
    const guardLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.href === window.location.href
      )
        return;
      if (!confirmFileNavigation(projectId)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("popstate", guardHistory, true);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("popstate", guardHistory, true);
      document.removeEventListener("click", guardLink, true);
    };
  }, [projectId, dirtyFileId]);
  const confirmPendingNavigation = useCallback(() => {
    if (!pendingNavigation) return;
    const state = useFilesStore.getState();
    const dirtyFileId = state.byProjectId[projectId]?.dirtyFileId ?? null;
    if (dirtyFileId) state.setDirtyFile(projectId, dirtyFileId, false);
    state.setPendingNavigation(projectId, null);
    navigateToInitialFile(pendingNavigation.nodeId, {
      preserveQuery: pendingNavigation.preserveQuery,
    });
  }, [pendingNavigation, projectId, navigateToInitialFile]);

  // ── 3. Three-stage startup machine (Req 16.4) ─────────────────────
  const [stage, signalStageComplete] = useFilesTabStartupStage(projectId);

  // ── 4. Single explorer boot + FilesTabBootContext provision ───────
  //
  // Boot the explorer exactly once here and publish folder loaders through
  // context so sidebar/main children cannot double-fetch.
  const {
    isBooting,
    accessError,
    loadFolderContent,
    handleToggleFolder,
    handleLoadMore,
  } = useExplorerBoot({
    projectId,
    canEdit,
    isActive,
    syncStatus,
    showToast: showFilesToast,
  });
  useEffect(() => {
    if (!isBooting) signalStageComplete("explorer");
  }, [isBooting, signalStageComplete]);
  const bootContextValue = useMemo(
    () => ({
      isBooting,
      accessError,
      loadFolderContent,
      handleToggleFolder,
      handleLoadMore,
    }),
    [
      isBooting,
      accessError,
      loadFolderContent,
      handleToggleFolder,
      handleLoadMore,
    ],
  );

  // ── 5. Deep-link snapshot: captured ONCE at mount ─────────────────
  //
  // Why a snapshot instead of reading live URL inside
  // `useDeepLinkResolver`?
  //
  // `useFilesTabUrlSync` Effect 1 writes `history.replaceState` whenever
  // `currentLocationId` changes, including on the initial mount where the
  // id is `null` (root). At root, `planUrlSync` strips `?path=` entirely.
  // That stripping happens BEFORE the stage machine transitions to
  // `"main"` and the deep-link resolver's effect fires, which means the
  // resolver would read a URL that has already been cleared — deep links
  // would silently be lost.
  //
  // By snapping `window.location.search` at mount and feeding it to the
  // resolver via its `window` override, the resolver's input is
  // immutable and the URL-sync stripping is harmless. Popstate handling
  // still uses the live `window` (inside `useFilesTabUrlSync`), so
  // browser back/forward continue to re-resolve from the current URL.
  //
  // This also provides a clean entry point for `initialOpenPath`: when the URL has no `?path=` but the prop is
  // set, we synthesise a `?path=` into the snapshot (re-encoding
  // segments so the V3 URL contract is honoured). The live URL is never
  // touched — `useFilesTabUrlSync` will write it for us once
  // `navigateTo` sets `currentLocationId`.
  const [initialSearch] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const live = window.location.search;
    const params = new URLSearchParams(
      live.startsWith("?") ? live.slice(1) : live,
    );
    if (params.get("path")) return live;
    if (initialOpenPath && initialOpenPath.length > 0) {
      const encoded = initialOpenPath
        .split("/")
        .filter((seg: string) => seg.length > 0)
        .map((seg: string) => encodeURIComponent(seg))
        .join("/");
      if (encoded.length > 0) {
        // Preserve any other query params the real URL may carry.
        const preserved: string[] = [];
        for (const [key, value] of params.entries()) {
          if (key === "path") continue;
          preserved.push(
            `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
          );
        }
        preserved.push(`path=${encoded}`);
        return `?${preserved.join("&")}`;
      }
    }
    return live;
  });

  // Snapshot `Window` handed to `useDeepLinkResolver` carrying the initial search snapshot.
  const deepLinkWindow = useMemo<Window | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return {
      location: {
        search: initialSearch,
      },
    } as unknown as Window;
  }, [initialSearch]);

  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  // ── 6. Deep-link resolver (gated on stage === "main") ─────────────
  useDeepLinkResolver(projectId, {
    stage: initialOpenFileId ? "diagnostics" : stage,
    window: deepLinkWindow,
    onError: (failure) => {
      const reason =
        failure.kind === "overlength"
          ? "The deep link is too long."
          : failure.kind === "empty"
            ? "The deep link is empty."
            : "Deep link target not found";
      setDeepLinkError(reason);
      toast.error(feedbackError(reason, "Action couldn’t finish"));
    },
  });

  const upsertNodes = useFilesStore((s) => s.upsertNodes);
  const initialOpenFileExists = useFilesStore((s) =>
    Boolean(
      initialOpenFileId &&
      s.byProjectId[projectId]?.nodesById[initialOpenFileId]?.type === "file",
    ),
  );
  const handledInitialFileIdRef = useRef<string | null>(null);
  const resolvingInitialFileIdRef = useRef<string | null>(null);
  const [handledInitialFileId, setHandledInitialFileId] = useState<
    string | null
  >(null);
  const completeInitialFileResolution = useCallback((fileId: string) => {
    handledInitialFileIdRef.current = fileId;
    setHandledInitialFileId(fileId);
  }, []);

  useEffect(() => {
    if (!initialOpenFileId) {
      handledInitialFileIdRef.current = null;
      resolvingInitialFileIdRef.current = null;
      setHandledInitialFileId(null);
    }
  }, [initialOpenFileId]);

  useEffect(() => {
    if (!initialOpenFileId || !initialOpenFileExists) return;
    if (handledInitialFileIdRef.current === initialOpenFileId) return;
    navigateToInitialFile(initialOpenFileId);
    completeInitialFileResolution(initialOpenFileId);
  }, [
    completeInitialFileResolution,
    initialOpenFileExists,
    initialOpenFileId,
    navigateToInitialFile,
  ]);

  useEffect(() => {
    if (!initialOpenFileId || initialOpenFileExists) return;
    if (handledInitialFileIdRef.current === initialOpenFileId) return;
    if (resolvingInitialFileIdRef.current === initialOpenFileId) return;

    let cancelled = false;
    resolvingInitialFileIdRef.current = initialOpenFileId;

    void getNodeMetadataBatch(projectId, [initialOpenFileId], {
      includeBreadcrumbs: true,
    })
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          toast.error(feedbackError(result.message || "The requested file is not available", "The requested file is not available"));
          completeInitialFileResolution(initialOpenFileId);
          return;
        }

        const node = result.data.nodes.find(
          (candidate) => candidate.id === initialOpenFileId,
        );
        if (!node || node.type !== "file") {
          toast.error(
            "The requested file is not available or you do not have access",
          );
          completeInitialFileResolution(initialOpenFileId);
          return;
        }

        upsertNodes(projectId, result.data.nodes);
        navigateToInitialFile(initialOpenFileId);
        completeInitialFileResolution(initialOpenFileId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[files-tab] failed to hydrate initial file target", {
          projectId,
          fileId: initialOpenFileId,
          error,
        });
        toast.error(
          "The requested file is not available or you do not have access",
        );
        completeInitialFileResolution(initialOpenFileId);
      })
      .finally(() => {
        if (resolvingInitialFileIdRef.current === initialOpenFileId) {
          resolvingInitialFileIdRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    completeInitialFileResolution,
    initialOpenFileExists,
    initialOpenFileId,
    navigateToInitialFile,
    projectId,
    upsertNodes,
  ]);

  useEffect(() => {
    if (stage !== "main" || isBooting) return;
    const raf = requestAnimationFrame(() => signalStageComplete("main"));
    return () => cancelAnimationFrame(raf);
  }, [isBooting, signalStageComplete, stage]);

  // ── 7. URL sync (replaceState mirror + popstate handler) ──────────
  useFilesTabUrlSync(projectId, {
    suspendWrites: Boolean(
      initialOpenFileId && handledInitialFileId !== initialOpenFileId,
    ),
    onPopStateError: () => {
      toast.error("Deep link target not found");
    },
  });

  // ── 8. Project lease channel + bounded freshness reconciliation ───
  //
  // The only Realtime binding is the project-filtered lease table. File/link
  // state reconciles from the authoritative folder query after mutations and
  // when the visible tab regains focus; this avoids workspace-wide events and
  // dead `project_nodes` subscriptions.
  const setLocks = useFilesStore((s) => s.setLocks);
  const currentLocationId = useFilesStore(
    (s) => s.byProjectId[projectId]?.currentLocationId ?? null,
  );
  const currentLocationNode = useFilesStore((s) =>
    currentLocationId
      ? (s.byProjectId[projectId]?.nodesById[currentLocationId] ?? null)
      : null,
  );
  const visibleFolderId =
    currentLocationNode?.type === "folder"
      ? currentLocationNode.id
      : (currentLocationNode?.parentId ?? null);

  useEffect(() => {
    if (!isActive) return;
    let reconcileTimer: number | null = null;
    let disposed = false;

    const reconcileLocks = () => {
      if (disposed) return;
      if (reconcileTimer) window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(() => {
        void fetchWorkspaceFileLeases(projectId)
          .then((locks) => setLocks(projectId, locks))
          .catch((error) =>
            console.warn("[files-tab] failed to reconcile file leases", error),
          );
      }, 100);
    };

    const reconcileVisibleFolder = () => {
      if (disposed || document.visibilityState !== "visible") return;
      void loadFolderContent(visibleFolderId, "refresh").catch((error) => {
        console.warn("[files-tab] failed to reconcile visible folder", error);
      });
    };

    const live = subscribeBroadcast(liveTopics.files(projectId), (event) => {
      if (event === "lock.changed") reconcileLocks();
    }, (status) => {
      if (status === "connected") reconcileLocks();
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcileVisibleFolder();
    };
    const onFilesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; taskId?: string; collection?: string }>).detail;
      if (detail?.projectId !== projectId) return;
      if (detail?.collection) {
        void queryClient.invalidateQueries({
          queryKey: [detail.collection, projectId],
        });
      } else {
        void queryClient.invalidateQueries({
          queryKey: ["files-directory", projectId],
        });
        if (detail?.taskId) {
          void queryClient.invalidateQueries({
            queryKey: ["files-task-collections", projectId, detail.taskId],
          });
        } else {
          void queryClient.invalidateQueries({
            queryKey: ["files-task-collections", projectId],
          });
        }
      }
      reconcileVisibleFolder();
    };
    window.addEventListener("project:task-files-changed", onFilesChanged);
    window.addEventListener("online", reconcileVisibleFolder);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // ponytail: 30s lock expiry sweep. ceiling: 30s interval. upgrade: WebSocket Realtime push invalidation for remote locks.
    const expirySweep = window.setInterval(() => {
      if (document.hidden) return;
      const current =
        useFilesStore.getState().byProjectId[projectId]
          ?.locksByNodeId ?? {};
      const locks = Object.values(current);
      if (locks.some((lock) => lock.expiresAt <= Date.now())) {
        setLocks(
          projectId,
          locks.filter((lock) => lock.expiresAt > Date.now()),
        );
      }
    }, 30_000);

    return () => {
      disposed = true;
      if (reconcileTimer) window.clearTimeout(reconcileTimer);
      window.clearInterval(expirySweep);
      window.removeEventListener("project:task-files-changed", onFilesChanged);
      window.removeEventListener("online", reconcileVisibleFolder);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      live.unsubscribe();
    };
  }, [
    projectId,
    isActive,
    loadFolderContent,
    setLocks,
    visibleFolderId,
    queryClient,
  ]);

  // ── 9. Quick Open state + ⌘P / Ctrl+P toggle (Req 9.1) ────────────
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const filesRootRef = useRef<HTMLDivElement>(null);
  const paneScrollPositionsRef = useRef(new WeakMap<HTMLElement, number>());
  const touchScrollRef = useRef<{ y: number; pane: HTMLElement | null } | null>(null);

  const handleQuickOpenChange = useCallback((next: boolean) => {
    setQuickOpenOpen(next);
    if (!next) setQuickOpenQuery(""); // Req 9.7 discards input on close
  }, []);

  const handleFilesScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const currentScrollTop = target.scrollTop;
      const previousScrollTop = paneScrollPositionsRef.current.get(target) ?? 0;
      paneScrollPositionsRef.current.set(target, currentScrollTop);

      const { routeRoot, headerScrollRange } = getFilesRouteScrollContext(event.currentTarget);
      const paneDelta = currentScrollTop - previousScrollTop;
      if (!routeRoot || paneDelta <= 0 || routeRoot.scrollTop >= headerScrollRange) return;

      // Files panes remain independently scrollable, but the project route
      // consumes the opening part of a downward gesture. This matches the
      // progressive header movement used by Dashboard and Settings instead
      // of toggling the entire header after a small threshold.
      const routeDelta = Math.min(paneDelta, headerScrollRange - routeRoot.scrollTop);
      routeRoot.scrollTop += routeDelta;
      target.scrollTop = currentScrollTop - routeDelta;
      paneScrollPositionsRef.current.set(target, target.scrollTop);
    },
    [],
  );

  const handleFilesWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      const filesRoot = filesRootRef.current;
      if (!filesRoot) return;
      const { routeRoot, headerScrollRange } = getFilesRouteScrollContext(filesRoot);
      if (!routeRoot || headerScrollRange <= 0) return;

      const scrollPane = findVerticalScrollPane(event.target, filesRoot);
      const shouldMoveHeaderDown = event.deltaY > 0 && routeRoot.scrollTop < headerScrollRange;
      const shouldRevealHeader =
        event.deltaY < 0 &&
        routeRoot.scrollTop > 0 &&
        (!scrollPane || scrollPane.scrollTop <= 0);
      if (!shouldMoveHeaderDown && !shouldRevealHeader) return;

      event.preventDefault();
      const nextRouteTop = Math.max(
        0,
        Math.min(headerScrollRange, routeRoot.scrollTop + event.deltaY),
      );
      const consumedDelta = nextRouteTop - routeRoot.scrollTop;
      routeRoot.scrollTop = nextRouteTop;

      const remainingDelta = event.deltaY - consumedDelta;
      if (remainingDelta > 0 && scrollPane) {
        scrollPane.scrollTop += remainingDelta;
        paneScrollPositionsRef.current.set(scrollPane, scrollPane.scrollTop);
      }
    },
    [],
  );

  const handleFilesTouchStart = useCallback(
    (event: TouchEvent) => {
      const touch = event.touches[0];
      const filesRoot = filesRootRef.current;
      if (!touch || !filesRoot) return;
      touchScrollRef.current = {
        y: touch.clientY,
        pane: findVerticalScrollPane(event.target, filesRoot),
      };
    },
    [],
  );

  const handleFilesTouchMove = useCallback(
    (event: TouchEvent) => {
      const touch = event.touches[0];
      const touchState = touchScrollRef.current;
      const filesRoot = filesRootRef.current;
      if (!touch || !touchState || !filesRoot) return;

      const deltaY = touchState.y - touch.clientY;
      touchState.y = touch.clientY;
      if (Math.abs(deltaY) < 0.5) return;

      const { routeRoot, headerScrollRange } = getFilesRouteScrollContext(filesRoot);
      if (!routeRoot || headerScrollRange <= 0) return;

      const shouldMoveHeaderDown = deltaY > 0 && routeRoot.scrollTop < headerScrollRange;
      const shouldRevealHeader =
        deltaY < 0 &&
        routeRoot.scrollTop > 0 &&
        (!touchState.pane || touchState.pane.scrollTop <= 0);
      if (!shouldMoveHeaderDown && !shouldRevealHeader) return;

      event.preventDefault();
      const nextRouteTop = Math.max(
        0,
        Math.min(headerScrollRange, routeRoot.scrollTop + deltaY),
      );
      const consumedDelta = nextRouteTop - routeRoot.scrollTop;
      routeRoot.scrollTop = nextRouteTop;

      const remainingDelta = deltaY - consumedDelta;
      if (remainingDelta > 0 && touchState.pane) {
        touchState.pane.scrollTop += remainingDelta;
        paneScrollPositionsRef.current.set(touchState.pane, touchState.pane.scrollTop);
      }
    },
    [],
  );

  useEffect(() => {
    const filesRoot = filesRootRef.current;
    if (!filesRoot) return;

    filesRoot.addEventListener("wheel", handleFilesWheel, { passive: false, capture: true });
    filesRoot.addEventListener("touchstart", handleFilesTouchStart, { passive: true, capture: true });
    filesRoot.addEventListener("touchmove", handleFilesTouchMove, { passive: false, capture: true });

    return () => {
      filesRoot.removeEventListener("wheel", handleFilesWheel, { capture: true });
      filesRoot.removeEventListener("touchstart", handleFilesTouchStart, { capture: true });
      filesRoot.removeEventListener("touchmove", handleFilesTouchMove, { capture: true });
    };
  }, [handleFilesTouchMove, handleFilesTouchStart, handleFilesWheel]);

  // Use a ref so the listener identity stays stable across renders; the
  // ref carries the freshest `open` value without re-binding the handler.
  const quickOpenOpenRef = useRef(quickOpenOpen);
  useEffect(() => {
    quickOpenOpenRef.current = quickOpenOpen;
  }, [quickOpenOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "p") return;
      // Don't steal the shortcut when the user is editing inside a
      // content-editable region or a form field outside Quick Open. This
      // matches the legacy WorkspaceKeyboard behaviour which the browser
      // default (print dialog) also overrides.
      const target = e.target as HTMLElement | null;
      // An on-demand Files search or inspector already owns keyboard focus.
      // Do not open a second Quick Open dialog from its buttons or menus.
      if (
        !quickOpenOpenRef.current &&
        target?.closest('[role="dialog"], [role="menu"]')
      )
        return;
      if (target) {
        const isInput =
          target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        const isEditable =
          target.isContentEditable ||
          target.getAttribute("contenteditable") === "true";
        if (isInput || isEditable) return;
      }

      e.preventDefault();
      const wasOpen = quickOpenOpenRef.current;
      if (wasOpen) {
        handleQuickOpenChange(false);
      } else {
        setQuickOpenQuery("");
        setQuickOpenOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleQuickOpenChange]);

  // ── 10. Render ─────────────────────────────────────────────────────
  return (
    <FilesTabBootContext.Provider value={bootContextValue}>
      <FilesTabRoleProvider
        role={role}
        canEdit={canEdit}
        canManageFiles={canManageFiles}
        canReadTasks={canReadTasks}
        editorReadOnly={props.orgFiles?.mode === "org" && !canManageFiles}
      >
        <FileTransfersProvider>
          <FilesViews
            projectId={projectId}
            canReadTasks={canReadTasks}
            canOpenGitHub={canOpenGitHub}
            githubAccessResolved={githubAccessResolved}
            viewLabels={props.orgFiles?.mode === "org" ? { deliverables: typeProfile(props.orgType).finishedWork, submissions: typeProfile(props.orgType).finishedWork }
              : props.orgFiles?.mode === "child" ? { from_org: `From ${props.orgFiles.title}` } : undefined}
            org={props.orgFiles ?? null}
          >
            <div
              ref={filesRootRef}
              data-testid="files-tab-root"
              data-startup-stage={stage}
              onScrollCapture={handleFilesScroll}
              className="relative flex h-full min-h-0 w-full"
            >
              <HydrationProgressBanner projectId={projectId} />
              {props.orgFiles ? <div className="absolute right-3 top-1 z-10"><OrgStorageNotice org={props.orgFiles} /></div> : null}
              <FilesTabSidebar
                projectId={projectId}
                canEdit={canEdit}
                canManageFiles={canManageFiles}
                projectName={projectName}
              />
              <FilesTabMain
                projectId={projectId}
                projectSlug={projectSlug}
                projectName={projectName}
                canOpenGitHub={canOpenGitHub}
                githubAccess={githubAccess}
                isOwner={isOwner}
                deepLinkError={deepLinkError}
                onDismissDeepLinkError={() => setDeepLinkError(null)}
              />
              <QuickOpenDialog
                projectId={projectId}
                open={quickOpenOpen}
                query={quickOpenQuery}
                onQueryChange={setQuickOpenQuery}
                onOpenChange={handleQuickOpenChange}
              />
              <ConfirmDialog
                open={Boolean(pendingNavigation)}
                onOpenChange={(open) => {
                  if (!open) {
                    useFilesStore
                      .getState()
                      .setPendingNavigation(projectId, null);
                  }
                }}
                title="Discard unsaved changes?"
                description="Your edits have not been saved. Discard them and open the selected location?"
                confirmLabel="Discard and open"
                variant="destructive"
                onConfirm={confirmPendingNavigation}
              />
            </div>
          </FilesViews>
        </FileTransfersProvider>
      </FilesTabRoleProvider>
    </FilesTabBootContext.Provider>
  );
}

export default FilesTabRoot;
