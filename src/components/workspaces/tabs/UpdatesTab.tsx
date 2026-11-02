"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import {
    Loader2,
    MessageCircle,
} from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { createWorkspaceUpdateAction, readWorkspaceUpdateAction, readWorkspaceUpdatesAction, type WorkspaceUpdateView } from "@/app/actions/workspace/updates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceUpdatesLive } from "@/hooks/useUpdateLive";
import { queryKeys } from "@/lib/query-keys";
import { WORKSPACE_UPDATE_VIRTUALIZE_THRESHOLD } from "@/lib/workspaces/updates";
import { cn } from "@/lib/utils";
import { prependUpdate, replaceUpdate, type UpdatesPage } from '@/components/workspaces/updates/update-helpers';
import { MemoizedUpdateCard } from '@/components/workspaces/updates/UpdateCard';
import { ModeratedPlaceholder, useModeratedItems, withPlaceholders } from '@/components/reports/ModeratedPlaceholder';
import { UpdatesRightRail } from '@/components/workspaces/updates/UpdatesRightRail';
import { OrgFeedFilters, OrgPinnedLine, OrgUpdateOptions, type OrgPostOptions } from '@/components/organizations/OrgUpdateParts';
import type { OrgFeedFilter } from '@/lib/organizations/org-updates';
import { markOrgUpdatesSeenAction } from '@/app/actions/org-updates';

type UpdatesTabProps = {
  projectId: string;
  projectSlug?: string | null;
  projectName: string;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  canCreateUpdates: boolean;
  /** Owners and members also listen on the members' topic. */
  isMember?: boolean;
  canManageUpdates: boolean;
  initialUpdateId?: string | null;
  initialCommentId?: string | null;
  /** + New → Announcement from the org header (report §18.2): focus the composer once. */
  focusComposer?: boolean;
  onComposerFocused?: () => void;
};

const UpdateDetailPanel = dynamic(() => import('@/components/workspaces/updates/UpdateDetailPanel').then((mod) => mod.UpdateDetailPanel));

const WorkspaceUpdateComposer = dynamic(
  () =>
    import("../updates/WorkspaceUpdateComposer").then(
      (mod) => mod.WorkspaceUpdateComposer,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-24 rounded-[8px] border border-border bg-muted/30" />
    ),
  },
);

function useMediaMatch(media: string) {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(media);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [media]);

  return matches;
}


export default function UpdatesTab({
  projectId,
  projectSlug,
  projectName,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  canCreateUpdates,
  isMember = false,
  canManageUpdates,
  initialUpdateId,
  initialCommentId,
  focusComposer = false,
  onComposerFocused,
}: UpdatesTabProps) {
  const queryClient = useQueryClient();
  // The composer loads lazily, so wait for its text box before focusing it.
  useEffect(() => {
    if (!focusComposer) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const box = document.querySelector<HTMLTextAreaElement>('#project-active-tab-panel textarea');
      if (box || ++tries > 40) {
        window.clearInterval(timer);
        box?.focus();
        onComposerFocused?.();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [focusComposer, onComposerFocused]);
  // Org feeds filter by kind (report §17.5); the plain key stays the prefix so invalidations still reach every filter.
  const [orgFilter, setOrgFilter] = useState<OrgFeedFilter>("all");
  const [orgOptions, setOrgOptions] = useState<OrgPostOptions>({});
  const baseQueryKey = queryKeys.project.detail.updates(projectId);
  const updatesQueryKey = useMemo(
    () => (orgFilter === "all" ? baseQueryKey : [...baseQueryKey, orgFilter]),
    [projectId, orgFilter],
  );
  const [hiddenUpdateIds, setHiddenUpdateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailUpdateId, setDetailUpdateId] = useState<string | null>(
    initialUpdateId ?? null,
  );
  const isDesktopUpdatesRail = useMediaMatch("(min-width: 1280px)");
  // Phones open an update in a full-screen drawer so the feed keeps its scroll position (spec §09/§25).
  const isPhone = useMediaMatch("(max-width: 767px)");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const mobileDetailRef = useRef<HTMLDivElement | null>(null);
  const [feedScrollParent, setFeedScrollParent] = useState<HTMLElement | null>(null);

  const updatesQuery = useInfiniteQuery({
    queryKey: updatesQueryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await readWorkspaceUpdatesAction(projectId, {
        cursor: pageParam,
        filter: orgFilter,
      });
      if (!result.success)
        throw new Error(result.error || "Couldn’t load workspace updates");
      return result.data as UpdatesPage;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const updates = useMemo(
    () => updatesQuery.data?.pages.flatMap((page) => page.updates) ?? [],
    [updatesQuery.data],
  );
  const visibleUpdates = useMemo(
    () => updates.filter((update) => !update.deletedAt && !hiddenUpdateIds.has(update.id)),
    [hiddenUpdateIds, updates],
  );
  // Hidden or removed posts keep their place (trust and safety §7.1): for the author with Appeal, for others as "hidden".
  const moderated = useModeratedItems(currentUserId ? { workspaceId: projectId } : null);
  const feedEntries = useMemo(
    () => withPlaceholders(visibleUpdates, moderated.filter((m) => m.kind === "update"), !updatesQuery.hasNextPage),
    [moderated, updatesQuery.hasNextPage, visibleUpdates],
  );
  const shouldVirtualizeFeed =
    visibleUpdates.length > WORKSPACE_UPDATE_VIRTUALIZE_THRESHOLD;
  const detailUpdate = useMemo(
    () =>
      detailUpdateId
        ? (updates.find((update) => update.id === detailUpdateId && !update.deletedAt) ?? null)
        : null,
    [detailUpdateId, updates],
  );
  const hideUpdate = useCallback((updateId: string) => {
    setHiddenUpdateIds((current) => new Set(current).add(updateId));
    toast.success("Hidden until you reload");
  }, []);
  const openDetail = useCallback((updateId: string) => {
    setDetailUpdateId(updateId);
    requestAnimationFrame(() => {
      mobileDetailRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);
  const capabilities = updatesQuery.data?.pages[0]?.capabilities;
  const org = updatesQuery.data?.pages[0]?.org ?? null;
  // New markers compare against the last visit as it was on arrival; opening the feed then marks it seen.
  const [seenBefore, setSeenBefore] = useState<string | null | undefined>(undefined);
  const firstPage = updatesQuery.data?.pages[0];
  useEffect(() => {
    if (seenBefore !== undefined || firstPage?.org?.kind !== "org" || !currentUserId) return;
    setSeenBefore(firstPage.lastSeenAt ?? null);
    void markOrgUpdatesSeenAction(projectId);
  }, [currentUserId, firstPage, projectId, seenBefore]);
  const isNewUpdate = (update: WorkspaceUpdateView) =>
    seenBefore !== undefined && update.authorId !== currentUserId && (seenBefore === null || update.createdAt > seenBefore);
  const postWithOrgOptions = (input: Parameters<typeof createWorkspaceUpdateAction>[1]) => {
    const orgInput = org?.kind === "org"
      ? { ...orgOptions, updateType: org.isAdmin ? orgOptions.updateType ?? "announcement" : "discussion" }
      : orgOptions;
    // Options clear only once the post is in, so a retry keeps its audience (report §42.15 problem 44).
    return createMutation.mutateAsync({ ...input, ...orgInput }).then(() => {
      setOrgOptions({});
      return true;
    }, () => false);
  };
  const canCreate = Boolean(capabilities?.canCreate ?? canCreateUpdates);
  const canManage = Boolean(capabilities?.canManage ?? canManageUpdates);

  useEffect(() => {
    const routeScrollRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
    setFeedScrollParent(routeScrollRoot ?? null);
  }, []);

  // New posts wait behind a pill so nothing moves under the reader (RT5). Everything else on the tab is kept current
  // by the live layer: counts, edits, deletions and open threads, on your own posts too.
  const [incoming, setIncoming] = useState<WorkspaceUpdateView[]>([]);
  const handleCreated = useCallback((updateId: string) => {
    void readWorkspaceUpdateAction(projectId, updateId).then((result) => {
      if (!result.success || !result.data || result.data.authorId === currentUserId) return;
      const update = result.data;
      setIncoming((list) => (list.some((item) => item.id === update.id) ? list : [update, ...list]));
    });
  }, [currentUserId, projectId]);
  useWorkspaceUpdatesLive(projectId, Boolean(currentUserId), isMember, handleCreated);
  const showIncoming = () => {
    queryClient.setQueryData(updatesQueryKey, (existing: InfiniteData<UpdatesPage> | undefined) =>
      [...incoming].reverse().reduce((pages, update) =>
        (pages?.pages.some((page) => page.updates.some((u) => u.id === update.id)) ? pages : prependUpdate(pages, update)), existing));
    setIncoming([]);
  };

  // A deep-linked update opens once per link. Depending on the live feed would reopen it (and
  // scroll the page) on every like, comment or realtime refetch.
  const handledInitialUpdateRef = useRef<string | null>(null);
  const updatesRef = useRef(updates);
  useEffect(() => {
    updatesRef.current = updates;
  }, [updates]);
  useEffect(() => {
    if (!initialUpdateId || handledInitialUpdateRef.current === initialUpdateId) return;
    handledInitialUpdateRef.current = initialUpdateId;
    setDetailUpdateId(initialUpdateId);
    const scrollToUpdate = () =>
      requestAnimationFrame(() => {
        document
          .getElementById(`project-update-${initialUpdateId}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    if (updatesRef.current.some((update) => update.id === initialUpdateId)) {
      scrollToUpdate();
      return;
    }
    let cancelled = false;
    readWorkspaceUpdateAction(projectId, initialUpdateId).then((result) => {
      if (cancelled || !result.success || !result.data) return;
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          prependUpdate(existing, result.data!),
      );
      scrollToUpdate();
    });
    return () => {
      cancelled = true;
    };
  }, [initialUpdateId, projectId, queryClient, updatesQueryKey]);

  // Closing the detail also drops the deep link, so a reload does not reopen it.
  const closeDetail = useCallback(() => {
    setDetailUpdateId(null);
    const params = new URLSearchParams(window.location.search);
    if (!params.has("updateId") && !params.has("commentId")) return;
    params.delete("updateId");
    params.delete("commentId");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const createMutation = useMutation({
    mutationFn: async (
      input: Parameters<typeof createWorkspaceUpdateAction>[1],
    ) => {
      const result = await createWorkspaceUpdateAction(projectId, input);
      if (!result.success || !result.data)
        throw new Error(result.error || "Couldn’t post update");
      return result.data;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: updatesQueryKey });
      const previous =
        queryClient.getQueryData<InfiniteData<UpdatesPage>>(updatesQueryKey);
      const tempId = `temp-update-${Date.now()}`;
      const optimistic: WorkspaceUpdateView = {
        id: tempId,
        projectId,
        authorId: currentUserId,
        author: {
          id: currentUserId,
          fullName: currentUserName ?? null,
          username: null,
          avatarUrl: currentUserAvatarUrl ?? null,
          roleLabel: null,
          roleTitle: null,
          membershipRoleLabel: null,
          roleSource: null,
        },
        content: input.content,
        updateType: null,
        visibility: input.visibility === "members" ? "members" : "public",
        replyPolicy: "logged_in",
        entityRefs: input.entityRefs ?? {},
        context: {},
        media: input.media ?? [],
        metadata: {},
        isPinned: false,
        pinnedUntil: null,
        audience: {},
        fromProject: null,
        likeCount: 0,
        commentCount: 0,
        likedByViewer: false,
        canEdit: true,
        canDelete: true,
        canPin: canManage,
        canComment: Boolean(currentUserId),
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          prependUpdate(existing, optimistic),
      );
      return { previous, tempId };
    },
    onError: (error, _input, context) => {
      if (context?.previous)
        queryClient.setQueryData(updatesQueryKey, context.previous);
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Couldn’t post update", "Couldn’t post update"),
      );
    },
    onSuccess: (update, _input, context) => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          context?.tempId
            ? replaceUpdate(existing, context.tempId, update)
            : prependUpdate(existing, update),
      );
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
      toast.success("Workspace update posted");
    },
  });

  const feed = updatesQuery.isLoading ? (
    <div className="divide-y divide-border/80">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-1 py-3">
          <div aria-hidden="true" className="nb-skeleton h-9 w-9 shrink-0 rounded-[5px]" />
          <div className="flex-1 space-y-2">
            <div aria-hidden="true" className="nb-skeleton h-3.5 w-1/3 rounded-[3px]" />
            <div aria-hidden="true" className="nb-skeleton h-10 rounded-[5px]" />
          </div>
        </div>
      ))}
    </div>
  ) : updatesQuery.isError && visibleUpdates.length === 0 ? (
    <div className="nb-empty-state py-16" role="alert">
      <h3 className="nb-empty-state-title">Updates could not be loaded</h3>
      <p className="nb-empty-state-desc">Check your connection and try again.</p>
      <button
        type="button"
        onClick={() => void updatesQuery.refetch()}
        className="nb-touch-target mt-3 rounded-[5px] border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
      >
        Retry
      </button>
    </div>
  ) : feedEntries.length === 0 ? (
    <div className="nb-empty-state nb-grid-ground py-16" role="status">
      <MessageCircle className="nb-empty-state-icon mb-3" />
      <h3 className="nb-empty-state-title">
        No updates yet
      </h3>
      <p className="nb-empty-state-desc">
        {canCreate
          ? "Share the first progress post so followers can see what is moving."
          : "Follow this workspace to get notified when the team shares progress."}
      </p>
    </div>
  ) : shouldVirtualizeFeed ? (
    <Virtuoso
      {...(feedScrollParent ? { customScrollParent: feedScrollParent } : { useWindowScroll: true })}
      data={feedEntries}
      itemContent={(_, entry) => "placeholder" in entry ? (
        <ModeratedPlaceholder item={entry.placeholder} noun="post" className="mb-3" />
      ) : (
        <MemoizedUpdateCard
          projectId={projectId}
          projectSlug={projectSlug}
          update={entry.item}
          updatesQueryKey={updatesQueryKey}
          onHide={hideUpdate}
          onOpenDetail={openDetail}
          currentUserId={currentUserId}
          highlighted={initialUpdateId === entry.item.id}
          isNew={isNewUpdate(entry.item)}
        />
      )}
    />
  ) : (
    <div>
      <>
        {feedEntries.map((entry) => "placeholder" in entry ? (
          <ModeratedPlaceholder key={`moderated-${entry.placeholder.targetId}`} item={entry.placeholder} noun="post" className="mb-3" />
        ) : (
          <MemoizedUpdateCard
            key={entry.item.id}
            projectId={projectId}
            projectSlug={projectSlug}
            update={entry.item}
            updatesQueryKey={updatesQueryKey}
            onHide={hideUpdate}
            onOpenDetail={openDetail}
            currentUserId={currentUserId}
            highlighted={initialUpdateId === entry.item.id}
            isNew={isNewUpdate(entry.item)}
          />
        ))}
      </>
    </div>
  );

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[1240px] gap-8 xl:grid-cols-[minmax(0,1fr)_440px]"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3 px-1 pb-3 pt-2">
          <div>
            <h2 className="nb-section-title text-foreground">
              Updates
            </h2>
            <p className="nb-compact text-muted-foreground">
              Progress posts for followers and workspace visitors.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="nb-ui-label inline-flex min-h-11 shrink-0 items-center rounded-[5px] border border-border bg-card px-3 text-foreground md:hidden"
          >
            Shortcuts
          </button>
        </div>

        {isDesktopUpdatesRail === false && canCreate && org ? <OrgUpdateOptions org={org} orgId={projectId} value={orgOptions} onChange={setOrgOptions} /> : null}
        {isDesktopUpdatesRail === false ? (
          <WorkspaceUpdateComposer
            projectId={projectId}
            projectName={projectName}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserAvatarUrl={currentUserAvatarUrl}
            canCreate={canCreate}
            canManage={canManage}
            isPosting={createMutation.isPending}
            defaultVisibility={capabilities?.defaultVisibility}
            onPost={postWithOrgOptions}
          />
        ) : null}

        {incoming.length ? (
          <div className="flex justify-center py-2">
            <Button type="button" size="sm" variant="outline" onClick={showIncoming} className="pointer-coarse:h-11">
              Show {incoming.length} new {incoming.length === 1 ? "update" : "updates"}
            </Button>
          </div>
        ) : null}

        {detailUpdate && isPhone === false ? (
          <div ref={mobileDetailRef} className="xl:hidden">
            <UpdateDetailPanel
              projectId={projectId}
              projectSlug={projectSlug}
              update={detailUpdate}
              updatesQueryKey={updatesQueryKey}
              onClose={closeDetail}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              highlightedCommentId={
                detailUpdate.id === initialUpdateId ? initialCommentId : null
              }
              className="mb-4 animate-in fade-in slide-in-from-bottom-2 border-y border-border py-4 duration-[180ms]"
            />
          </div>
        ) : null}

        {isPhone ? (
          <>
            <Dialog open={Boolean(detailUpdate)} onOpenChange={(open) => { if (!open) closeDetail(); }}>
              <DialogContent presentation="right-drawer" className="gap-0 overflow-y-auto p-4">
                <DialogTitle className="sr-only">Update</DialogTitle>
                {detailUpdate ? (
                  <UpdateDetailPanel
                    projectId={projectId}
                    projectSlug={projectSlug}
                    update={detailUpdate}
                    updatesQueryKey={updatesQueryKey}
                    onClose={closeDetail}
                    currentUserId={currentUserId}
                    currentUserName={currentUserName}
                    currentUserAvatarUrl={currentUserAvatarUrl}
                    highlightedCommentId={detailUpdate.id === initialUpdateId ? initialCommentId : null}
                  />
                ) : null}
              </DialogContent>
            </Dialog>
            <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
              <DialogContent presentation="right-drawer" className="overflow-y-auto p-4">
                <DialogTitle className="nb-card-title">Shortcuts</DialogTitle>
                <UpdatesRightRail
                  updates={visibleUpdates}
                  onOpenDetail={(updateId) => {
                    setShortcutsOpen(false);
                    openDetail(updateId);
                  }}
                />
              </DialogContent>
            </Dialog>
          </>
        ) : null}

        {org?.kind === "org" ? <OrgFeedFilters value={orgFilter} onChange={setOrgFilter} /> : null}
        {org?.kind === "child" ? <OrgPinnedLine projectId={projectId} /> : null}
        {feed}

        {updatesQuery.hasNextPage ? (
          <div className="px-1 py-4">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-[5px] font-mono text-xs uppercase tracking-wider"
              onClick={() => updatesQuery.fetchNextPage()}
              disabled={updatesQuery.isFetchingNextPage}
            >
              {updatesQuery.isFetchingNextPage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Load more updates
            </Button>
          </div>
        ) : null}
      </div>

      <aside className="hidden w-full min-w-0 xl:block xl:w-[440px] shrink-0 border-l border-border pl-6">
        <div
          className="sticky top-[calc(var(--workspace-tabs-height,42px)+1rem)] max-h-[calc(100dvh-var(--workspace-tabs-height,42px)-2rem)] overflow-y-auto pr-2 space-y-6"
        >
          {detailUpdate ? (
            <UpdateDetailPanel
              projectId={projectId}
              projectSlug={projectSlug}
              update={detailUpdate}
              updatesQueryKey={updatesQueryKey}
              onClose={closeDetail}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              highlightedCommentId={
                detailUpdate.id === initialUpdateId ? initialCommentId : null
              }
              className="animate-in fade-in slide-in-from-right-2 duration-[180ms]"
            />
          ) : (
            <div className="space-y-6">
              {isDesktopUpdatesRail === true && canCreate && org ? <OrgUpdateOptions org={org} orgId={projectId} value={orgOptions} onChange={setOrgOptions} /> : null}
              {isDesktopUpdatesRail === true ? (
                <WorkspaceUpdateComposer
                  projectId={projectId}
                  projectName={projectName}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  currentUserAvatarUrl={currentUserAvatarUrl}
                  canCreate={canCreate}
                  canManage={canManage}
                  isPosting={createMutation.isPending}
                  defaultVisibility={capabilities?.defaultVisibility}
                  onPost={postWithOrgOptions}
                />
              ) : null}
              <UpdatesRightRail
                updates={visibleUpdates}
                onOpenDetail={openDetail}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
