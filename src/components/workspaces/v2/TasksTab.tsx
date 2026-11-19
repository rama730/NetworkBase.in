"use client";

import { toast, feedbackError } from "@/lib/feedback";
import { filesReturnQuery } from "@/lib/files/task-navigation";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readWorkspaceUnitsAction } from "@/app/actions/child-units";
import { TeamTaskDialog } from "@/components/organizations/TeamTaskDialog";
import { Plus, Check, Search, X, MoreHorizontal, Laptop, ChevronDown } from "lucide-react";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { workflowIcon } from "@/components/workspaces/workflows/workflow-icons";
import { addedTypes, newMenuLine } from "@/lib/workflows/create-rules";
import { FilterChipRow, type FilterChip } from "@/components/ui/FilterChipRow";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { TasksCalendar } from "@/components/workspaces/v2/tasks/TasksCalendar";
import { TasksMatrix } from "@/components/workspaces/v2/tasks/TasksMatrix";
import { ProjectsTable } from "@/components/workspaces/v2/tasks/PlannerParts";
import { PlannerTimeline } from "@/components/workspaces/v2/tasks/PlannerTimeline";
import { EMPTY_FILTERS, filtersFromUrl, filtersToUrl, matchesFilters, setCount, type DueFilter, type TaskFilters as ChipFilters } from "@/lib/workspaces/task-filters";
import { workflowType } from "@/lib/workflows/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { AssignmentFields, ReuseAssignmentContext, ReviewQueue } from "@/components/organizations/AssignmentsPanel";
import type { AssignmentTarget } from "@/lib/organizations/assignment-rules";
import { useTaskCompletionPolicy } from "@/hooks/useTaskCompletionPolicy";
import { useRealtimeTasks } from "@/hooks/useRealtimeTasks";
import {
  createTaskAction,
  getWorkspaceTaskDetailAction,
  readBoardCountsAction,
} from "@/app/actions/workspace";
import { createWorkspaceWorkflowColumnAction, deleteWorkspaceWorkflowColumnAction, getWorkspaceWorkflowColumnsAction, updateWorkspaceWorkflowColumnsAction } from "@/app/actions/workspace/workflow";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { userTopic } from "@/lib/messaging/constants";
import { liveTopics } from "@/lib/realtime/subscriptions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { WorkspaceWorkflowColumn as WorkflowColumn } from "@/lib/db/schema";
import KanbanBoard from "@/components/workspaces/v2/tasks/KanbanBoard";
import TaskFilters, { type TaskFilterScope } from "@/components/workspaces/v2/tasks/TaskFilters";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  useWorkspaceInfiniteTasks,
  useWorkspaceSprints,
  type WorkspaceTaskScope,
} from "@/hooks/workspaces/useWorkspaceTasksData";
import {
  normalizeAssignableMembers,
  normalizeSprintOptions,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/workspaces/task-presentation";
import { buildTaskSubmitPayload } from "@/lib/workspaces/task-draft";
import { patchWorkspaceTaskCaches } from "@/lib/workspaces/task-cache";
import { runningSprint, sprintPath } from "@/lib/workspaces/sprint-plan";
import { SprintPathContext } from "@/components/workspaces/v2/tasks/SprintPathContext";
import {
  getColumnColors,
  WORKFLOW_COLORS,
  type SemanticColor,
} from "@/lib/workspaces/workflow-colors";
import { queryKeys } from "@/lib/query-keys";
import type { TaskPanelTab } from "@/hooks/useTaskPanelResource";
import { OpenInIdeButton, OpenInIdeSheet } from "@/components/workspaces/v2/files-tab/OpenInIdeButton";
import { SkeletonTasks } from "@/components/workspaces/skeletons/SkeletonTasks";
import { useDocumentTitlePrefix } from "@/hooks/useDocumentTitlePrefix";
import { serverFirst } from "@/lib/server-first";
import type { TasksBoot } from "@/lib/workspaces/server/tasks-boot";
import { readUrlParam, useUrlMirror } from "@/lib/navigation/url-state";
import { closeOverlay, openOverlay } from "@/lib/navigation/overlay-history";

const PAGE_NORMALIZED_TASKS_CACHE = new WeakMap<object, TaskSurfaceRecord[]>();

function getNormalizedPageTasks(page: { tasks: any[] }): TaskSurfaceRecord[] {
  let cached = PAGE_NORMALIZED_TASKS_CACHE.get(page);
  if (!cached) {
    cached = (page.tasks || []).map(normalizeTaskSurfaceRecord);
    PAGE_NORMALIZED_TASKS_CACHE.set(page, cached);
  }
  return cached;
}

/** Board view dropdown §6: what an empty view says (admins / everyone else where it differs). */
const EMPTY_VIEW: Record<Exclude<TaskFilterScope, "all">, { title: (admin: boolean) => string; body: (admin: boolean) => string }> = {
  sprint: { title: () => "Nothing in this sprint", body: () => "Plan the sprint on Sprints, or add work to it from the backlog." },
  backlog: { title: () => "Nothing in Backlog", body: () => "Work that isn’t in a sprint waits here." },
  review: { title: () => "Nothing waiting for review", body: (admin) => (admin ? "Hand-ins show here as they come in." : "Work you hand in waits here until it’s reviewed.") },
  assignments: { title: (admin) => (admin ? "No open assignments" : "No assignments due"), body: (admin) => (admin ? "Give the class work with New task → Assignment." : "Assignments you’re given show here.") },
  mine: { title: () => "Nothing assigned to you", body: () => "Tasks and assignments given to you show here." },
};

const CreateTaskModal = dynamic(
  () => import("@/components/workspaces/v2/tasks/CreateTaskModal"),
  { ssr: false },
);
const TaskDetailPanel = dynamic(
  () => import("@/components/workspaces/v2/tasks/TaskDetailPanel"),
  { ssr: false },
);

interface TasksTabProps {
  projectId: string;
  projectSlug?: string;
  projectName?: string;
  currentUserId?: string;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  isOwner?: boolean;
  canEditTasks: boolean;
  /** Comments, files and source messages on tasks are members-only. */
  isProjectMember?: boolean;
  /** Organization admins outside the workspace review its group work (problem 36). */
  reviewsGroupWork?: boolean;
  canManageFiles?: boolean;
  canManageWorkflow: boolean;
  /** A child project: leads and admins also make team tasks (report §16.11). */
  isChildProject?: boolean;
  /** An organization's own board (report §16.1): assignment cards, and In review opens the shared queue. */
  orgId?: string | null;
  initialTasks?: any[];
  /** The first reads the page started on the server for this tab (live-fix phase 1). */
  started?: TasksBoot | null;
  /** + New → Task (problem 4): open New task once, then clear the request. */
  startCreate?: boolean;
  /** + New → Assignment opens New on its Assignment tab (board/review report §4). */
  startCreateKind?: "task" | "assignment";
  onCreateStarted?: () => void;
  /** Decision 74: an organization's dates are entered in its time zone. */
  orgTimeZone?: string | null;
  members?: any[];
  sprints?: any[];
  initialOpenTaskId?: string | null;
  initialPanelTab?: TaskPanelTab | null;
  initialCommentId?: string | null;
  initialFileId?: string | null;
  onInitialTaskOpened?: () => void;
}

export default function TasksTab({
  projectId,
  projectSlug,
  projectName,
  currentUserId,
  currentUserName = null,
  currentUserAvatarUrl = null,
  isOwner = false,
  canEditTasks,
  isProjectMember = true,
  reviewsGroupWork = false,
  canManageFiles = false,
  canManageWorkflow,
  isChildProject = false,
  orgId = null,
  initialTasks = [],
  started = null,
  startCreate = false,
  startCreateKind = "task",
  onCreateStarted,
  orgTimeZone = null,
  members = [],
  sprints = [],
  initialOpenTaskId = null,
  initialPanelTab = null,
  initialCommentId = null,
  initialFileId = null,
  onInitialTaskOpened,
}: TasksTabProps) {
  const completionPolicy = useTaskCompletionPolicy(projectId, started?.policy);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const taskSearchQuery = (searchParams.get("search") || "")
    .trim()
    .slice(0, 100);
  const [searchInput, setSearchInput] = useState(taskSearchQuery);

  useEffect(() => {
    setSearchInput(taskSearchQuery);
  }, [taskSearchQuery]);

  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);
    searchDebounceTimerRef.current = setTimeout(() => {
      const nextParams = new URLSearchParams(window.location.search);
      const trimmed = value.trim();
      if (!trimmed) {
        nextParams.delete("search");
      } else {
        nextParams.set("search", trimmed);
      }
      const nextQuery = nextParams.toString();
      const nextUrl = nextQuery
        ? `${window.location.pathname}?${nextQuery}`
        : window.location.pathname;
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
      }
    }, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);
    };
  }, []);

  const activeAssignableMemberIds = useMemo(
    () =>
      new Set(normalizeAssignableMembers(members).map((member) => member.id)),
    [members],
  );
  // Local State
  // One form (decisions 10, 89): text carried from New task into the assignment or team form.
  const [manyCarry, setManyCarry] = useState<{ title: string; description: string; mode: "everyone" } | null>(null);
  const [scope, setScope] = useState<TaskFilterScope>(() => {
    const requestedScope = searchParams.get("taskScope");
    return requestedScope === "backlog" || requestedScope === "sprint" || requestedScope === "review" || (orgId && (requestedScope === "assignments" || requestedScope === "mine"))
      ? requestedScope
      : "all";
  });

  const [showCreateModal, setShowCreateModal] = useState(false);
  // Board/review report §4: Use again on an assignment's card opens New on the Assignment tab, filled in from it.
  const [reuseFrom, setReuseFrom] = useState<string | null>(null);
  const reuseAssignment = useCallback((masterId: string) => { setReuseFrom(masterId); setShowCreateModal(true); }, []);
  // Student check 7 (decision 87, create_org_tasks): an organization's board takes new tasks from its owners and admins.
  const canCreateTasks = canEditTasks && (!orgId || canManageWorkflow);
  const reviewing = Boolean(orgId && scope === "review" && canManageWorkflow);
  const isDesktop = useMediaQuery("(min-width: 768px)") === true;
  const sprintPaths = useMemo(() => new Map(normalizeSprintOptions(sprints as never[]).map((s) => [s.id, s.name])), [sprints]);
  // Kept apart from startCreateKind: onCreateStarted clears the intent, which would flip New → Assignment back to Task.
  const [createKind, setCreateKind] = useState<"task" | "assignment">("task");
  // Report 38.4 S1: the types the workspace's workflows add; New ▾ lists them and the module shows them as tabs.
  const itemTypes = addedTypes(useAddedWorkflows());
  const [createType, setCreateType] = useState<string | undefined>(undefined);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [createDue, setCreateDue] = useState<string>("");
  const [createPartOf, setCreatePartOf] = useState<{ id: string; title: string } | null>(null);
  // A1.4: "More details" from the Timeline's bubble opens New on Project with the drawn dates.
  const [createDraft, setCreateDraft] = useState<{ title: string; startDate: string } | null>(null);
  // Report 38.5 S2 and part 13: Projects has Timeline · Active · All, remembered per workspace; a phone starts on Active.
  const [projectsView, setProjectsView] = useState<"timeline" | "active" | "all">("timeline");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(`nb:projects-view:${projectId}`); } catch { /* private window */ }
    if (saved === "timeline" || saved === "active" || saved === "all") setProjectsView(saved);
    else if (window.matchMedia("(max-width: 767px)").matches) setProjectsView("active");
  }, [projectId]);
  const pickProjectsView = (v: "timeline" | "active" | "all") => { setProjectsView(v); try { localStorage.setItem(`nb:projects-view:${projectId}`, v); } catch { /* private window */ } };
  // Report 38.5 S1 (A1.1): Board · Calendar for people in the workspace (B11: never the public); ?view= and remembered.
  const viewKey = `nb:tasks-view:${projectId}`;
  const [tasksView, setTasksView] = useState<"board" | "projects" | "calendar" | "matrix">(() => {
    if (typeof window === "undefined") return "board";
    const fromUrl = new URLSearchParams(window.location.search).get("view");
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(viewKey); } catch { /* storage off */ }
    const v = fromUrl ?? saved;
    return v === "calendar" || v === "matrix" || v === "projects" ? v : "board";
  });
  const showViews = isProjectMember && !orgId;
  // Projects only with the Project planner (report 38.5 S1).
  const hasProjects = itemTypes.includes("project");
  const currentView = showViews && (tasksView !== "projects" || hasProjects) ? tasksView : "board";
  useUrlMirror({ view: currentView === "board" ? null : currentView });
  const pickView = (next: "board" | "projects" | "calendar" | "matrix") => {
    setTasksView(next);
    // Report 11.7: a matrix is for personal prioritising, so it starts at Mine.
    if (next === "matrix" && scope === "all") setScope("mine");
    try { window.localStorage.setItem(viewKey, next); } catch { /* storage off */ }
  };
  const openCreate = useCallback((type?: string) => { setCreateType(type); setShowCreateModal(true); }, []);
  // W10: N opens New on Task, Shift + N opens New ▾ (not while typing).
  useEffect(() => {
    if (!canCreateTasks) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "n") return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector("[role=dialog]")) return;
      event.preventDefault();
      if (event.shiftKey && itemTypes.length) setNewMenuOpen(true);
      else openCreate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCreateTasks, itemTypes.length, openCreate]);
  useEffect(() => {
    if (!startCreate) return;
    if (canCreateTasks) { setCreateKind(startCreateKind); setShowCreateModal(true); }
    onCreateStarted?.();
  }, [startCreate, startCreateKind, canCreateTasks, onCreateStarted]);
  const [ideSheetOpen, setIdeSheetOpen] = useState(false);
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionColor, setSectionColor] = useState<SemanticColor>("indigo");
  const [sectionStatus, setSectionStatus] = useState<
    "todo" | "in_progress" | "blocked" | "done"
  >("in_progress");
  const [addSectionError, setAddSectionError] = useState<string | null>(null);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [columnPendingDeletion, setColumnPendingDeletion] =
    useState<WorkflowColumn | null>(null);
  const [isDeletingColumn, setIsDeletingColumn] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskSurfaceRecord | null>(
    null,
  );
  const [editingInitialTab, setEditingInitialTab] =
    useState<TaskPanelTab | null>(null);
  useDocumentTitlePrefix(editingTask?.title);
  const [initialTaskLoadError, setInitialTaskLoadError] = useState<
    string | null
  >(null);
  const handledInitialOpenTaskRef = useRef<string | null>(null);
  const loadingInitialOpenTaskRef = useRef<string | null>(null);
  const isTaskPanelClosingRef = useRef(false);
  const openingTaskIdRef = useRef<string | null>(null);
  const workflowRefreshQueuedRef = useRef(false);
  // Leaving the tab retires a linked task's pending fetch, so its answer can't open the panel or rewrite the URL elsewhere.
  useEffect(() => () => { loadingInitialOpenTaskRef.current = null; }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextParams = new URLSearchParams(window.location.search);
    if (scope === "all") nextParams.delete("taskScope");
    else nextParams.set("taskScope", scope);
    const nextQuery = nextParams.toString();
    const nextUrl = nextQuery
      ? `${window.location.pathname}?${nextQuery}`
      : window.location.pathname;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [scope]);

  useEffect(() => {
    if (openingTaskIdRef.current && openingTaskIdRef.current === initialOpenTaskId) {
      openingTaskIdRef.current = null;
      handledInitialOpenTaskRef.current = initialOpenTaskId;
    }
    if (!initialOpenTaskId) {
      isTaskPanelClosingRef.current = false;
      handledInitialOpenTaskRef.current = null;
      loadingInitialOpenTaskRef.current = null;
      // Back (or any navigation) removed the task from the URL: the drawer follows.
      if (!openingTaskIdRef.current) {
        setEditingTask(null);
        setEditingInitialTab(null);
      }
    }
  }, [initialOpenTaskId]);
  const queryScope: WorkspaceTaskScope = scope;

  // Hook Integration: Smart Fetching (Infinite Loading)
  const {
    data: infiniteData,
    isLoading,
    isError: tasksLoadFailed,
    isFetchNextPageError,
    refetch: refetchTasks,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useWorkspaceInfiniteTasks(
    projectId,
    initialTasks,
    queryScope,
    taskSearchQuery,
    started?.tasks,
  );

  // Flatten pages for filtering and focus strips
  const fetchedTasks = useMemo(() => {
    if (!infiniteData?.pages) return [];
    return infiniteData.pages.flatMap(getNormalizedPageTasks);
  }, [infiniteData?.pages]);
  const hasSprintReferences = useMemo(
    () => fetchedTasks.some((task) => Boolean(task.sprintId)),
    [fetchedTasks],
  );
  const shouldFetchProjectSprints =
    showCreateModal ||
      Boolean(editingTask) ||
      (scope !== "backlog" && hasSprintReferences && sprints.length === 0);
  const { data: projectSprintsData, isFetched: hasFetchedProjectSprints } =
    useWorkspaceSprints(projectId, sprints, shouldFetchProjectSprints);
  const sprintSource = useMemo(() => (hasFetchedProjectSprints ? (projectSprintsData ?? []) : sprints) as Array<{ id: string; name: string; status: string; parentSprintId?: string | null }>,
    [hasFetchedProjectSprints, projectSprintsData, sprints]);
  const sprintOptions = useMemo(() => normalizeSprintOptions(sprintSource), [sprintSource]);
  // Board/review report §6: on an organization's board, Sprint is the running sprint, named in full ("CO1 · Week 3–4") —
  // the sprint inside a CO when one runs, else the CO with its sprints. With nothing running it's all sprint work, as before.
  const runningOnBoard = useMemo(() => {
    const running = orgId ? runningSprint(sprintSource) : null;
    if (!running) return null;
    const ids = running.parentSprintId ? [running.id] : [running.id, ...sprintSource.filter((s) => s.parentSprintId === running.id).map((s) => s.id)];
    return { label: sprintPath(running, sprintSource), ids: new Set(ids) };
  }, [orgId, sprintSource]);
  const sprintById = useMemo(
    () => new Map(sprintOptions.map((sprint) => [sprint.id, sprint])),
    [sprintOptions],
  );

  const [realtimeDeferredTaskId, setRealtimeDeferredTaskId] = useState<
    string | null
  >(null);
  const workflowQueryKey = useMemo(
    () => queryKeys.project.detail.workflow(projectId),
    [projectId],
  );
  const [readWorkflow] = useState(() => serverFirst(started?.workflow, () => getWorkspaceWorkflowColumnsAction(projectId)));
  const workflowQuery = useQuery({
    queryKey: workflowQueryKey,
    queryFn: async () => {
      const result = await readWorkflow();
      if (!result.success || !result.columns) {
        throw new Error(result.error || "Couldn’t load workflow");
      }
      return result.columns as WorkflowColumn[];
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  const workflow = workflowQuery.data ?? [];
  const workflowMutation = useMutation({
    scope: { id: `project-workflow-${projectId}` },
    mutationFn: async (nextWorkflow: WorkflowColumn[]) => {
      const positioned = nextWorkflow.map((column, position) => ({
        ...column,
        position,
      }));
      const result = await updateWorkspaceWorkflowColumnsAction(
        projectId,
        positioned,
      );
      if (!result.success)
        throw new Error(result.error || "Couldn’t save workflow");
      return positioned;
    },
    onMutate: async (nextWorkflow) => {
      await queryClient.cancelQueries({ queryKey: workflowQueryKey });
      const previousWorkflow =
        queryClient.getQueryData<WorkflowColumn[]>(workflowQueryKey);
      queryClient.setQueryData(workflowQueryKey, nextWorkflow);
      return { previousWorkflow };
    },
    onError: (error, _nextWorkflow, context) => {
      if (context?.previousWorkflow)
        queryClient.setQueryData(workflowQueryKey, context.previousWorkflow);
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Couldn’t save workflow", "Couldn’t save workflow"),
      );
    },
  });
  const persistWorkflow = useCallback(
    (nextWorkflow: WorkflowColumn[]) => {
      workflowMutation.mutate(nextWorkflow);
    },
    [workflowMutation],
  );

  const isWorkflowPendingRef = useRef(workflowMutation.isPending);
  isWorkflowPendingRef.current = workflowMutation.isPending;

  useEffect(() => {
    if (!currentUserId) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleWorkflowRefresh = () => {
      if (isWorkflowPendingRef.current) {
        workflowRefreshQueuedRef.current = true;
        return;
      }
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void queryClient.invalidateQueries({ queryKey: workflowQueryKey });
      }, 50);
    };
    const live = subscribeBroadcast(liveTopics.tasks(projectId), (event) => {
      if (event === "workflow.changed") scheduleWorkflowRefresh();
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      live.unsubscribe();
    };
  }, [currentUserId, projectId, queryClient, workflowQueryKey]);

  // An admin's board (report §32.4): copies don't announce on the board topic (decision 145), so a submission
  // notice on the admin's own topic reloads the assignment columns, combined over 2 seconds.
  useEffect(() => {
    if (!orgId || !canManageWorkflow || !currentUserId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const live = subscribeBroadcast(userTopic(currentUserId), (event) => {
      if (event === "notification.changed" && !timer) timer = setTimeout(() => { timer = null; void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }); }, 2_000);
    });
    return () => { live.unsubscribe(); if (timer) clearTimeout(timer); };
  }, [canManageWorkflow, currentUserId, orgId, projectId, queryClient]);

  useEffect(() => {
    if (workflowMutation.isPending || !workflowRefreshQueuedRef.current) return;
    workflowRefreshQueuedRef.current = false;
    void queryClient.invalidateQueries({ queryKey: workflowQueryKey });
  }, [queryClient, workflowMutation.isPending, workflowQueryKey]);

  useRealtimeTasks(projectId, realtimeDeferredTaskId);

  const withSprintContext = useCallback(
    (task: TaskSurfaceRecord) => {
      const normalizedTask = normalizeTaskSurfaceRecord(task);
      if (normalizedTask.sprint || !normalizedTask.sprintId) return task;
      const sprint = sprintById.get(normalizedTask.sprintId);
      if (!sprint) return task;
      return {
        ...task,
        sprint: {
          id: sprint.id,
          name: sprint.name,
          status: sprint.status,
        },
        sprintName: sprint.name,
      } as TaskSurfaceRecord;
    },
    [sprintById],
  );

  const sprintAwareTasks = useMemo(() => {
    return fetchedTasks.map(withSprintContext);
  }, [fetchedTasks, withSprintContext]);

  const openTask = useCallback(
    (
      task: TaskSurfaceRecord | any,
      panelTab: TaskPanelTab | null = null,
      preserveNestedTarget = false,
    ) => {
      isTaskPanelClosingRef.current = false;
      const normalized = withSprintContext(normalizeTaskSurfaceRecord(task));
      setEditingTask(normalized);
      setEditingInitialTab(panelTab);

      if (typeof window !== "undefined") {
        // The open task is in the URL, so the address bar is a working link and Back closes it.
        const nextParams = new URLSearchParams(window.location.search);
        nextParams.set("drawerType", "task");
        nextParams.set("drawerId", normalized.id);
        nextParams.delete("taskId");
        if (panelTab) nextParams.set("panelTab", panelTab);
        else nextParams.delete("panelTab");
        if (!preserveNestedTarget) {
          nextParams.delete("commentId");
          nextParams.delete("fileId");
        }
        const nextUrl = `${window.location.pathname}?${nextParams.toString()}`;
        if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
          openingTaskIdRef.current = normalized.id;
          // One history entry for the drawer; switching tasks replaces it (unified back A3).
          openOverlay("task", (mode) => router[mode](nextUrl, { scroll: false }));
        }
      }
    },
    [withSprintContext, router],
  );
  // A project (or any item off the board) opens from its id: its detail is read, the board's cache is left alone.
  const openTaskById = useCallback((taskId: string) => {
    void getWorkspaceTaskDetailAction(projectId, taskId).then((result) => {
      if (result.success && result.task) openTask(withSprintContext(normalizeTaskSurfaceRecord(result.task)));
      else toast.error(result.error || "Couldn’t open it");
    });
  }, [openTask, projectId, withSprintContext]);

  const closeTaskPanel = useCallback(() => {
    // Dialog close events and the close button can arrive in the same commit.
    // Closing is a single URL transition; duplicate transitions could revisit
    // the drawer URL and briefly remount the panel.
    if (isTaskPanelClosingRef.current) return;
    isTaskPanelClosingRef.current = true;
    setEditingTask(null);
    setEditingInitialTab(null);
    loadingInitialOpenTaskRef.current = null;
    if (typeof window !== "undefined") {
      const nextParams = new URLSearchParams(window.location.search);
      const filesReturn = filesReturnQuery(nextParams.get("filesReturn") ?? "");
      if (filesReturn) {
        router.replace(`${window.location.pathname}?${filesReturn}`, { scroll: false });
        return;
      }
      let changed = false;
      for (const key of [
        "drawerType",
        "drawerId",
        "panelTab",
        "commentId",
        "fileId",
      ]) {
        if (nextParams.has(key)) {
          nextParams.delete(key);
          changed = true;
        }
      }
      if (!changed) return;
      const nextQuery = nextParams.toString();
      const nextUrl = nextQuery
        ? `${window.location.pathname}?${nextQuery}`
        : window.location.pathname;

      // Back closes the drawer when we opened it (the entry behind is the page without it);
      // a deep-linked drawer replaces, so one back from here leaves the page (unified back A3).
      closeOverlay("task", () => router.replace(nextUrl, { scroll: false }));
    }
  }, [router]);

  const handleRenameColumn = useCallback(
    (id: string, newTitle: string) => {
      const updated = workflow.map((column) =>
        column.id === id ? { ...column, title: newTitle } : column,
      );
      void persistWorkflow(updated);
    },
    [persistWorkflow, workflow],
  );

  const handleChangeColor = useCallback(
    (id: string, newColor: SemanticColor) => {
      const updated = workflow.map((column) =>
        column.id === id ? { ...column, accentClassName: newColor } : column,
      );
      void persistWorkflow(updated);
    },
    [persistWorkflow, workflow],
  );

  const handleReorderColumns = useCallback(
    (newOrder: WorkflowColumn[]) => {
      void persistWorkflow(newOrder);
    },
    [persistWorkflow],
  );

  const handleRemoveColumn = useCallback(
    (id: string) => {
      const column = workflow.find((candidate) => candidate.id === id);
      if (column) setColumnPendingDeletion(column);
    },
    [workflow],
  );

  const confirmRemoveColumn = useCallback(async () => {
    if (!columnPendingDeletion || isDeletingColumn) return;
    setIsDeletingColumn(true);
    try {
      const result = await deleteWorkspaceWorkflowColumnAction(
        projectId,
        columnPendingDeletion.id,
      );
      if (!result.success) {
        toast.error(feedbackError(result.error || "Couldn’t delete column", "Couldn’t delete column"));
        return;
      }
      queryClient.setQueryData(
        workflowQueryKey,
        workflow.filter((column) => column.id !== columnPendingDeletion.id),
      );
      setColumnPendingDeletion(null);
    } catch (error) {
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Couldn’t delete column", "Couldn’t delete column"),
      );
    } finally {
      setIsDeletingColumn(false);
    }
  }, [
    columnPendingDeletion,
    isDeletingColumn,
    projectId,
    queryClient,
    workflow,
    workflowQueryKey,
  ]);

  const handleAddColumn = () => {
    setSectionTitle("New column");
    setSectionColor("indigo");
    setSectionStatus("in_progress");
    setAddSectionError(null);
    setIsAddSectionOpen(true);
  };

  const submitNewColumn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = sectionTitle.trim();
    if (!title) {
      setAddSectionError("Enter a column name.");
      return;
    }

    setIsAddingSection(true);
    setAddSectionError(null);
    try {
      const result = await createWorkspaceWorkflowColumnAction({
        projectId,
        title,
        status: sectionStatus,
        accentClassName: sectionColor,
      });
      if (!result.success || !result.column) {
        setAddSectionError(result.error || "Couldn’t add column");
        return;
      }
      queryClient.setQueryData(workflowQueryKey, [
        ...workflow,
        result.column as WorkflowColumn,
      ]);
      setIsAddSectionOpen(false);
    } catch (error) {
      setAddSectionError(
        error instanceof Error ? error.message : "Couldn’t add column",
      );
    } finally {
      setIsAddingSection(false);
    }
  };

  // Search runs on the server (title, description, task key); re-filtering its results here
  // would drop a "KEY-12" match whose title does not contain the text. The Unit filter (child
  // projects, report §14.4) narrows to work assigned to a unit's people.
  // ponytail: filters the loaded pages only, like the count beside the title; a server filter if units grow large.
  const [readUnits] = useState(() => serverFirst(started?.units, () => readWorkspaceUnitsAction(projectId)));
  const { data: units = [] } = useQuery({ queryKey: ["project-units", projectId], queryFn: readUnits, staleTime: 60_000 });
  // Board view dropdown §3, §5: every view's numbers in one read; re-read whenever the board's task lists change
  // (a move, a review, a hand-in, a live event) — no polling.
  const countsKey = useMemo(() => ["project", projectId, "board-counts"] as const, [projectId]);
  const [readCounts] = useState(() => serverFirst(started?.counts, () => readBoardCountsAction(projectId)));
  const { data: boardCounts = null } = useQuery({ queryKey: countsKey, queryFn: async () => { const r = await readCounts(); return r.success ? r.counts : null; }, staleTime: 30_000 });
  useEffect(() => {
    const root = queryKeys.project.detail.tasksRoot(projectId);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const key = event.query.queryKey;
      if (!root.every((part, i) => key[i] === part)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: countsKey }), 400);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [countsKey, projectId, queryClient]);
  const [unitFilter, setUnitFilter] = useState(() => readUrlParam("team") ?? "");
  useUrlMirror({ team: unitFilter || null }); // unified back R3
  const [teamTaskOpen, setTeamTaskOpen] = useState(false);
  const unitMembers = units.find((unit) => unit.id === unitFilter)?.memberIds;
  const inRunning = scope === "sprint" && runningOnBoard ? sprintAwareTasks.filter((task) => Boolean(task.sprintId && runningOnBoard.ids.has(task.sprintId))) : sprintAwareTasks;
  const byTeam = unitMembers ? inRunning.filter((task) => Boolean(task.assigneeId && unitMembers.includes(task.assigneeId))) : inRunning;
  // Report 38.4 S5, W7 (A0.11): the chip row's filters live in the address, so a copied link opens the same view.
  const [chipFilters, setChipFilters] = useState<ChipFilters>(() => (typeof window === "undefined" ? EMPTY_FILTERS : filtersFromUrl(new URLSearchParams(window.location.search))));
  useUrlMirror(filtersToUrl(chipFilters));
  const chipsSet = setCount(chipFilters);
  const filteredTasks = chipsSet ? byTeam.filter((task) => matchesFilters(task, chipFilters, currentUserId ?? null)) : byTeam;
  const assignable = useMemo(() => normalizeAssignableMembers(members ?? []), [members]);
  const filterChips: FilterChip[] = [
    { key: "assignee", name: "Assigned to", multi: true, selected: chipFilters.assignee, onChange: (assignee) => setChipFilters((f) => ({ ...f, assignee })),
      options: [{ value: "me", label: "Me" }, ...assignable.filter((m) => m.id !== currentUserId).map((m) => ({ value: m.id, label: m.label })), { value: "none", label: "Unassigned" }] },
    // The Type chip only when more than one type exists here (report 38.2 S6).
    ...(itemTypes.length ? [{ key: "type", name: "Type", multi: true, selected: chipFilters.type, onChange: (type: string[]) => setChipFilters((f) => ({ ...f, type })),
      options: ["task", ...itemTypes].map((t) => ({ value: t, label: t === "task" ? "Task" : workflowType(t).label, count: byTeam.filter((task) => (task.itemType ?? "task") === t).length })) }] : []),
    { key: "due", name: "Due", multi: false, selected: chipFilters.due ? [chipFilters.due] : [], onChange: (v) => setChipFilters((f) => ({ ...f, due: (v[0] as DueFilter) ?? null })),
      options: [{ value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "none", label: "No date" }] },
    { key: "priority", name: "Priority", multi: true, extra: true, selected: chipFilters.priority, onChange: (priority) => setChipFilters((f) => ({ ...f, priority })),
      options: [{ value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] },
    { key: "sprint", name: "Sprint", multi: true, extra: true, selected: chipFilters.sprint, onChange: (sprint) => setChipFilters((f) => ({ ...f, sprint })),
      options: [...sprintOptions.map((sp) => ({ value: sp.id, label: sp.name })), { value: "none", label: "Backlog" }] },
  ];

  useEffect(() => {
    if (isTaskPanelClosingRef.current) return;
    if (
      !initialOpenTaskId ||
      handledInitialOpenTaskRef.current === initialOpenTaskId
    )
      return;
    if (loadingInitialOpenTaskRef.current === initialOpenTaskId) return;

    const matchesInitialTask = (task: any) => {
      if (!task || !initialOpenTaskId) return false;
      if (task.id === initialOpenTaskId) return true;
      if (initialOpenTaskId.includes("-")) {
        const dashIndex = initialOpenTaskId.lastIndexOf("-");
        const taskNum = parseInt(initialOpenTaskId.slice(dashIndex + 1), 10);
        if (!isNaN(taskNum) && task.taskNumber === taskNum) return true;
      }
      return false;
    };

    if (matchesInitialTask(editingTask)) return;

    const localTask = sprintAwareTasks.find(matchesInitialTask);
    if (localTask) {
      // An older link's fetch may still be in flight; it must not open over this one.
      loadingInitialOpenTaskRef.current = null;
      setInitialTaskLoadError(null);
      handledInitialOpenTaskRef.current = initialOpenTaskId;
      openTask(localTask, initialPanelTab, true);
      onInitialTaskOpened?.();
      return;
    }

    loadingInitialOpenTaskRef.current = initialOpenTaskId;
    const reportInitialTaskLoadFailure = (reason: unknown) => {
      const detail =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Task detail request failed";
      console.warn("Failed to load initial task", {
        projectId,
        taskId: initialOpenTaskId,
        error: detail,
      });
      const message =
        "Couldn’t open the requested task. It may have been moved, deleted, or unavailable.";
      setInitialTaskLoadError(message);
      toast.error(feedbackError(message, "Action couldn’t finish"));
    };

    // The board's list arriving re-runs this effect while the fetch is in flight, so the answer is kept for as long as
    // this link is still the one loading (not dropped by the effect's cleanup); a new link or a close replaces it.
    void getWorkspaceTaskDetailAction(projectId, initialOpenTaskId)
      .then((result) => {
        if (loadingInitialOpenTaskRef.current !== initialOpenTaskId || isTaskPanelClosingRef.current) return;
        if (!result.success || !result.task) {
          reportInitialTaskLoadFailure(result.error || "Task was not returned");
          return;
        }
        const normalizedTask = withSprintContext(
          normalizeTaskSurfaceRecord(result.task),
        );
        patchWorkspaceTaskCaches(queryClient, projectId, normalizedTask, {
          reconcile: false,
        });
        setInitialTaskLoadError(null);
        handledInitialOpenTaskRef.current = initialOpenTaskId;
        openTask(normalizedTask, initialPanelTab, true);
        onInitialTaskOpened?.();
      })
      .catch((error) => {
        if (loadingInitialOpenTaskRef.current !== initialOpenTaskId || isTaskPanelClosingRef.current) return;
        reportInitialTaskLoadFailure(error);
      })
      .finally(() => {
        if (loadingInitialOpenTaskRef.current === initialOpenTaskId) {
          loadingInitialOpenTaskRef.current = null;
        }
      });
  }, [
    initialOpenTaskId,
    initialPanelTab,
    editingTask,
    openTask,
    projectId,
    queryClient,
    sprintAwareTasks,
    withSprintContext,
    onInitialTaskOpened,
  ]);

  const handleCreateTask = useCallback(
    async (data: any): Promise<{ success: boolean; error?: string; code?: string }> => {
      try {
        const result = await createTaskAction(data);
        const created = result.success && "task" in result ? result.task : null;

        if (!created) {
          const error = result.error || "Couldn’t create task";
          return { success: false, error, ...("code" in result && result.code ? { code: result.code } : {}) };
        }

        const normalizedCreatedTask = withSprintContext(
          normalizeTaskSurfaceRecord(created),
        );
        patchWorkspaceTaskCaches(queryClient, projectId, normalizedCreatedTask);
        // A1.3: the Projects list and a project's Work tab read their own queries, so a new project or Part of shows now.
        if (normalizedCreatedTask.itemType === "project") void queryClient.invalidateQueries({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "projects"] });
        if (normalizedCreatedTask.partOfId) void queryClient.invalidateQueries({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "project-work", normalizedCreatedTask.partOfId] });
        if (normalizedCreatedTask.sprintId) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
          });
        }
        return { success: true };
      } catch (err) {
        console.error("Exception creating task", err);
        const error = "An error occurred while creating the task";
        return { success: false, error };
      }
    },
    [projectId, queryClient, withSprintContext],
  );

  // Loading State
  if (isLoading && !initialTasks?.length) {
    // The tab-chunk fallback uses this same layout. Reuse it after the chunk
    // resolves so users see one continuous loading state, not two designs.
    return <SkeletonTasks />;
  }

  return (
    <ReuseAssignmentContext.Provider value={orgId && !isChildProject && canManageWorkflow ? reuseAssignment : null}>
    <div className={cn("flex min-h-0 flex-col", reviewing ? "" : "space-y-4")}>
      {/* Decision 139: an organization admin working in a workspace they aren't on. */}
      {reviewsGroupWork ? <p className="nb-meta"><span className="nb-status" data-status="draft">Viewing as admin</span></p> : null}
      {/* Smaller bug 19: on an organization each assignment says what happens in its Hand in section instead. */}
      {orgId ? null : <p className="nb-meta flex flex-wrap items-center gap-2 text-muted-foreground">
        {completionPolicy.isPending ? "Loading completion workflow…" : completionPolicy.isError ? "Completion workflow unavailable; the server will apply the current workspace setting." : completionPolicy.data?.reviewRequired ? "Marking work as completed sends it to a reviewer. An owner or admin approves it." : "Marking work as done completes it immediately."}
        {completionPolicy.data?.canManage ? <a className="underline" href={`/workspaces/${projectSlug || projectId}?tab=settings&section=tasks-workflow`}>Completion settings</a> : null}
      </p>}
      <div className={cn("w-full shrink-0", reviewing && "hidden")}>
        <div className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className={cn("flex items-center gap-2.5", reviewing && "hidden")}>
            <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
              {currentView === "calendar" ? "Calendar" : currentView === "matrix" ? "Matrix" : currentView === "projects" ? "Projects" : "Board"}
            </h2>
            {currentView === "calendar" || currentView === "projects" ? null : <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border border-border bg-muted/60 px-1.5 font-mono text-[12px] font-medium text-muted-foreground">
              {/* Board view dropdown §3 (D4): the view's real total; while searching or narrowing to a team, what's shown. */}
              {boardCounts && !taskSearchQuery && !unitMembers && !chipsSet ? boardCounts[scope].total : `${filteredTasks.length}${hasNextPage ? "+" : ""}`}
            </span>}
            {taskSearchQuery ? (
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                {`matching “${taskSearchQuery}”`}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 max-md:w-full">
            {/* Instant Search Filter */}
            <div className={cn("relative flex items-center max-md:basis-full", reviewing && "hidden")}>
              <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Filter tasks…"
                className="nb-touch-target h-[34px] w-36 rounded-[5px] border border-border bg-card pl-8 pr-7 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:w-48 transition-all max-md:h-11 max-md:w-full"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => handleSearchChange("")}
                  className="nb-touch-target absolute right-0 inline-flex items-center justify-center text-muted-foreground hover:text-foreground md:right-2"
                  aria-label="Clear task search"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            {/* Filter */}
            <TaskFilters scope={scope} setScope={setScope} organization={Boolean(orgId)} sprintLabel={runningOnBoard?.label} counts={boardCounts} />
            {units.length ? (
              <select aria-label="Team" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}
                className="nb-touch-target h-[34px] rounded-[5px] border border-border bg-card px-2 text-[13px] text-foreground max-md:h-11">
                <option value="">All teams</option>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
              </select>
            ) : null}

            {/* Review UX 3.10: while the queue shows, the board's own buttons step aside; only the filter stays. */}
            {reviewing ? null : <>
            {/* Connect Desktop IDE (desktop row; phones reach it from the ⋯ menu) */}
            <span className="hidden md:contents">
              <OpenInIdeButton
                projectId={projectId}
                projectSlug={projectSlug}
                taskId={editingTask?.id}
                taskNumber={editingTask?.taskNumber ?? null}
              />
            </span>

            {/* Decision 89: team tasks come from New task's Assign to, not a separate button. */}
            {isChildProject && teamTaskOpen ? (
              <TeamTaskDialog projectId={projectId} members={members} open={teamTaskOpen} onOpenChange={(open) => { setTeamTaskOpen(open); if (!open) setManyCarry(null) }} prefill={manyCarry ?? undefined}
                onCreated={() => void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) })} />
            ) : null}

            {/* ⋯: New column on every screen (board view dropdown §6, D3), and on phones the code editor handoff. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="More task actions" className="inline-flex size-11 items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground hover:bg-muted md:size-[34px]" hidden={!canManageWorkflow && isDesktop ? true : undefined}>
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {canManageWorkflow ? (
                  <DropdownMenuItem onSelect={handleAddColumn} disabled={workflow.length >= 6}>
                    <Plus className="size-4" aria-hidden="true" />
                    {workflow.length >= 6 ? "Six columns (maximum)" : "New column"}
                  </DropdownMenuItem>
                ) : null}
                {/* Board view dropdown §6 (D3): a rare action, in ⋯ on every screen; the code editor has its own button on desktop. */}
                <DropdownMenuItem onSelect={() => setIdeSheetOpen(true)} className="md:hidden">
                  <Laptop className="size-4" aria-hidden="true" />
                  Connect your code editor
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* New Task */}
            {canCreateTasks ? (
              <div className="inline-flex">
              <button
                type="button"
                onClick={() => openCreate()}
                aria-keyshortcuts="N"
                className={cn("nb-touch-target inline-flex h-[34px] items-center gap-1.5 rounded-[5px] bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:h-11", itemTypes.length > 0 && "rounded-r-none")}
              >
                <Plus className="size-3.5" />
                <span>New task</span>
              </button>
              {itemTypes.length ? (
                // Report 38.4 S1: the arrow lists every type with where it lands.
                <DropdownMenu open={newMenuOpen} onOpenChange={setNewMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="New: choose a type" aria-keyshortcuts="Shift+N" data-testid="new-type-menu"
                      className="nb-touch-target inline-flex h-[34px] items-center rounded-r-[5px] border-l border-primary-foreground/25 bg-primary px-2 text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:h-11">
                      <ChevronDown className="size-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[220px]">
                    <DropdownMenuItem onSelect={() => openCreate()}>
                      <Plus className="size-4" aria-hidden="true" />
                      <span className="flex flex-col"><span className="text-[13px] font-medium">Task</span><span className="text-[11px] text-muted-foreground">On the Tasks board</span></span>
                    </DropdownMenuItem>
                    {itemTypes.map((type) => {
                      const t = workflowType(type);
                      const Icon = workflowIcon(t.icon);
                      return (
                        <DropdownMenuItem key={type} onSelect={() => openCreate(type)}>
                          <Icon className="size-4" aria-hidden="true" />
                          <span className="flex flex-col"><span className="text-[13px] font-medium">{t.label}</span><span className="text-[11px] text-muted-foreground">{newMenuLine(type)}</span></span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              </div>
            ) : null}

            </>}
            <OpenInIdeSheet open={ideSheetOpen} onOpenChange={setIdeSheetOpen} projectId={projectId} projectSlug={projectSlug} taskId={editingTask?.id} />
          </div>
          {showViews && !reviewing ? (
            <div className="basis-full">
              <UnderlineTabs label="Tasks view" idPrefix="tasks-view" value={currentView} onChange={pickView} className="min-h-10"
                tabs={[{ key: "board" as const, label: "Board" }, ...(hasProjects ? [{ key: "projects" as const, label: "Projects" }] : []), { key: "calendar" as const, label: "Calendar" }, { key: "matrix" as const, label: "Matrix" }]} />
            </div>
          ) : null}
          {/* Report 38.4 S5: the chip row gets its own line, so setting chips never pushes New task down. */}
          {!reviewing ? <div className="basis-full"><FilterChipRow chips={filterChips} onClearAll={() => setChipFilters(EMPTY_FILTERS)} /></div> : null}
        </div>
      </div>

      {tasksLoadFailed || isFetchNextPageError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-[5px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{isFetchNextPageError ? "More tasks could not be loaded." : "Tasks could not be loaded."}</span>
          <button
            type="button"
            onClick={() => void (isFetchNextPageError ? fetchNextPage() : refetchTasks())}
            className="nb-touch-target rounded-[5px] border border-destructive/30 px-2.5 py-1 font-medium hover:bg-destructive/10"
          >
            Retry
          </button>
        </div>
      ) : null}

      {!tasksLoadFailed && taskSearchQuery && filteredTasks.length === 0 && !isLoading ? (
        <div className="flex items-center justify-between gap-3 rounded-[5px] border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span>{`No tasks match “${taskSearchQuery}”.`}</span>
          <button
            type="button"
            onClick={() => {
              handleSearchChange("");
              setScope("all");
            }}
            className="nb-touch-target rounded-[5px] border border-border px-2.5 py-1 font-medium text-foreground hover:bg-muted"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {workflowQuery.error ? (
        <div className="rounded-[5px] border border-destructive/20 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          {workflowQuery.error instanceof Error
            ? workflowQuery.error.message
            : "Couldn’t load task workflow"}
        </div>
      ) : null}

      {initialTaskLoadError ? (
        <div className="rounded-[5px] border border-destructive/20 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          {initialTaskLoadError}
        </div>
      ) : null}

      {/* Main Content. Problem 33: on an organization, In review is the one queue the badge counts, group work included. */}
      {/* Board/review report §2: one line — the queue's filters on the left, the board's tabs on the right. */}
      {reviewing && orgId ? <ReviewQueue orgId={orgId} onChanged={() => void refetchTasks()} onClose={() => setScope("all")}
        tabs={() => <TaskFilters scope={scope} setScope={setScope} organization counts={boardCounts} sprintLabel={runningOnBoard?.label} />} /> : null}
      <div className={cn("flex-1 min-h-0", reviewing && "hidden")}>
        <SprintPathContext.Provider value={sprintPaths}>
        {/* Board view dropdown §6: an empty view says which view it is and what to do next. */}
        {scope !== "all" && !isLoading && filteredTasks.length === 0 && !taskSearchQuery && !unitMembers ? (
          <div className="nb-empty-state nb-grid-ground rounded-[8px] py-14" role="status">
            <h3 className="nb-empty-state-title">{EMPTY_VIEW[scope].title(canManageWorkflow)}</h3>
            <p className="nb-empty-state-desc">{EMPTY_VIEW[scope].body(canManageWorkflow)}</p>
            {scope === "sprint" ? (
              <a href="?tab=sprints" className="nb-ui-label mt-3 inline-flex h-[34px] items-center rounded-[5px] border border-border bg-card px-3 text-foreground hover:bg-muted">Plan a sprint</a>
            ) : (scope === "backlog" || scope === "mine" || (scope === "assignments" && canManageWorkflow)) && canCreateTasks ? (
              <button type="button" onClick={() => setShowCreateModal(true)} className="nb-ui-label mt-3 inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 text-foreground hover:bg-muted">
                <Plus className="size-3.5" aria-hidden="true" />New task
              </button>
            ) : null}
          </div>
        ) : currentView === "projects" ? (
          <div id="tasks-view-panel-projects" role="tabpanel" aria-labelledby="tasks-view-tab-projects">
            <UnderlineTabs label="Projects view" idPrefix="projects-view" value={projectsView} onChange={pickProjectsView} className="mb-3 min-h-9"
              tabs={[{ key: "timeline" as const, label: "Timeline" }, { key: "active" as const, label: "Active" }, { key: "all" as const, label: "All" }]} />
            {projectsView === "timeline" ? (
              <PlannerTimeline projectId={projectId} canEdit={canEditTasks} sprints={sprintOptions} viewerId={currentUserId ?? null} onOpen={openTaskById}
                onMoreDetails={(d) => { setCreateDraft({ title: d.title, startDate: d.startDate }); setCreateDue(d.dueDate); openCreate("project"); }} />
            ) : (
              <ProjectsTable projectId={projectId} mode={projectsView} canEdit={canEditTasks} canPlanSprints={isOwner || canManageWorkflow} members={assignable}
                onOpen={openTaskById} onNew={() => openCreate("project")} />
            )}
          </div>
        ) : currentView === "matrix" ? (
          <div id="tasks-view-panel-matrix" role="tabpanel" aria-labelledby="tasks-view-tab-matrix">
            <TasksMatrix projectId={projectId} tasks={filteredTasks} members={assignable} canEdit={canEditTasks} canPlanSprints={isOwner || canManageWorkflow}
              hasMore={Boolean(hasNextPage)} onOpenTask={(task) => openTask(task)} />
          </div>
        ) : currentView === "calendar" ? (
          <div id="tasks-view-panel-calendar" role="tabpanel" aria-labelledby="tasks-view-tab-calendar">
            <TasksCalendar projectId={projectId} scope={scope} filters={chipFilters} viewerId={currentUserId ?? null} canEdit={canEditTasks}
              onOpenTask={(item) => openTask(item)} onNewOnDay={(day) => { setCreateDue(day); openCreate(); }} />
          </div>
        ) : (
        <KanbanBoard
          projectId={projectId}
          workflow={workflow}
          onRenameColumn={handleRenameColumn}
          onChangeColor={handleChangeColor}
          onRemoveColumn={handleRemoveColumn}
          onReorderColumns={handleReorderColumns}
          tasks={filteredTasks}
          onTaskClick={openTask}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          activeAssignableMemberIds={activeAssignableMemberIds}
          isLeader={canManageWorkflow}
          canEditTasks={canEditTasks}
          currentUserId={currentUserId}
          onTaskDragStateChange={setRealtimeDeferredTaskId}
        />
        )}
        </SprintPathContext.Provider>
      </div>

      {/* Modals & Drawers */}
      {showCreateModal ? (
        <CreateTaskModal
          isOpen={showCreateModal}
          canAssignSprint={isOwner || canManageWorkflow /* owners and admins plan sprints (decision 146, report 38.4 call 4) */}
          // Board/review report §4: an organization picks Assignment from New's tabs; a team workspace keeps its shared task.
          manyOptions={isChildProject && canManageWorkflow ? [{ value: "units", label: "A team, or each team · a shared task" }] : []}
          onAssignMany={(_choice, carry) => {
            setShowCreateModal(false);
            setCreateKind("task");
            setManyCarry({ ...carry, mode: "everyone" });
            setTeamTaskOpen(true);
          }}
          initialKind={reuseFrom ? "assignment" : createKind}
          renderMany={orgId && !isChildProject && canManageWorkflow ? ({ choice, title, description, sprintId, dueDate, onDraft, onDone }) => (
            <AssignmentFields key={reuseFrom ?? "new"} orgId={orgId} timeZone={orgTimeZone} reuseFrom={reuseFrom} prefill={{ title, description, mode: choice as AssignmentTarget["mode"], sprintId, dueDate }} onDraft={onDraft} onDone={onDone}
              onCreated={() => void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) })} />
          ) : undefined}
          onClose={() => { setShowCreateModal(false); setReuseFrom(null); setCreateKind("task"); setCreateType(undefined); setCreateDue(""); setCreatePartOf(null); setCreateDraft(null); }}
          partOf={createPartOf}
          initialDueDate={createDue}
          initialTitle={createDraft?.title}
          initialStartDate={createDraft?.startDate}
          types={itemTypes}
          initialType={createType}
          openedFrom="tasks"
          onCreate={async (value) => {
            const payload = buildTaskSubmitPayload({
              draft: value.draft,
              projectId,
              subtasks: value.subtasks,
              attachments: value.attachments,
            });
            return handleCreateTask({
              ...payload,
              attachments: value.attachments,
            });
          }}
          projectId={projectId}
          projectName={projectName}
          members={members}
          sprints={sprintOptions}
        />
      ) : null}

      {isAddSectionOpen ? (
        <Dialog open={isAddSectionOpen} onOpenChange={setIsAddSectionOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={submitNewColumn}>
              <DialogHeader>
                <DialogTitle>Add column</DialogTitle>
                <DialogDescription>
                  Create a new column for your task workflow.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-1.5">
                  <label htmlFor="add-section-name" className="font-mono text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">
                    Name
                  </label>
                  <input
                    id="add-section-name"
                    autoFocus
                    value={sectionTitle}
                    onChange={(e) => setSectionTitle(e.target.value)}
                    placeholder="e.g. In Review"
                    className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-mono text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {WORKFLOW_COLORS.map((c) => {
                      const cMap = getColumnColors(c);
                      return (
                        <button
                          type="button"
                          key={c}
                          aria-label={`Use ${c} for the new column`}
                          onClick={() => setSectionColor(c)}
                          className={cn(
                            "size-5 rounded-[3px] border border-border/60 flex items-center justify-center transition-transform hover:scale-105",
                            cMap.dot,
                          )}
                        >
                          {sectionColor === c && (
                            <Check className="size-3 text-white" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="section-status" className="font-mono text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">
                    Status
                  </label>
                  <select
                    id="section-status"
                    value={sectionStatus}
                    onChange={(event) =>
                      setSectionStatus(
                        event.target.value as
                          | "todo"
                          | "in_progress"
                          | "blocked"
                          | "done",
                      )
                    }
                    className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="todo">To do</option>
                    <option value="in_progress">In progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Completed</option>
                  </select>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Tasks moved here get this status.
                  </p>
                </div>
                {addSectionError && (
                  <p className="font-mono text-xs text-destructive">{addSectionError}</p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <button
                  type="button"
                  onClick={() => setIsAddSectionOpen(false)}
                  className="nb-touch-target h-[34px] rounded-[5px] border border-border bg-card px-3.5 font-mono text-xs font-medium uppercase tracking-[0.09em] text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingSection}
                  className="nb-touch-target h-[34px] rounded-[5px] bg-primary px-3.5 font-mono text-xs font-medium uppercase tracking-[0.09em] text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isAddingSection ? "Adding..." : "Add column"}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {editingTask && (
        <TaskDetailPanel
          task={editingTask}
          onTaskUpdated={(nextTask) => {
            const sprintAwareTask = withSprintContext(
              normalizeTaskSurfaceRecord(nextTask),
            );
            setEditingTask(sprintAwareTask);
            patchWorkspaceTaskCaches(queryClient, projectId, sprintAwareTask, {
              reconcile: false,
            });
          }}
          onClose={closeTaskPanel}
          initialTab={editingInitialTab}
          projectId={projectId}
          projectSlug={projectSlug}
          canEdit={canEditTasks}
          isMember={isProjectMember}
          reviewsGroupWork={reviewsGroupWork}
          canManageFiles={canManageFiles}
          isOwner={isOwner}
          canPlanSprints={isOwner || canManageWorkflow}
          projectCandidates={sprintAwareTasks}
          onNewInProject={(project) => { setCreatePartOf(project); openCreate(); }}
          onOpenTaskById={openTaskById}
          members={members}
          sprints={sprintOptions}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserAvatarUrl={currentUserAvatarUrl}
          initialCommentId={initialCommentId}
          initialFileId={initialFileId}
          workflowColumns={workflow.map((w) => ({ id: w.id, name: w.title }))}
        />
      )}

      <ConfirmDialog
        open={Boolean(columnPendingDeletion)}
        onOpenChange={(open) => {
          if (!open && !isDeletingColumn) setColumnPendingDeletion(null);
        }}
        title="Delete column"
        description={`Delete “${columnPendingDeletion?.title ?? "this column"}”? The column must be empty; move its tasks to another column first.`}
        confirmLabel={isDeletingColumn ? "Deleting..." : "Delete column"}
        variant="destructive"
        onConfirm={confirmRemoveColumn}
      />
    </div>
    </ReuseAssignmentContext.Provider>
  );
}
