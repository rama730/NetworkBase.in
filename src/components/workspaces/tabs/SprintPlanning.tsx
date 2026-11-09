"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";

import { SprintHeader } from "@/components/workspaces/tabs/sprint/SprintHeader";
import { SprintLeftRail } from "@/components/workspaces/tabs/sprint/SprintLeftRail";
import { SprintTimelineContent } from "@/components/workspaces/tabs/sprint/SprintTimelineContent";
import {
  archiveSprintAction,
  cancelSprintAction,
  completeSprintAction,
  countOpenSprintAssignmentsAction,
  planOneForEachAction,
  createSprintAction,
  deleteSprintAction,
  planSprintSeriesAction,
  updateSprintAction,
} from "@/app/actions/workspace";
import {
  useSprintDetail,
} from "@/hooks/workspaces/useWorkspaceTasksData";
import { queryKeys } from "@/lib/query-keys";
import {
  buildWorkspaceSprintDetailHref,
  type SprintDetailPayload,
  type SprintListItem,
} from "@/lib/workspaces/sprint-detail";

import {
  buildSprintDeleteImpact,
  type SprintEditorSubmission,
  type SprintDeleteImpact,
  type SprintEditorMode,
} from "@/lib/workspaces/sprints";

import CreateSprintModal from "@/components/workspaces/v2/sprints/CreateSprintModal";
import { SprintPeople } from "@/components/workspaces/tabs/sprint/SprintPeople";
import { SprintInsideStrip } from "@/components/workspaces/tabs/sprint/SprintInsideStrip";
import { SprintCalendarButton } from "@/components/workspaces/tabs/sprint/SprintCalendar";
import { SprintAddWork } from "@/components/workspaces/tabs/sprint/SprintAddWork";
import { formatSprintTimelineStamp } from "@/lib/workspaces/sprint-detail";
import { PHASE_WORDS, sprintPath, sprintPhase } from "@/lib/workspaces/sprint-plan";
import { ChildSprintLine, LinkedWorkspacesBlock, RunningOrgSprintPrompt, SprintMaterials, StartNowButton, sprintEmptyLine } from "@/components/organizations/OrgSprintParts";
import { SprintLifecycleModals } from "@/components/workspaces/tabs/sprint/SprintLifecycleModals";
import { SkeletonSprints } from "@/components/workspaces/skeletons/SkeletonSprints";

interface SprintPlanningProps {
  projectId: string;
  projectSlug: string;
  projectName?: string;
  projectKey?: string | null;
  isOwner: boolean;
  isOwnerOrMember: boolean;
  /** An organization admin not on the team (decision 139): the tab says so, as Tasks does. */
  viewingAsAdmin?: boolean;
  initialSprintData?: Promise<SprintDetailPayload | null> | null;
  /** + New → Sprint from the org header (report §18.2). */
  startCreate?: boolean;
  onCreateStarted?: () => void;
}

export type Sprint = SprintListItem;

type SprintEditorState = {
  mode: SprintEditorMode;
  sprint: SprintListItem | null;
  /** "Create linked sprint": the org sprint to start inside (report §15.5). */
  parentSprintId?: string | null;
  /** Board/review report §6: "Add a sprint inside CO1" opens New sprint on that tab, inside that CO. */
  insideOf?: string | null;
} | null;

export default function SprintPlanning({
  projectId,
  projectSlug,
  projectName: _projectName,
  projectKey,
  isOwner,
  isOwnerOrMember,
  viewingAsAdmin = false,
  initialSprintData: initialSprintPromise = null,
  startCreate = false,
  onCreateStarted,
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
  const [addingWork, setAddingWork] = useState(false);

  const routeSprintId = useMemo(() => {
    const match = pathname?.match(/\/(?:workspaces|projects)\/[^/]+\/sprints\/([^/?#]+)/);
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
  // Complete asks about the sprint's open assignments (report §37.2); counted when the dialog opens.
  const [openAssignments, setOpenAssignments] = useState(0);
  useEffect(() => {
    if (activeModal !== "complete" || !selectedSprintId) return;
    let live = true;
    void countOpenSprintAssignmentsAction(selectedSprintId, projectId).then((n) => { if (live) setOpenAssignments(n); }, () => undefined);
    return () => { live = false; setOpenAssignments(0); };
  }, [activeModal, projectId, selectedSprintId]);
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
  // Sprint cleanup §1: one New sprint button; it opens inside the CO you're looking at (the form picks the running one otherwise).
  const startNewSprint = () => setEditorState({ mode: "create", sprint: null,
    insideOf: orgContext?.kind === "org" && selectedSprint ? selectedSprint.parentSprintId ?? selectedSprint.id : null });
  // Organizations and child projects (report §15): editor options, links and materials.
  const orgContext = detail?.org ?? null;
  const editorOrg = orgContext ? { kind: orgContext.kind, orgTitle: orgContext.orgTitle, orgSprints: orgContext.orgSprints, orgType: orgContext.orgType, defaults: orgContext.defaults, termEnd: orgContext.termEnd, followsOrgSprints: orgContext.followsOrgSprints, groupBacklog: orgContext.groupBacklog, children: orgContext.children } : null;
  const existingSprints = useMemo(() => (detail?.sprints ?? []).map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate, status: s.status, parentSprintId: s.parentSprintId ?? null })), [detail?.sprints]);
  const editingFlags = editorState?.sprint ? orgContext?.sprintFlags[editorState.sprint.id] : undefined;
  const refreshSprints = () => void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
  const canManageSprints = permissions.canCreate;
  useEffect(() => {
    if (!startCreate) return;
    if (canManageSprints) setEditorState({ mode: "create", sprint: null });
    onCreateStarted?.();
  }, [startCreate, canManageSprints, onCreateStarted]);
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
    async (data: SprintEditorSubmission) => {
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
        router.replace(buildWorkspaceSprintDetailHref(projectSlug, result.sprint.id, { sprintCode: result.sprint.code }), { scroll: false });
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Couldn’t create sprint",
        };
      }
    },
    [projectId, projectSlug, queryClient, router],
  );

  /** Repeat in the form (decision 9): the series is created together, then the list refreshes. */
  const handleRepeatSprints = useCallback(
    async (input: { prefix: string; count: number; lengthDays: number; startDate: string; goal: string; description: string; autoStart: boolean; parentSprintId?: string | null }) => {
      const result = await planSprintSeriesAction({ projectId, ...input });
      if (!result.success) return { success: false as const, error: result.error };
      toast.success(`${result.created} sprints planned`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprints(projectId) });
      return { success: true as const };
    },
    [projectId, queryClient],
  );

  // Plan one for each (report §18.2): a team sprint inside each planned organization sprint.
  const handlePlanEach = useCallback(
    async (name: string) => {
      const result = await planOneForEachAction({ projectId, name });
      if (!result.success) return { success: false as const, error: result.error };
      toast.success(`${result.created} ${result.created === 1 ? "sprint" : "sprints"} planned`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprints(projectId) });
      return { success: true as const };
    },
    [projectId, queryClient],
  );

  const handleUpdateSprint = useCallback(
    async (data: SprintEditorSubmission) => {
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
          throw new Error(result.error ?? "Couldn’t update sprint");
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
          error: error instanceof Error ? error.message : "Couldn’t update sprint",
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
        throw new Error(result.error ?? "Couldn’t delete sprint");
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
          ? buildWorkspaceSprintDetailHref(projectSlug, nextSelectedSprint.id, { sprintCode: nextSelectedSprint.code })
          : `/workspaces/${encodeURIComponent(projectSlug)}?tab=sprints`,
        { scroll: false },
      );
      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Couldn’t delete sprint",
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
          throw new Error(result.error || "The sprint could not be updated");
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
        const message = error instanceof Error ? error.message : "The sprint could not be updated";
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
      "Sprint canceled",
    );
  }, [applyLifecycleResult, projectId, selectedSprintId]);

  const completeSelectedSprint = useCallback(async (
    unfinished: "keep" | "backlog" | "next_sprint",
    nextSprintId: string | null,
    closeAssignments: boolean,
  ) => {
    if (!selectedSprintId) return false;
    return await applyLifecycleResult(
      () => completeSprintAction(selectedSprintId, projectId, { unfinished, nextSprintId, closeAssignments }),
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
              ? "You do not have permission to view sprints for this workspace."
              : (error instanceof Error ? error.message : "Try again.")}
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
        {/* Report §7.6, §17.3, §18.2: one line for the situation, and one main button. */}
        <h3 className="nb-empty-state-title">
          {sprintEmptyLine(orgContext, permissions.canCreate).title}
        </h3>
        <p className="nb-empty-state-desc">
          {sprintEmptyLine(orgContext, permissions.canCreate).line}
        </p>
        {permissions.canCreate ? (
          <>
            <button
              type="button"
              onClick={() => startNewSprint()}
              className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center gap-2 rounded-[5px] border border-primary bg-primary px-4 text-primary-foreground transition-[background-color,border-color,transform] duration-150 hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:translate-y-px active:border-[var(--primary-active)] active:bg-[var(--primary-active)]"
            >
              <Plus className="h-3.5 w-3.5" />
              {sprintEmptyLine(orgContext, permissions.canCreate).button}
            </button>
            {isEditorOpen ? (
              <CreateSprintModal
                projectId={projectId}
                isOpen={isEditorOpen}
                mode="create"
                onClose={() => setEditorState(null)}
                onSubmit={handleCreateSprint}
                sprintCount={0}
                org={editorOrg}
                initialOrgFields={{ parentSprintId: editorState?.parentSprintId ?? null }}
                existingSprints={existingSprints}
                onRepeat={handleRepeatSprints}
              />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {viewingAsAdmin ? <div className="mb-3"><span className="nb-status" data-status="draft">Viewing as admin</span></div> : null}
      <div className="lg:hidden mb-4 flex items-center justify-between gap-3">
        <label htmlFor="mobile-sprint-select" className="sr-only">Select sprint</label>
        <select
          id="mobile-sprint-select"
          value={selectedSprint?.id ?? ""}
          onChange={(e) => {
            if (e.target.value) {
              router.replace(buildWorkspaceSprintDetailHref(projectSlug, e.target.value), { scroll: false });
            }
          }}
          className="nb-touch-target h-9 min-w-0 flex-1 rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {detail.sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {sprintPath(s, detail.sprints)} ({PHASE_WORDS[sprintPhase(s)].label})
            </option>
          ))}
        </select>
        {permissions.canCreate ? (
          <button
            type="button"
            onClick={() => startNewSprint()}
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
            projectId={projectId}
            showBacklog={isOwnerOrMember}
            projectSlug={projectSlug}
            sprints={detail.sprints}
            selectedSprintId={selectedSprint?.id ?? null}
            canCreate={permissions.canCreate}
            onCreate={() => startNewSprint()}
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
            {orgContext ? <RunningOrgSprintPrompt org={orgContext} canCreate={canManageSprints} onCreateLinked={(parentSprintId) => setEditorState({ mode: "create", sprint: null, parentSprintId })} /> : null}
            {selectedSprint ? (
              <SprintHeader
                sprint={selectedSprint}
                permissions={permissions}
                isMutatingLifecycle={isMutatingLifecycle}
                onEdit={() => setEditorState({ mode: "edit", sprint: selectedSprint })}
                onComplete={() => setActiveModal("complete")}
                onArchive={() => setActiveModal("archive")}
                onCancel={() => setActiveModal("cancel")}
                onAddWork={() => setAddingWork(true)}
                autoStart={orgContext?.sprintFlags[selectedSprint.id]?.autoStart ?? true}
                main={selectedSprint.parentSprintId ? detail.sprints.find((s) => s.id === selectedSprint.parentSprintId) ?? null : null}
                calendar={isOwnerOrMember ? <SprintCalendarButton projectId={projectId} /> : null}
                isMain={orgContext?.kind === "org" && !selectedSprint.parentSprintId}
                startNow={selectedSprint.status === "planning" && permissions.canStart ? <StartNowButton projectId={projectId} sprintId={selectedSprint.id} onStarted={refreshSprints} announceAs={orgContext?.kind === "org" ? selectedSprint.name : null} /> : null}
              />
            ) : null}
            {/* Board/review report §6: a CO's sprints on one strip, with its roll-up. */}
            {selectedSprint && orgContext?.kind === "org" && !selectedSprint.parentSprintId ? (
              <SprintInsideStrip mainName={selectedSprint.name} projectSlug={projectSlug} sprints={detail.children ?? []} summary={detail.summary}
                openAssignments={detail.openAssignments ?? 0} teamsWithoutSprint={orgContext.notLinked?.length ?? 0} />
            ) : null}
            {/* Sprint redesign §5.6: an ended sprint waits to be closed; say so above its work. */}
            {selectedSprint && sprintPhase(selectedSprint) === "ended" ? (
              <div role="status" className="mb-4 rounded-[6px] border border-[var(--status-warning)]/40 bg-[var(--status-warning-soft)] px-4 py-3 text-sm">
                <span className="font-medium">{selectedSprint.name} ended {selectedSprint.endDate ? formatSprintTimelineStamp(selectedSprint.endDate) : ""}.</span>{" "}
                {detail.summary ? `${detail.summary.completedTasks} of ${detail.summary.totalTasks} done. ` : ""}Close it to count what’s done and move what isn’t.
              </div>
            ) : null}
            {selectedSprint && orgContext ? <ChildSprintLine org={orgContext} projectId={projectId} sprintId={selectedSprint.id} canManage={canManageSprints} onFixed={refreshSprints} /> : null}
            {/* Live-fix 31: assignments sit in the work list with their class progress, not in a block of their own. */}
            <SprintTimelineContent
              projectSlug={projectSlug}
              projectKey={projectKey}
              sprintReference={selectedSprint?.code ?? null}
              sprint={selectedSprint}
              canManageAssignments={orgContext?.kind === "org" && permissions.canWrite}
              summary={detail.summary}
              rows={rows}
              hasMore={Boolean(hasNextPage)}
              isLoadingMore={isFetchingNextPage}
              onLoadMore={() => void fetchNextPage()}
            />
            {/* Sprint redesign §5.5, §8.2: People for a workspace, Teams for a class, and the sprint's materials. */}
            {selectedSprint ? (
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {orgContext?.kind === "org"
                  ? (canManageSprints ? <LinkedWorkspacesBlock org={orgContext} projectId={projectId} sprintId={selectedSprint.id} /> : null)
                  : detail.people ? <SprintPeople people={detail.people} unassigned={detail.unassigned ?? { tasks: 0, points: 0 }} /> : null}
                <SprintMaterials projectId={projectId} sprintId={selectedSprint.id} projectSlug={projectSlug} materials={detail.materials ?? []} canManage={canManageSprints} onChanged={refreshSprints} title={orgContext?.kind === "org" ? "Materials" : "Files"} />
              </div>
            ) : null}
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
          org={editorOrg}
          existingSprints={existingSprints}
          onRepeat={editorState?.mode === "edit" ? undefined : handleRepeatSprints}
          onPlanEach={editorState?.mode === "edit" ? undefined : handlePlanEach}
          initialInsideOf={editorState?.insideOf ?? null}
          initialOrgFields={editingFlags ? { autoStart: editingFlags.autoStart, showInChildren: editingFlags.showInChildren, sharedWith: editingFlags.sharedWith, sharedWorkspaceIds: editingFlags.sharedWorkspaceIds, parentSprintId: editingFlags.parentSprintId, notifyOnStart: editingFlags.notifyOnStart } : { parentSprintId: editorState?.parentSprintId ?? null }}
        />
      ) : null}

      {selectedSprint && addingWork ? (
        <SprintAddWork projectId={projectId} sprintId={selectedSprint.id} sprintName={selectedSprint.name} open onClose={() => setAddingWork(false)}
          onAdded={() => { refreshSprints(); void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }); }}
          plannedPoints={detail.summary?.totalStoryPoints ?? 0} velocity={detail.velocity} />
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
          openAssignments={openAssignments}
          onConfirmArchive={archiveSelectedSprint}
          onConfirmCancel={cancelSelectedSprint}
          linkedSprintIds={orgContext?.kind === "child" ? new Set(Object.entries(orgContext.sprintFlags).filter(([, f]) => f.parentSprintId).map(([id]) => id)) : undefined}
        />
      ) : null}
    </>
  );
}
