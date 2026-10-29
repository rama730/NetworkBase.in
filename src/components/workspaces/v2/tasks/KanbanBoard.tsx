"use client";

import { completionOutcomeLabel } from "@/lib/workspaces/task-completion-policy";
import { taskCompletionPolicyKey, syncTaskCompletionPolicy } from "@/hooks/useTaskCompletionPolicy";
import React, { useMemo, useState, useEffect, } from "react";
import {
  getColumnColors,
  parseSemanticColor,
  WORKFLOW_COLORS,
  type SemanticColor,
} from "@/lib/workspaces/workflow-colors";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MoreHorizontal,
  Pencil,
  Trash2,
  GripVertical,
  Palette,
} from "lucide-react";
import { TaskCard, Task } from "./TaskCard";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  DragCancelEvent,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { moveTaskToWorkflowColumnAction } from "@/app/actions/task";
import { toast, feedbackError } from "@/lib/feedback";
import { patchWorkspaceTaskCaches } from "@/lib/workspaces/task-cache";
import { taskSurfaceVersionMs } from "@/lib/workspaces/task-presentation";
import {
  buildTaskPreviewColumns,
  getTaskWorkflowColumnId,
  type TaskDragPreview,
} from "@/lib/workspaces/task-drag-preview";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

type TaskDropTarget = Omit<TaskDragPreview, "taskId">;

const SortableTaskCard = React.memo(function SortableTaskCard({
  task,
  onClick,
  activeAssignableMemberIds,
  isLeader,
  canEditTasks,
  currentUserId,
  isDragLocked,
}: {
  task: Task;
  onClick?: (task: Task) => void;
  activeAssignableMemberIds?: Set<string>;
  isLeader?: boolean;
  canEditTasks?: boolean;
  currentUserId?: string;
  isDragLocked?: boolean;
}) {
  // Mirrors the server rule in moveTaskToWorkflowColumnAction.
  const canDrag =
    !isDragLocked &&
    !!canEditTasks &&
    (isLeader || !task.assigneeId || task.assigneeId === currentUserId);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "Task", task },
    disabled: !canDrag,
    transition: {
      duration: 180,
      easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging
      ? undefined
      : (transition ?? "transform 180ms cubic-bezier(.2,.8,.3,1)"),
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="relative touch-manipulation"
      >
        <div className="invisible">
          <TaskCard task={task} showStatus={false} />
        </div>
        <div className="absolute inset-0 rounded-[8px] border-2 border-dashed border-border bg-muted/40" />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      style={style}
      className="will-change-transform"
    >
      <TaskCard
        task={task}
        onClick={onClick}
        activeAssignableMemberIds={activeAssignableMemberIds}
        showStatus={false}
        dragHandleRef={setActivatorNodeRef}
        dragAttributes={canDrag ? attributes : undefined}
        dragListeners={canDrag ? listeners : undefined}
      />
    </div>
  );
});

const KanbanColumn = React.memo(
  function KanbanColumn({
    col,
    colTasks,
    visibleLimit,
    onTaskClick,
    activeAssignableMemberIds,
    setVisibleCounts,
    STEP,
    onRenameColumn,
    onChangeColor,
    onRemoveColumn,
    onMoveColumn,
    columnIndex,
    columnCount,
    isLeader,
    canEditTasks,
    currentUserId,
    isTaskDragLocked,
  }: any) {
    const canReorderColumns = isLeader;

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: col.id,
      data: { type: "Column", column: col },
      disabled: !canReorderColumns,
      transition: {
        duration: 180,
        easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
      },
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition: isDragging
        ? undefined
        : (transition ?? "transform 180ms cubic-bezier(.2,.8,.3,1)"),
    };
    const visibleTasks = colTasks.slice(0, visibleLimit);
    const visibleTaskIds = useMemo(() => visibleTasks.map((t: Task) => t.id), [visibleTasks]);
    const hasMoreInColumn = colTasks.length > visibleLimit;

    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(col.title);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const handleBlur = () => {
      setIsEditing(false);
      if (title !== col.title && title.trim().length > 0) {
        onRenameColumn(col.id, title.trim());
      } else {
        setTitle(col.title); // revert if empty
      }
    };

    const handleColorClick = (c: any) => {
      onChangeColor(col.id, c);
      setDropdownOpen(false);
    };

    const colors = getColumnColors(col.accentClassName);

    return (
      <div
        ref={setNodeRef}
        style={style}
        role="region"
        aria-label={`${col.title} column, ${colTasks.length} tasks`}
        className={cn(
          "group h-max w-[min(300px,calc(100vw-48px))] shrink-0 rounded-[8px] border flex flex-col transition-colors max-md:snap-start md:w-[300px]",
          "bg-muted border-border",
          isDragging && "opacity-45 border-primary/30",
        )}
      >
        <div
          className={cn(
            "p-3 shrink-0 flex items-center justify-between border-b rounded-t-[8px]",
            colors.border,
          )}
        >
          <div className="flex items-center gap-2 flex-1">
            {isEditing ? (
              <input
                autoFocus
                aria-label="Section title"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBlur();
                  if (e.key === "Escape") {
                    setTitle(col.title);
                    setIsEditing(false);
                  }
                }}
                className="text-xs font-semibold text-foreground bg-transparent border-none outline-none w-full"
              />
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <h3
                  className={cn(
                    "text-xs font-semibold truncate max-w-[150px]",
                    colors.text,
                  )}
                  title={col.title}
                >
                  {col.title}
                </h3>
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border px-1 font-mono text-[10px] font-semibold max-md:text-[11px]",
                    colors.bg.replace("/50", ""),
                    colors.border,
                    colors.text,
                  )}
                >
                  {colTasks.length}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isLeader ? (
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger aria-label={`Options for ${col.title}`} className="nb-touch-target size-7 flex items-center justify-center rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isEditing && isLeader && (
                    <>
                      <DropdownMenuItem
                        className="cursor-pointer text-xs font-medium"
                        onSelect={(e) => {
                          e.preventDefault();
                          setIsEditing(true);
                          setDropdownOpen(false);
                        }}
                      >
                        <Pencil className="size-3.5 mr-2" />
                        Rename section
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="cursor-pointer text-xs font-medium">
                          <Palette className="size-3.5 mr-2" />
                          Change color
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent className="w-40">
                            <div className="p-2 grid grid-cols-4 gap-2">
                              {WORKFLOW_COLORS.map((c) => {
                                const cMap = getColumnColors(c);
                                const isSelected =
                                  parseSemanticColor(
                                    col.accentClassName || "zinc",
                                  ) === c;
                                return (
                                  <button
                                    type="button"
                                    key={c}
                                    aria-label={`Use ${c} for ${col.title}`}
                                    aria-pressed={isSelected}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleColorClick(c);
                                    }}
                                    className={cn(
                                      "size-6 min-h-6 min-w-6 rounded-[3px] border border-border/60 cursor-pointer flex items-center justify-center transition-all hover:scale-105",
                                      cMap.dot,
                                      isSelected &&
                                        "ring-2 ring-primary ring-offset-1 ring-offset-background scale-105",
                                    )}
                                  >
                                    {isSelected && (
                                      <Check
                                        className="size-3 text-white drop-shadow-sm"
                                        strokeWidth={2.5}
                                      />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                    </>
                  )}
                  {canReorderColumns && onMoveColumn ? (
                    <>
                      {/* Below md the drag handle is hidden; menu moves replace it (touch drag competes with board scroll). */}
                      <DropdownMenuItem className="cursor-pointer text-xs font-medium md:hidden" disabled={columnIndex <= 0} onSelect={() => onMoveColumn(col.id, -1)}>
                        <ArrowLeft className="size-3.5 mr-2" />
                        Move left
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer text-xs font-medium md:hidden" disabled={columnIndex >= columnCount - 1} onSelect={() => onMoveColumn(col.id, 1)}>
                        <ArrowRight className="size-3.5 mr-2" />
                        Move right
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {!col.isDefault && isLeader && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive cursor-pointer text-xs font-medium"
                      onClick={() => onRemoveColumn(col.id)}
                    >
                      <Trash2 className="size-3.5 mr-2" />
                      Remove section
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canReorderColumns && (
              <button
                type="button"
                aria-label={`Reorder ${col.title}`}
                {...attributes}
                {...listeners}
                className="nb-touch-target size-7 flex items-center justify-center rounded-[5px] hover:bg-muted text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing transition-colors max-md:hidden"
              >
                <GripVertical className="size-4" />
              </button>
            )}
          </div>
        </div>

        {col.status === "done" && colTasks.length > 0 ? <p className="nb-meta px-3 pt-2 text-muted-foreground" aria-live="polite">
          {colTasks.filter((task: Task) => task.reviewStatus !== "pending").length} completed · {colTasks.filter((task: Task) => task.reviewStatus === "pending").length} in review
        </p> : null}
        <div className="p-3 space-y-3 min-h-[150px] flex-1 flex flex-col">
          <SortableContext
            items={visibleTaskIds}
            strategy={verticalListSortingStrategy}
          >
            {visibleTasks.length > 0 ? (
              <>
                {visibleTasks.map((task: Task) => (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    onClick={onTaskClick}
                    activeAssignableMemberIds={activeAssignableMemberIds}
                    isLeader={isLeader}
                    canEditTasks={canEditTasks}
                    currentUserId={currentUserId}
                    isDragLocked={isTaskDragLocked}
                  />
                ))}
                {hasMoreInColumn && (
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCounts((prev: any) => ({
                        ...prev,
                        [col.id]: Math.min(
                          colTasks.length,
                          prev[col.id] + STEP,
                        ),
                      }))
                    }
                    className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Show more
                  </button>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border/60 rounded-[6px] p-4 text-center nb-grid-ground bg-card">
                <p className="text-xs font-medium text-foreground">
                  {col.emptyTitle || "No tasks here"}
                </p>
                {/* Only people who can move cards are told to drag them. */}
                {canEditTasks ? (
                  <p className="mt-1 text-[11px] text-muted-foreground max-w-[200px]">
                    {col.emptyDescription || "Drag tasks into this section"}
                  </p>
                ) : null}
              </div>
            )}
          </SortableContext>
        </div>
      </div>
    );
  },
);

interface KanbanBoardProps {
  projectId: string;
  workflow: any[];
  tasks: Task[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  activeAssignableMemberIds?: Set<string>;
  isLeader?: boolean;
  canEditTasks?: boolean;
  currentUserId?: string;
  onTaskDragStateChange?: (taskId: string | null) => void;
  onRenameColumn: (id: string, newTitle: string) => void;
  onChangeColor: (id: string, newColor: SemanticColor) => void;
  onRemoveColumn: (id: string) => void;
  onReorderColumns: (newOrder: any[]) => void;
  onTaskClick: (task: Task) => void;
  fetchNextPage: () => void;
}

export default function KanbanBoard({
  projectId,
  workflow,
  tasks: initialTasks,
  hasNextPage,
  isFetchingNextPage,
  activeAssignableMemberIds,
  isLeader,
  canEditTasks,
  currentUserId,
  onTaskDragStateChange,
  onRenameColumn,
  onChangeColor,
  onRemoveColumn,
  onReorderColumns,
  onTaskClick,
  fetchNextPage,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const taskMovePendingRef = React.useRef(false);

  // Server lists win, except over a local copy that is newer (a settled move the refetch predates)
  // or the card whose move is still in flight.
  useEffect(() => {
    setTasks((current) => {
      const localById = new Map(current.map((task) => [task.id, task]));
      return initialTasks.map((task) => {
        const local = localById.get(task.id);
        if (!local) return task;
        const localVersion = taskSurfaceVersionMs(local);
        const serverVersion = taskSurfaceVersionMs(task);
        return localVersion > serverVersion || (taskMovePendingRef.current && localVersion === serverVersion && local.position !== task.position)
          ? local
          : task;
      });
    });
  }, [initialTasks]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskWidth, setActiveTaskWidth] = useState<number | null>(null);
  const [activeColumn, setActiveColumn] = useState<any | null>(null);
  const [previewMove, setPreviewMove] = useState<TaskDragPreview | null>(null);
  const queryClient = useQueryClient();
  const dragTasksRef = React.useRef<Task[] | null>(null);
  const [isTaskMovePending, setIsTaskMovePending] = useState(false);

  const DEFAULT_VISIBLE = 20;
  const STEP = 20;
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>(
    {},
  );



  const columns = useMemo(
    () => buildTaskPreviewColumns(tasks, workflow, previewMove),
    [previewMove, tasks, workflow],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch drags need a press-and-hold so a swipe scrolls the board instead of grabbing a card.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const moveColumn = React.useCallback(
    (columnId: string, direction: -1 | 1) => {
      const from = workflow.findIndex((column) => column.id === columnId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= workflow.length) return;
      onReorderColumns(arrayMove(workflow, from, to));
    },
    [onReorderColumns, workflow],
  );

  const getWorkflowColumnId = React.useCallback(
    (task: Task) => getTaskWorkflowColumnId(task, workflow),
    [workflow],
  );

  const resolveTaskDropTarget = React.useCallback(
    (over: DragOverEvent["over"]): TaskDropTarget | null => {
      if (!over) return null;
      if (over.data.current?.type === "Task") {
        const overTask =
          (over.data.current.task as Task | undefined) ??
          tasks.find((task) => task.id === over.id);
        const columnId = overTask ? getWorkflowColumnId(overTask) : null;
        return columnId
          ? { columnId, beforeTaskId: overTask?.id ?? null }
          : null;
      }

      if (over.data.current?.type === "Column") {
        const overColumn = workflow.find((column) => column.id === over.id);
        return overColumn
          ? { columnId: overColumn.id, beforeTaskId: null }
          : null;
      }

      return null;
    },
    [getWorkflowColumnId, tasks, workflow],
  );

  function onDragStart(event: DragStartEvent) {
    dragTasksRef.current = tasks;
    if (event.active.data.current?.type === "Task") {
      const task = event.active.data.current.task as Task;
      setActiveTask(task);
      const targetEl = event.activatorEvent?.target as HTMLElement | null;
      const cardEl =
        targetEl?.closest?.('[data-testid="task-card"]') ??
        (typeof document !== "undefined"
          ? document.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`)
          : null);
      const measuredWidth = cardEl?.getBoundingClientRect().width;
      setActiveTaskWidth(
        measuredWidth && measuredWidth > 0 ? measuredWidth : 276,
      );
      setPreviewMove(null);
      onTaskDragStateChange?.(task.id);
    }
    if (event.active.data.current?.type === "Column") {
      setActiveColumn(event.active.data.current.column);
    }
  }

  function clearDragSnapshot() {
    dragTasksRef.current = null;
  }

  function restoreDraggedTask() {
    if (dragTasksRef.current) setTasks(dragTasksRef.current);
    queryClient.invalidateQueries({
      queryKey: queryKeys.project.detail.tasksRoot(projectId),
    });
    clearDragSnapshot();
  }

  function onDragOver(event: DragOverEvent) {
    if (event.active.data.current?.type !== "Task") return;
    // The transient slot can become the closest collision after it moves.
    // Keep the last meaningful target instead of clearing and re-adding it.
    if (event.active.id === event.over?.id) return;
    const nextTarget = resolveTaskDropTarget(event.over);
    const nextPreview = nextTarget
      ? { taskId: String(event.active.id), ...nextTarget }
      : null;
    setPreviewMove((current) =>
      current?.taskId === nextPreview?.taskId &&
      current?.columnId === nextPreview?.columnId &&
      current?.beforeTaskId === nextPreview?.beforeTaskId
        ? current
        : nextPreview,
    );
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    setActiveTaskWidth(null);
    setActiveColumn(null);
    const { active, over } = event;
    const dragPreview =
      previewMove?.taskId === String(active.id) ? previewMove : null;
    setPreviewMove(null);
    if (!over) {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    if (
      active.data.current?.type === "Column" &&
      over.data.current?.type === "Column"
    ) {
      const activeId = active.id;
      const overId = over.id;
      if (activeId === overId) return;
      const activeIndex = workflow.findIndex((w) => w.id === activeId);
      const overIndex = workflow.findIndex((w) => w.id === overId);
      if (activeIndex < 0 || overIndex < 0) return;
      const newWorkflow = arrayMove(workflow, activeIndex, overIndex);
      onReorderColumns(newWorkflow);
      clearDragSnapshot();
      return;
    }

    if (active.data.current?.type !== "Task") {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    if (taskMovePendingRef.current) {
      restoreDraggedTask();
      onTaskDragStateChange?.(null);
      toast.error("Wait for the current task move to finish");
      return;
    }

    const target =
      dragPreview ??
      (active.id === over.id ? null : resolveTaskDropTarget(over));
    const snapshot = dragTasksRef.current ?? tasks;
    const draggedTask = snapshot.find((task) => task.id === active.id);
    const targetColumn = target
      ? workflow.find((column) => column.id === target.columnId)
      : null;
    if (!draggedTask || !target || !targetColumn) {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    // Display order (position, then newest), exactly as the board renders it.
    const displayColumns = buildTaskPreviewColumns(snapshot, workflow, null);
    const destinationTasks = (displayColumns[target.columnId] ?? []).filter(
      (task: Task) => task.id !== draggedTask.id,
    );
    const beforeIndex = target.beforeTaskId
      ? destinationTasks.findIndex((task) => task.id === target.beforeTaskId)
      : destinationTasks.length;
    const insertionIndex =
      beforeIndex < 0 ? destinationTasks.length : beforeIndex;
    const previousTask = destinationTasks[insertionIndex - 1];
    const nextTask = destinationTasks[insertionIndex];
    const sourceColumnId = getWorkflowColumnId(draggedTask);
    const sourceTasks: Task[] = sourceColumnId ? displayColumns[sourceColumnId] ?? [] : [];
    const sourceIndex = sourceTasks.findIndex(
      (task) => task.id === draggedTask.id,
    );
    const unchanged =
      sourceColumnId === target.columnId &&
      ((!target.beforeTaskId && sourceIndex === sourceTasks.length - 1) ||
        target.beforeTaskId === sourceTasks[sourceIndex + 1]?.id);

    if (unchanged) {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    // ponytail: float64 gaps avoid rewriting every card. ceiling: about 50 repeated midpoint moves between the same two cards. upgrade: Lexorank or a column rebalance when precision runs out.
    const POSITION_GAP = 60000;
    const newPosition =
      previousTask && nextTask
        ? ((previousTask.position ?? 0) + (nextTask.position ?? 0)) / 2
        : nextTask
          ? (nextTask.position ?? 0) + POSITION_GAP
          : previousTask
            ? (previousTask.position ?? 0) - POSITION_GAP
            : (draggedTask.position ?? 0);
    // ponytail: equal neighbours (precision exhausted) cannot take a midpoint. ceiling: ~50 repeated
    // drops between the same two cards. upgrade: a server-side column rebalance.
    if ((previousTask && newPosition === previousTask.position) || (nextTask && newPosition === nextTask.position)) {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      toast.error("Choose another position");
      return;
    }
    if (draggedTask.reviewStatus === "pending" && targetColumn.status !== "done") {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      toast.error("Task needs review");
      return;
    }
    const updatedTask = {
      ...draggedTask,
      reviewStatus: targetColumn.status === "done" && draggedTask.status !== "done"
        ? queryClient.getQueryData<{ reviewRequired: boolean }>(taskCompletionPolicyKey(projectId))?.reviewRequired ? "pending" as const : "none" as const
        : draggedTask.reviewStatus,
      workflowColumnId: targetColumn.id,
      status: targetColumn.status,
      position: newPosition,
    };

    setTasks((current) =>
      current.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
    );
    patchWorkspaceTaskCaches(queryClient, projectId, updatedTask, {
      reconcile: false,
    });

    taskMovePendingRef.current = true;
    setIsTaskMovePending(true);
    try {
      const result = await moveTaskToWorkflowColumnAction(
        updatedTask.id,
        projectId,
        targetColumn.id,
        newPosition,
        draggedTask.updatedAt,
      );
      if (!result.success) {
        setTasks((current) =>
          current.map((task) =>
            task.id === draggedTask.id ? draggedTask : task,
          ),
        );
        patchWorkspaceTaskCaches(queryClient, projectId, draggedTask, {
          reconcile: false,
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.tasksRoot(projectId),
        });
        toast.error(feedbackError("Couldn’t move task: " + result.error, "Couldn’t move task: "));
        return;
      }
      syncTaskCompletionPolicy(queryClient, projectId, result);
      if (targetColumn.status === "done" && draggedTask.status !== "done") toast.success(completionOutcomeLabel(result.reviewStatus));
      const persistedTask = result.updatedAt
        ? {
            ...updatedTask,
            updatedAt: result.updatedAt,
            reviewStatus: result.reviewStatus ?? updatedTask.reviewStatus,
            completedAt: result.outcome === "completed" ? result.updatedAt : updatedTask.status !== "done" || result.reviewStatus === "pending" ? null : updatedTask.completedAt,
            ...(result.outcome === "submitted" ? { reviewSubmittedAt: result.updatedAt } : {}),
          }
        : updatedTask;
      setTasks((current) =>
        current.map((task) =>
          task.id === persistedTask.id ? persistedTask : task,
        ),
      );
      patchWorkspaceTaskCaches(queryClient, projectId, persistedTask, {
        reconcile: false,
      });
    } catch (error) {
      setTasks((current) =>
        current.map((task) =>
          task.id === draggedTask.id ? draggedTask : task,
        ),
      );
      patchWorkspaceTaskCaches(queryClient, projectId, draggedTask, {
        reconcile: false,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.tasksRoot(projectId),
      });
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Couldn’t move task", "Couldn’t move task"),
      );
    } finally {
      taskMovePendingRef.current = false;
      setIsTaskMovePending(false);
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
    }
  }

  function onDragCancel(_: DragCancelEvent) {
    setActiveTask(null);
    setActiveTaskWidth(null);
    setActiveColumn(null);
    setPreviewMove(null);
    clearDragSnapshot();
    onTaskDragStateChange?.(null);
  }

  const boardRootRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const prevWorkflowLengthRef = React.useRef(workflow.length);
  const isDraggingAnyRef = React.useRef(false);
  isDraggingAnyRef.current = Boolean(activeTask || activeColumn);

  useEffect(() => {
    if (workflow.length > prevWorkflowLengthRef.current) {
      // A new section was added, scroll to the end smoothly
      // The DOM is already updated by the time useEffect runs.
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          left: scrollContainerRef.current.scrollWidth,
          behavior: "smooth",
        });
      }
    }
    prevWorkflowLengthRef.current = workflow.length;
  }, [workflow.length]);

  useEffect(() => {
    const el = boardRootRef.current;
    if (!el) return;

    let touchStartY = 0;
    let touchStartX = 0;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey) return;
      if (isDraggingAnyRef.current) return;

      const rawDeltaY = event.deltaY;
      const rawDeltaX = event.deltaX;

      if (Math.abs(rawDeltaY) <= Math.abs(rawDeltaX)) return;

      const routeRoot =
        el.closest<HTMLElement>('[data-scroll-root="route"]') ??
        document.querySelector<HTMLElement>('[data-scroll-root="route"]');
      if (!routeRoot) return;

      const maxScroll = routeRoot.scrollHeight - routeRoot.clientHeight;
      if (maxScroll <= 0) return;

      const deltaY =
        event.deltaMode === 1
          ? rawDeltaY * 40
          : event.deltaMode === 2
            ? rawDeltaY * window.innerHeight
            : rawDeltaY;

      const canScrollDown = deltaY > 0 && routeRoot.scrollTop < maxScroll;
      const canScrollUp = deltaY < 0 && routeRoot.scrollTop > 0;
      if (!canScrollDown && !canScrollUp) return;

      event.preventDefault();
      routeRoot.scrollTop = Math.max(
        0,
        Math.min(maxScroll, routeRoot.scrollTop + deltaY),
      );
    };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      touchStartY = touch.clientY;
      touchStartX = touch.clientX;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (isDraggingAnyRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;

      const deltaY = touchStartY - touch.clientY;
      const deltaX = touchStartX - touch.clientX;
      touchStartY = touch.clientY;
      touchStartX = touch.clientX;

      if (Math.abs(deltaY) <= Math.abs(deltaX) || Math.abs(deltaY) < 1) return;

      const routeRoot =
        el.closest<HTMLElement>('[data-scroll-root="route"]') ??
        document.querySelector<HTMLElement>('[data-scroll-root="route"]');
      if (!routeRoot) return;

      const maxScroll = routeRoot.scrollHeight - routeRoot.clientHeight;
      if (maxScroll <= 0) return;

      const canScrollDown = deltaY > 0 && routeRoot.scrollTop < maxScroll;
      const canScrollUp = deltaY < 0 && routeRoot.scrollTop > 0;
      if (!canScrollDown && !canScrollUp) return;

      event.preventDefault();
      routeRoot.scrollTop = Math.max(
        0,
        Math.min(maxScroll, routeRoot.scrollTop + deltaY),
      );
    };

    el.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    el.addEventListener("touchstart", handleTouchStart, { passive: true, capture: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false, capture: true });

    return () => {
      el.removeEventListener("wheel", handleWheel, { capture: true });
      el.removeEventListener("touchstart", handleTouchStart, { capture: true });
      el.removeEventListener("touchmove", handleTouchMove, { capture: true });
    };
  }, []);

  return (
    <div ref={boardRootRef} className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          announcements: {
            onDragStart({ active }) {
              const activeId = String(active.id);
              const isCol = workflow.some((w) => w.id === activeId);
              if (isCol) {
                const col = workflow.find((w) => w.id === activeId);
                return `Picked up column ${col?.title ?? activeId}.`;
              }
              const task = tasks.find((t) => t.id === activeId);
              return `Picked up task ${task?.title ?? activeId}.`;
            },
            onDragOver({ active, over }) {
              if (!over) return;
              const overId = String(over.id);
              const col = workflow.find((w) => w.id === overId);
              const colName = col?.title ?? overId;
              const task = tasks.find((t) => t.id === String(active.id));
              return `Moved task ${task?.title ?? "item"} over column ${colName}.`;
            },
            onDragEnd({ active, over }) {
              if (!over) return "Dropped item.";
              const activeId = String(active.id);
              const isCol = workflow.some((w) => w.id === activeId);
              if (isCol) {
                const col = workflow.find((w) => w.id === activeId);
                return `Dropped column ${col?.title ?? activeId}.`;
              }
              const task = tasks.find((t) => t.id === activeId);
              const overCol = workflow.find((w) => w.id === String(over.id));
              return `Dropped task ${task?.title ?? activeId} into ${overCol?.title ?? "column"}.`;
            },
            onDragCancel() {
              return "Dragging was canceled.";
            },
          },
        }}
        autoScroll={{
          acceleration: 12,
          interval: 5,
          threshold: { x: 0.14, y: 0.14 },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext
          items={workflow.map((w) => w.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={scrollContainerRef}
            className="flex items-start gap-4 overflow-x-auto overscroll-x-contain overscroll-y-auto pb-4 app-scroll app-scroll-x max-md:snap-x max-md:snap-mandatory"
          >
            <div className="my-auto ml-auto shrink-0" aria-hidden="true" />
            {workflow.map((col, columnIndex) => {
              const visibleLimit = visibleCounts[col.id] || DEFAULT_VISIBLE;
              return (
                <KanbanColumn
                  key={col.id}
                  col={col}
                  colTasks={columns[col.id] || []}
                  visibleLimit={visibleLimit}
                  onTaskClick={onTaskClick}
                  activeAssignableMemberIds={activeAssignableMemberIds}
                  setVisibleCounts={setVisibleCounts}
                  STEP={STEP}
                  onRenameColumn={onRenameColumn}
                  onChangeColor={onChangeColor}
                  onRemoveColumn={onRemoveColumn}
                  onMoveColumn={moveColumn}
                  columnIndex={columnIndex}
                  columnCount={workflow.length}
                  isLeader={isLeader}
                  canEditTasks={canEditTasks}
                  currentUserId={currentUserId}
                  isTaskDragLocked={hasNextPage || isTaskMovePending}
                />
              );
            })}
            <div className="my-auto mr-auto shrink-0" aria-hidden="true" />
          </div>
        </SortableContext>

        <DragOverlay
          adjustScale={false}
          dropAnimation={{
            duration: 180,
            easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
            sideEffects: defaultDropAnimationSideEffects({
              styles: { active: { opacity: "0.15" } },
            }),
          }}
        >
          {activeTask ? (
            // One moving card; source and destination render blank slots only.
            <div
              className="pointer-events-none w-[min(276px,calc(100vw-2rem))] cursor-grabbing rounded-[8px] shadow-lg"
              style={{
                width:
                  activeTaskWidth && activeTaskWidth > 0
                    ? activeTaskWidth
                    : undefined,
              }}
            >
              <TaskCard task={activeTask} showStatus={false} />
            </div>
          ) : null}
          {activeColumn ? (
            <div className="w-[min(276px,calc(100vw-2rem))] cursor-grabbing rounded-[8px] border border-border/80 bg-card p-3 shadow-lg opacity-95">
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-[3px] shrink-0"
                  style={{ backgroundColor: activeColumn.color ?? "#94A3B8" }}
                  aria-hidden="true"
                />
                <span className="font-semibold text-xs text-foreground truncate">
                  {activeColumn.title}
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {(columns[activeColumn.id] || []).length}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {hasNextPage && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground" role="status">
            Load all tasks before reordering so positions remain complete and deterministic.
          </p>
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="nb-touch-target h-[34px] rounded-[5px] border border-border bg-card px-4 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
          >
            {isFetchingNextPage ? "Loading more tasks…" : "Load more tasks"}
          </button>
        </div>
      )}
    </div>
  );
}
