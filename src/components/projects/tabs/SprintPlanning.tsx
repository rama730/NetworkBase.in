"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";

import { SprintHeader } from "@/components/projects/tabs/sprint/SprintHeader";
import { SprintLeftRail } from "@/components/projects/tabs/sprint/SprintLeftRail";
import { SprintTimelineContent } from "@/components/projects/tabs/sprint/SprintTimelineContent";
import {
  archiveSprintAction,
  cancelSprintAction,
  completeSprintAction,
  createSprintAction,
  deleteSprintAction,
  updateSprintAction,
} from "@/app/actions/project";
import {
  useSprintDetail,
} from "@/hooks/projects/useProjectTasksData";
import { queryKeys } from "@/lib/query-keys";
import {
  buildProjectSprintDetailHref,
  type SprintDetailPayload,
  type SprintListItem,
} from "@/lib/projects/sprint-detail";

import {
  buildSprintDeleteImpact,
  type CreateSprintDraftInput,
  type SprintDeleteImpact,
  type SprintEditorMode,
} from "@/lib/projects/sprints";

import CreateSprintModal from "@/components/projects/v2/sprints/CreateSprintModal";
import { SprintLifecycleModals } from "@/components/projects/tabs/sprint/SprintLifecycleModals";
import { SkeletonSprints } from "@/components/projects/skeletons/SkeletonSprints";

interface SprintPlanningProps {
  projectId: string;
  projectSlug: string;
  projectName?: string;
  projectKey?: string | null;
  isOwner: boolean;
  isOwnerOrMember: boolean;
  initialSprintData?: Promise<SprintDetailPayload | null> | null;
}

export type Sprint = SprintListItem;

type SprintEditorState = {
  mode: SprintEditorMode;
  sprint: SprintListItem | null;
} | null;

export default function SprintPlanning({
  projectId,
  projectSlug,
  projectName: _projectName,
  projectKey,
  isOwner,
  isOwnerOrMember,
  initialSprintData: initialSprintPromise = null,
}: SprintPlanningProps) {
  const initialSprintData = initialSprintPromise ? use(initialSprintPromise) : null;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();


  const [editorState, setEditorState] = useState<SprintEditorState>(null);
  const [isMutatingLifecycle, setIsMutatingLifecycle] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<"complete" | "archive" | "cancel" | null>(null);

  const routeSprintId = useMemo(() => {
    const match = pathname?.match(/\/projects\/[^/]+\/sprints\/([^/?#]+)/);
    return match?.[1] ?? null;
  }, [pathname]);
  const legacyRouteSprintId = searchParams?.get("sprintId") ?? null;
  const routeSprintReference = searchParams?.get("sprint") ?? null;
  const requestedSprintId =
    routeSprintId || legacyRouteSprintId || routeSprintReference || initialSprintData?.selectedSprintId || null;

  const {
    data: detail,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSprintDetail(
    projectId,
    requestedSprintId,
    null,
    initialSprintData ?? undefined,
  );

  const rows = useMemo(() => detail?.rows ?? [], [detail?.rows]);

  const selectedSprintId = detail?.selectedSprintId ?? null;
  const selectedSprint =
    detail?.sprints.find((sprint) => sprint.id === selectedSprintId) ?? null;

  useEffect(() => {
    if (!selectedSprint) return;
    const needsCanonicalCode =
      Boolean(legacyRouteSprintId) ||
      (Boolean(routeSprintReference) && routeSprintReference?.toLowerCase() !== selectedSprint.code.toLowerCase());
    if (!needsCanonicalCode) return;
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("sprintId");
    params.set("sprint", selectedSprint.code);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [legacyRouteSprintId, pathname, routeSprintReference, router, searchParams, selectedSprint]);
  const permissions = detail?.permissions ?? {
    canRead: true,
    canWrite: isOwner,
    canCreate: isOwner,
    canStart: isOwner,
    canComplete: isOwner,
    isOwner,
    isMember: isOwnerOrMember && !isOwner,
    memberRole: isOwner ? "owner" : isOwnerOrMember ? "member" : "viewer",
  };
  const isEditorOpen = editorState !== null;
  const deleteImpact: SprintDeleteImpact | null =
    editorState?.mode === "edit" &&
    editorState.sprint &&
    detail?.summary &&
    selectedSprintId === editorState.sprint.id
      ? buildSprintDeleteImpact({
          sprint: editorState.sprint,
          affectedTaskCount: detail.summary.totalTasks,
        })
      : null;


  const handleCreateSprint = useCallback(
    async (data: CreateSprintDraftInput) => {
      try {
        const result = await createSprintAction({ ...data, projectId });
        if (!result.success || !result.sprint) {
          return { success: false as const, error: result.error };
        }

        toast.success("Sprint created");
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprints(projectId),
        });
        // Task cards carry sprint chips: refresh them too.
        void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
        router.push(buildProjectSprintDetailHref(projectSlug, result.sprint.id, { sprintCode: result.sprint.code }), { scroll: false });
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to create sprint",
        };
      }
    },
    [projectId, projectSlug, queryClient, router],
  );

  const handleUpdateSprint = useCallback(
    async (data: CreateSprintDraftInput) => {
      if (!editorState?.sprint) {
        return { success: false as const, error: "Sprint not found" };
      }

      try {
        const result = await updateSprintAction({
          projectId,
          sprintId: editorState.sprint.id,
          ...data,
        });

        if (!result.success || !result.sprint) {
          throw new Error(result.error ?? "Failed to update sprint");
        }

        toast.success("Sprint updated");
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprints(projectId),
        });
        // Task cards carry sprint chips: refresh them too.
        void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Failed to update sprint",
        };
      }
    },
    [editorState?.sprint, projectId, queryClient],
  );

  const handleDeleteSprint = useCallback(async () => {
    if (!editorState?.sprint) {
      return { success: false as const, error: "Sprint not found" };
    }

    const deletedSprint = editorState.sprint;
    const remainingSprints = detail?.sprints.filter((sprint) => sprint.id !== deletedSprint.id) ?? [];
    const nextSelectedSprint = remainingSprints[0] ?? null;

    try {
      const result = await deleteSprintAction({
        projectId,
        sprintId: deletedSprint.id,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Failed to delete sprint");
      }

      toast.success("Sprint deleted");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.sprints(projectId),
      });
      // Task cards carry sprint chips: refresh them too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
      router.replace(
        nextSelectedSprint
          ? buildProjectSprintDetailHref(projectSlug, nextSelectedSprint.id, { sprintCode: nextSelectedSprint.code })
          : `/projects/${encodeURIComponent(projectSlug)}?tab=sprints`,
        { scroll: false },
      );
      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to delete sprint",
      };
    }
  }, [detail?.sprints, editorState?.sprint, projectId, projectSlug, queryClient, router]);

  const applyLifecycleResult = useCallback(
    async (
      action: () => Promise<{ success: boolean; sprint?: SprintListItem; error?: string }>,
      successMessage: string,
    ) => {
      setIsMutatingLifecycle(true);
      try {
        const result = await action();
        if (!result.success || !result.sprint) {
          throw new Error(result.error || "The Sprint could not be updated");
        }

        toast.success(successMessage);
        setLifecycleError(null);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.sprints(projectId),
        });
        // Task cards carry sprint chips: refresh them too.
        void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "The Sprint could not be updated";
        setLifecycleError(message);
        toast.error(feedbackError(message, "Action couldn’t finish"));
        return false;
      } finally {
        setIsMutatingLifecycle(false);
      }
    },
    [projectId, queryClient],
  );

  const archiveSelectedSprint = useCallback(async () => {
    if (!selectedSprintId) return false;
    return await applyLifecycleResult(
      () => archiveSprintAction(selectedSprintId, projectId),
      "Sprint archived",
    );
  }, [applyLifecycleResult, projectId, selectedSprintId]);

  const cancelSelectedSprint = useCallback(async () => {
    if (!selectedSprintId) return false;
    return await applyLifecycleResult(
      () => cancelSprintAction(selectedSprintId, projectId),
      "Sprint cancelled",
    );
  }, [applyLifecycleResult, projectId, selectedSprintId]);

  const completeSelectedSprint = useCallback(async (
    unfinished: "keep" | "backlog" | "next_sprint",
    nextSprintId: string | null,
  ) => {
    if (!selectedSprintId) return false;
    return await applyLifecycleResult(
      () => completeSprintAction(selectedSprintId, projectId, { unfinished, nextSprintId }),
      "Sprint completed",
    );
  }, [applyLifecycleResult, projectId, selectedSprintId]);


  if (isLoading && !detail) {
    // Match the dynamic tab fallback during the subsequent data request.
    return <SkeletonSprints />;
  }

  if (isError && !detail) {
    const isForbidden = error instanceof Error && /permission|unauthorized|forbidden/i.test(error.message);
    return (
      <div className="flex h-[500px] flex-col items-center justify-center rounded-[8px] border border-border bg-card px-6 text-center">
        <div className="max-w-md space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            {isForbidden ? "Access restricted" : "Sprint activity could not be loaded"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {isForbidden
              ? "You do not have permission to view sprints for this project."
              : (error instanceof Error ? error.message : "Please try again.")}
          </p>
          {!isForbidden ? (
            <button type="button" onClick={() => void refetch()} className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center justify-center rounded-[5px] border border-border bg-card px-4 text-foreground transition-[background-color,border-color,transform] duration-150 hover:border-input hover:bg-muted active:translate-y-px">Try again</button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!detail || detail.sprints.length === 0) {
    return (
      <div className="nb-empty-state nb-grid-ground py-16" role="status">
        <CalendarDays className="nb-empty-state-icon mb-3" aria-hidden="true" />
        <h3 className="nb-empty-state-title">
          No sprints yet
        </h3>
        <p className="nb-empty-state-desc">
          {permissions.canCreate
            ? "Create the first sprint and this space will turn into a clean execution timeline for the work inside it."
            : "No sprints have been planned yet. Sprints created by project leads will appear here."}
        </p>
        {permissions.canCreate ? (
          <>
            <button
              type="button"
              onClick={() => setEditorState({ mode: "create", sprint: null })}
              className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center gap-2 rounded-[5px] border border-primary bg-primary px-4 text-primary-foreground transition-[background-color,border-color,transform] duration-150 hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:translate-y-px active:border-[var(--primary-active)] active:bg-[var(--primary-active)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Create sprint
            </button>
            {isEditorOpen ? (
              <CreateSprintModal
                projectId={projectId}
                isOpen={isEditorOpen}
                mode="create"
                onClose={() => setEditorState(null)}
                onSubmit={handleCreateSprint}
                sprintCount={0}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="lg:hidden mb-4 flex items-center justify-between gap-3">
        <label htmlFor="mobile-sprint-select" className="sr-only">Select Sprint</label>
        <select
          id="mobile-sprint-select"
          value={selectedSprint?.id ?? ""}
          onChange={(e) => {
            if (e.target.value) {
              router.push(buildProjectSprintDetailHref(projectSlug, e.target.value), { scroll: false });
            }
          }}
          className="nb-touch-target h-9 flex-1 rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {detail.sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.status})
            </option>
          ))}
        </select>
        {permissions.canCreate ? (
          <button
            type="button"
            onClick={() => setEditorState({ mode: "create", sprint: null })}
            className="nb-touch-target inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-[var(--primary-hover)]"
          >
            <Plus className="size-3.5" />
            <span>New</span>
          </button>
        ) : null}
      </div>

      <div className="grid min-h-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <div className="max-lg:hidden">
          <SprintLeftRail
            projectSlug={projectSlug}
            sprints={detail.sprints}
            selectedSprintId={selectedSprint?.id ?? null}
            canCreate={permissions.canCreate}
            onCreate={() => setEditorState({ mode: "create", sprint: null })}
          />
        </div>

        <section className="min-w-0 pb-12">
          {lifecycleError ? (
            <div role="alert" className="mb-4 flex items-center justify-between rounded-[5px] border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
              <span>{lifecycleError}</span>
              <button type="button" onClick={() => setLifecycleError(null)} className="ml-2 font-mono text-[11px] hover:underline">Dismiss</button>
            </div>
          ) : null}
          <div className="flex-1 min-w-0">
            {selectedSprint ? (
              <SprintHeader
                sprint={selectedSprint}
                permissions={permissions}
                isMutatingLifecycle={isMutatingLifecycle}
                onEdit={() => setEditorState({ mode: "edit", sprint: selectedSprint })}
                onComplete={() => setActiveModal("complete")}
                onArchive={() => setActiveModal("archive")}
                onCancel={() => setActiveModal("cancel")}
              />
            ) : null}
            <SprintTimelineContent
              projectSlug={projectSlug}
              projectKey={projectKey}
              sprintReference={selectedSprint?.code ?? null}
              sprint={selectedSprint}
              summary={detail.summary}
              rows={rows}
              hasMore={Boolean(hasNextPage)}
              isLoadingMore={isFetchingNextPage}
              onLoadMore={() => void fetchNextPage()}
            />
          </div>
        </section>
      </div>

      {isEditorOpen ? (
        <CreateSprintModal
          projectId={projectId}
          isOpen={isEditorOpen}
          mode={editorState?.mode ?? "create"}
          onClose={() => setEditorState(null)}
          onSubmit={
            editorState?.mode === "edit"
              ? handleUpdateSprint
              : handleCreateSprint
          }
          onDelete={
            editorState?.mode === "edit" ? handleDeleteSprint : undefined
          }
          sprint={editorState?.sprint ?? null}
          sprintCount={detail.sprints.length}
          deleteImpact={deleteImpact}
        />
      ) : null}

      {activeModal ? (
        <SprintLifecycleModals
          selectedSprint={selectedSprint}
          sprints={detail.sprints}
          summary={detail.summary}
          isMutating={isMutatingLifecycle}
          openModal={activeModal}
          onClose={() => setActiveModal(null)}
          onConfirmComplete={completeSelectedSprint}
          onConfirmArchive={archiveSelectedSprint}
          onConfirmCancel={cancelSelectedSprint}
        />
      ) : null}
    </>
  );
}
