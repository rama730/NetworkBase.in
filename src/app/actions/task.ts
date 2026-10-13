"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { wakeEmailWorker } from "@/lib/email/outbox";
import { recordTaskAssignment, taskAssignmentNotification } from "@/lib/projects/task-assignment";
import {
  fileVersions,
  profiles,
  projectMembers,
  projectNodes,
  projectSprints,
  sprintTaskMemberships,
  projectWorkflowColumns,
  taskActivityEvents,
  taskNodeLinks,
  tasks,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { queueCounterRefreshBestEffort } from "@/lib/workspace/counter-buffer";
import {
  getTaskFileWarnings,
  inferTaskFileRole,
  markTaskFileVersionApproved,
} from "@/lib/projects/task-file-intelligence";
import { logger } from "@/lib/logger";
import { projectTaskHref } from "@/lib/projects/task-presentation";
import {
  isProjectMemberEligibleFor,
  requireProjectCapability,
} from "@/lib/projects/collaborator-lifecycle";
import {
  taskDescriptionSchema,
  taskTitleSchema,
  updateTaskFieldSchema,
} from "@/lib/validations/task";

type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

function taskActorSnapshot(user: {
  user_metadata?: Record<string, unknown> | null;
}) {
  return {
    actorName:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.username as string | undefined) ??
      null,
    actorAvatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
}


function taskContextLabel(
  projectKey?: string | null,
  taskNumber?: number | null,
) {
  return projectKey && taskNumber ? `${projectKey}-${taskNumber}` : "Task";
}

/**
 * SEC-H5 & PURE OPTIMIZATION (Item 3): Atomically lock the task's project + membership
 * rows in a single join query and verify caller write access in 1 DB round-trip.
 */
async function lockTaskForWrite(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  taskId: string,
  userId: string,
): Promise<{
  projectId: string;
  isOwner: boolean;
  isLeader: boolean;
  previousAssigneeId: string | null;
  previousSprintId: string | null;
  currentWorkflowColumnId: string | null;
  timelineOriginSprintId: string | null;
  creatorId: string;
  title: string;
  taskNumber: number | null;
  currentStatus: TaskStatus;
  reviewStatus: "none" | "pending" | "rejected";
  currentUpdatedAt: Date;
  projectSlug: string | null;
  projectKey: string | null;
}> {
  const rows = await tx.execute<{
    id: string;
    project_id: string;
    assignee_id: string | null;
    sprint_id: string | null;
    workflow_column_id: string | null;
    timeline_origin_sprint_id: string | null;
    creator_id: string;
    title: string;
    task_number: number | null;
    status: TaskStatus;
    review_status: "none" | "pending" | "rejected";
    updated_at: Date;
    owner_id: string;
    slug: string | null;
    key: string | null;
    deleted_at: Date | string | null;
    task_deleted_at: Date | string | null;
    member_role: string | null;
  }>(sql`
        SELECT
            t.id, t.project_id, t.assignee_id, t.sprint_id, t.workflow_column_id,
            t.timeline_origin_sprint_id, t.creator_id, t.title, t.task_number,
            t.status, t.review_status, t.updated_at, t.deleted_at AS task_deleted_at,
            p.owner_id, p.slug, p.key, p.deleted_at,
            m.role as member_role
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ${userId}
        WHERE t.id = ${taskId}
        FOR UPDATE OF t, p
    `);
  const row = Array.from(rows)[0];
  if (!row) {
    const [exists] = await tx.execute<{ id: string }>(sql`SELECT id FROM tasks WHERE id = ${taskId} LIMIT 1`);
    if (!exists) {
      throw new Error("Task not found");
    }
    throw new Error("Forbidden");
  }
  // COR-026: a deleted task is read-only; only its explicit restore may touch it.
  if (row.task_deleted_at) {
    throw new Error("This task was deleted");
  }
  if (row.deleted_at) {
    throw new Error("Forbidden");
  }
  const isOwner = row.owner_id === userId;
  if (!isOwner) {
    if (!row.member_role) {
      throw new Error("Forbidden");
    }
    if ((row.member_role ?? "").toLowerCase() === "viewer") {
      throw new Error("Forbidden");
    }
  }
  return {
    projectId: row.project_id,
    isOwner,
    isLeader: isOwner || (row.member_role ?? "").toLowerCase() === "admin",
    previousAssigneeId: row.assignee_id ?? null,
    previousSprintId: row.sprint_id ?? null,
    currentWorkflowColumnId: row.workflow_column_id ?? null,
    timelineOriginSprintId: row.timeline_origin_sprint_id ?? null,
    creatorId: row.creator_id,
    title: row.title,
    taskNumber: row.task_number ?? null,
    currentStatus: row.status,
    reviewStatus: row.review_status,
    currentUpdatedAt: row.updated_at,
    projectSlug: row.slug ?? null,
    projectKey: row.key ?? null,
  };
}

/**
 * Update task field
 */
export async function updateTaskFieldAction(
  taskId: string,
  field: string,
  value: unknown,
  projectId: string,
) {
  try {
    const parsed = updateTaskFieldSchema.safeParse({
      taskId,
      field,
      value,
      projectId,
    });
    if (!parsed.success) {
      return {
        success: false,
        error:
          "Invalid input: " +
          parsed.error.issues.map((i) => i.message).join(", "),
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Unauthorized" };
    }
    const { allowed: taskRlOk } = await consumeRateLimit(
      `task:${user.id}`,
      60,
      60,
    );
    if (!taskRlOk) return { success: false, error: "Rate limit exceeded" };

    const requestedSprintId =
      parsed.data.field === "sprintId" &&
      typeof parsed.data.value === "string" &&
      parsed.data.value
        ? parsed.data.value
        : null;

    const result = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) {
        throw new Error("Task does not belong to this project");
      }

      const updatedAt = new Date();
      const updates: Partial<typeof tasks.$inferInsert> = {
        updatedAt,
      };

      if (field === "title") {
        const title = taskTitleSchema.parse(value);
        updates.title = title;
      } else if (field === "description") {
        updates.description = typeof value === "string" && value.trim()
          ? taskDescriptionSchema.parse(value)
          : null;
      } else if (field === "priority") {
        const priority = typeof value === "string" ? value : "";
        if (!["low", "medium", "high", "urgent"].includes(priority)) {
          throw new Error("Invalid priority");
        }
        updates.priority = priority as Priority;
      } else if (field === "sprintId") {
        if (!locked.isOwner) {
          throw new Error(
            "Only the project owner can change sprint assignments",
          );
        }
        const sprintId = requestedSprintId;
        if (sprintId) {
          const sprint = await tx.query.projectSprints.findFirst({
            where: and(
              eq(projectSprints.id, sprintId),
              eq(projectSprints.projectId, locked.projectId),
            ),
            columns: { id: true, status: true },
          });
          if (!sprint) {
            throw new Error("Sprint must belong to this project");
          }
          if (sprint.status !== "planning" && sprint.status !== "active") {
            throw new Error(
              "Tasks can only be added to Planning or Active sprints",
            );
          }
        }
        updates.sprintId = sprintId;
        if (sprintId && !locked.timelineOriginSprintId) {
          updates.timelineOriginSprintId = sprintId;
          updates.timelineOriginAt = new Date();
        }
      } else if (field === "dueDate") {
        if (typeof value === "string" && value) {
          const parsed = new Date(value);
          if (Number.isNaN(parsed.getTime())) {
            throw new Error("Invalid due date");
          }
          updates.dueDate = parsed;
        } else {
          updates.dueDate = null;
        }
      } else if (field === "storyPoints") {
        if (value === null || value === undefined || value === "") {
          updates.storyPoints = null;
        } else {
          const num = typeof value === "number" ? value : Number(value);
          if (!Number.isInteger(num) || num < 0 || num > 100) {
            throw new Error("Story points must be between 0 and 100");
          }
          updates.storyPoints = num;
        }
      }

      await tx.update(tasks).set(updates).where(eq(tasks.id, taskId));
      if (
        field === "sprintId" &&
        locked.previousSprintId !== requestedSprintId
      ) {
        await tx
          .update(sprintTaskMemberships)
          .set({ removedAt: new Date(), removedBy: user.id })
          .where(
            and(
              eq(sprintTaskMemberships.taskId, taskId),
              isNull(sprintTaskMemberships.removedAt),
            ),
          );
        if (requestedSprintId) {
          await tx.insert(sprintTaskMemberships).values({
            projectId: locked.projectId,
            sprintId: requestedSprintId,
            taskId,
            addedBy: user.id,
          });
        }
      }
      await tx.insert(taskActivityEvents).values({
        taskId,
        projectId: locked.projectId,
        sprintId: locked.previousSprintId,
        actorId: user.id,
        eventType: "field_updated",
        payload: {
          version: 1,
          field,
          taskTitle:
            field === "title" && typeof value === "string"
              ? value.trim()
              : locked.title,
          taskNumber: locked.taskNumber,
          taskStatus: locked.currentStatus,
        },
      });
      if (
        field === "sprintId" &&
        locked.previousSprintId !== requestedSprintId
      ) {
        await tx.insert(taskActivityEvents).values([
          ...(locked.previousSprintId
            ? [
                {
                  taskId,
                  projectId: locked.projectId,
                  sprintId: locked.previousSprintId,
                  actorId: user.id,
                  eventType: "removed_from_sprint",
                  payload: {
                    version: 1,
                    taskTitle: locked.title,
                    taskNumber: locked.taskNumber,
                    taskStatus: locked.currentStatus,
                    nextSprintId: requestedSprintId,
                  },
                },
              ]
            : []),
          ...(requestedSprintId
            ? [
                {
                  taskId,
                  projectId: locked.projectId,
                  sprintId: requestedSprintId,
                  actorId: user.id,
                  eventType: "added_to_sprint",
                  payload: {
                    version: 1,
                    taskTitle: locked.title,
                    taskNumber: locked.taskNumber,
                    taskStatus: locked.currentStatus,
                    previousSprintId: locked.previousSprintId,
                  },
                },
              ]
            : []),
        ]);
      }
      return { ...locked, updatedAt };
    });

    await queueCounterRefreshBestEffort([result.previousAssigneeId]);
    const nextSprintId = requestedSprintId;
    if (field === "sprintId" && result.previousSprintId !== nextSprintId) {
      const recipients = Array.from(
        new Set(
          [result.creatorId, result.previousAssigneeId].filter(
            (recipient): recipient is string =>
              Boolean(recipient && recipient !== user.id),
          ),
        ),
      );
      if (recipients.length > 0) {
        try {
          const actor = taskActorSnapshot(user);
          await enqueueProjectNotificationEvent({
            projectId: result.projectId,
            actorUserId: user.id,
            ...actor,
            eventKey: "sprints.task_moved",
            taskParticipantIds: recipients,
            title: `${actor.actorName || "Someone"} moved a task in the sprint plan`,
            body: nextSprintId
              ? `${result.title} was added to a sprint.`
              : `${result.title} was moved back to the backlog.`,
            href: projectTaskHref(result.projectSlug || result.projectId, taskId),
            entityRefs: {
              projectId: result.projectId,
              projectSlug: result.projectSlug ?? null,
              taskId,
              sprintId: nextSprintId,
            },
            preview: {
              actorName: actor.actorName,
              actorAvatarUrl: actor.actorAvatarUrl,
              contextLabel: taskContextLabel(
                result.projectKey,
                result.taskNumber,
              ),
              contextKind: "task",
              secondaryText: result.title,
            },
            sourceEventId: `${taskId}:sprint:${result.previousSprintId ?? "backlog"}:${nextSprintId ?? "backlog"}`,
          });
        } catch (notificationError) {
          logger.warn("tasks.sprint_move_notification_failed", {
            module: "tasks",
            projectId: result.projectId,
            taskId,
            actorUserId: user.id,
            error:
              notificationError instanceof Error
                ? notificationError.message
                : String(notificationError),
          });
        }
      }
    }
    revalidatePath(`/projects/${result.projectId}`);
    // The client patches this server version in, so the next drag's version check matches.
    return { success: true, updatedAt: result.updatedAt.toISOString() };
  } catch (error: any) {
    console.error("Unexpected error:", error);
    return { success: false, error: error?.message || "Failed to update task" };
  }
}

type TaskLock = Awaited<ReturnType<typeof lockTaskForWrite>>;
type TaskTransitionResult = {
  updatedAt: Date;
  status: TaskStatus;
  reviewStatus: "none" | "pending" | "rejected";
  activityEventId: string | null;
};

/**
 * COR-027: the one status/column/review transition, used by the drawer's status control and by
 * a Kanban drag alike. The destination is a column (given, or the status's default column).
 */
async function transitionTaskTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  locked: TaskLock,
  input: { taskId: string; userId: string; status?: TaskStatus; columnId?: string; position?: number },
): Promise<TaskTransitionResult> {
  const column = await tx.query.projectWorkflowColumns.findFirst({
    where: input.columnId
      ? and(eq(projectWorkflowColumns.id, input.columnId), eq(projectWorkflowColumns.projectId, locked.projectId))
      : and(
          eq(projectWorkflowColumns.projectId, locked.projectId),
          eq(projectWorkflowColumns.status, input.status!),
          eq(projectWorkflowColumns.isDefault, true),
        ),
    columns: { id: true, status: true, title: true },
  });
  if (!column) throw new Error(input.columnId ? "Section not found" : "Default workflow section is unavailable");
  const status = column.status as TaskStatus;

  // Review lifecycle: entering done asks for review; leaving a pending review rejects it (leads only).
  let reviewStatus = locked.reviewStatus;
  if (status === "done" && locked.currentStatus !== "done") {
    reviewStatus = "pending";
  } else if (locked.reviewStatus === "pending" && status !== "done") {
    if (!locked.isOwner) throw new Error("Only project leads can move a task out of pending review.");
    reviewStatus = "rejected";
  }

  const updatedAt = new Date();
  await tx
    .update(tasks)
    .set({
      workflowColumnId: column.id,
      status,
      reviewStatus,
      ...(input.position !== undefined && { position: input.position }),
      updatedAt,
    })
    .where(eq(tasks.id, input.taskId));

  const statusChanged = locked.currentStatus !== status;
  const columnChanged = locked.currentWorkflowColumnId !== column.id;
  let activityEventId: string | null = null;
  if (statusChanged || columnChanged) {
    const [event] = await tx.insert(taskActivityEvents).values({
      taskId: input.taskId,
      projectId: locked.projectId,
      sprintId: locked.previousSprintId,
      actorId: input.userId,
      eventType: statusChanged ? "status_changed" : "workflow_column_changed",
      payload: statusChanged
        ? { version: 1, taskTitle: locked.title, taskNumber: locked.taskNumber, taskStatus: status, from: locked.currentStatus, to: status }
        : { version: 1, taskTitle: locked.title, taskNumber: locked.taskNumber, fromColumnId: locked.currentWorkflowColumnId, toColumnId: column.id, toColumnTitle: column.title },
    }).returning({ id: taskActivityEvents.id });
    activityEventId = event?.id ?? null;
  }
  return { updatedAt, status, reviewStatus, activityEventId };
}

/** Post-commit effects of a transition, identical for every caller: counters, attention, file warnings. */
async function afterTaskTransition(
  user: Parameters<typeof taskActorSnapshot>[0] & { id: string },
  locked: TaskLock,
  taskId: string,
  result: TaskTransitionResult,
) {
  const warnings =
    result.status === "done"
      ? await db
          .select({
            id: projectNodes.id,
            name: projectNodes.name,
            type: projectNodes.type,
            path: projectNodes.path,
            annotation: taskNodeLinks.annotation,
            tags: taskNodeLinks.tags,
            canonicalNodeId: projectNodes.canonicalNodeId,
          })
          .from(taskNodeLinks)
          .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
          .where(and(eq(taskNodeLinks.taskId, taskId), eq(projectNodes.projectId, locked.projectId), isNull(projectNodes.deletedAt)))
          .then((rows) => getTaskFileWarnings({ status: result.status, attachments: rows }))
      : [];

  await queueCounterRefreshBestEffort([locked.previousAssigneeId]);
  if ((result.status === "blocked" || result.status === "done") && result.status !== locked.currentStatus && result.activityEventId) {
    const recipients = new Set<string>();
    if (locked.creatorId !== user.id) recipients.add(locked.creatorId);
    if (locked.previousAssigneeId && locked.previousAssigneeId !== user.id) recipients.add(locked.previousAssigneeId);
    try {
      const actor = taskActorSnapshot(user);
      await enqueueProjectNotificationEvent({
        projectId: locked.projectId,
        actorUserId: user.id,
        ...actor,
        eventKey: "tasks.status_attention",
        taskParticipantIds: Array.from(recipients),
        title: `${actor.actorName || "Someone"} marked a task ${result.status === "blocked" ? "as an issue" : "done"}`,
        body: locked.title,
        href: projectTaskHref(locked.projectSlug || locked.projectId, taskId),
        entityRefs: {
          projectId: locked.projectId,
          projectSlug: locked.projectSlug ?? null,
          taskId,
          status: result.status,
        },
        preview: {
          actorName: actor.actorName,
          actorAvatarUrl: actor.actorAvatarUrl,
          contextLabel: taskContextLabel(locked.projectKey, locked.taskNumber),
          contextKind: "task",
          secondaryText: result.status === "blocked" ? "issue" : result.status,
        },
        // COR-028: one id per transition, so becoming blocked/done again notifies again.
        sourceEventId: result.activityEventId,
      });
    } catch (notificationError) {
      logger.error("tasks.status_attention_notification_failed", {
        module: "tasks",
        projectId: locked.projectId,
        taskId,
        actorUserId: user.id,
        status: result.status,
        count: recipients.size,
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      });
    }
  }
  revalidatePath(`/projects/${locked.projectId}`);
  return warnings;
}

async function requireTaskWriter() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;
  const { allowed } = await consumeRateLimit(`task:${user.id}`, 60, 60);
  if (!allowed) throw new Error("Rate limit exceeded");
  return user;
}

function parseExpectedVersion(expectedUpdatedAt?: string | null) {
  const version = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null;
  if (version && Number.isNaN(version.getTime())) throw new Error("Invalid task version");
  return version;
}

/**
 * Update task status
 */
export async function updateTaskStatusAction(
  taskId: string,
  status: TaskStatus,
  projectId: string,
  position?: number,
  expectedUpdatedAt?: string | null,
) {
  try {
    if (!["todo", "in_progress", "done", "blocked"].includes(status)) {
      return { success: false, error: "Invalid status" };
    }
    if (position !== undefined && !Number.isFinite(position)) return { success: false, error: "Invalid position" };
    const user = await requireTaskWriter();
    if (!user) return { success: false, error: "Unauthorized" };
    const expectedVersion = parseExpectedVersion(expectedUpdatedAt);

    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task does not belong to this project");
      if (expectedVersion && locked.currentUpdatedAt.getTime() !== expectedVersion.getTime()) {
        throw new Error("This task changed elsewhere. Reload it and try again.");
      }
      return { locked, result: await transitionTaskTx(tx, locked, { taskId, userId: user.id, status, position }) };
    });

    const warnings = await afterTaskTransition(user, locked, taskId, result);
    return {
      success: true,
      warnings,
      updatedAt: result.updatedAt.toISOString(),
      reviewStatus: result.reviewStatus,
    };
  } catch (error: any) {
    console.error("Unexpected error:", error);
    return {
      success: false,
      error: error?.message || "Failed to update task status",
    };
  }
}

export async function moveTaskToWorkflowColumnAction(
  taskId: string,
  projectId: string,
  workflowColumnId: string,
  position?: number,
  expectedUpdatedAt?: string | null,
) {
  try {
    if (
      !z.string().uuid().safeParse(taskId).success ||
      !z.string().uuid().safeParse(projectId).success ||
      !z.string().uuid().safeParse(workflowColumnId).success ||
      (position !== undefined && !z.number().finite().safeParse(position).success)
    ) {
      return { success: false as const, error: "Invalid task move" };
    }
    const user = await requireTaskWriter();
    if (!user) return { success: false as const, error: "Unauthorized" };
    const expectedVersion = parseExpectedVersion(expectedUpdatedAt);

    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId)
        throw new Error("Task does not belong to this project");
      // Members move their own or unassigned tasks; leads move any (the board mirrors this).
      if (!locked.isLeader && locked.previousAssigneeId && locked.previousAssigneeId !== user.id)
        throw new Error("Only the assignee or a project lead can move this task.");
      if (expectedVersion && locked.currentUpdatedAt.getTime() !== expectedVersion.getTime())
        throw new Error("This task changed elsewhere. Reload and try again.");
      return { locked, result: await transitionTaskTx(tx, locked, { taskId, userId: user.id, columnId: workflowColumnId, position }) };
    });
    const warnings = await afterTaskTransition(user, locked, taskId, result);
    return {
      success: true as const,
      updatedAt: result.updatedAt.toISOString(),
      reviewStatus: result.reviewStatus,
      warnings,
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to move task",
    };
  }
}

const assignTaskSchema = z.object({
  taskId: z.string().uuid(),
  assigneeId: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
});

/**
 * Assign task to user
 */
export async function assignTaskAction(
  taskId: string,
  assigneeId: string | null,
  projectId: string,
) {
  try {
    const parsed = assignTaskSchema.safeParse({
      taskId,
      assigneeId,
      projectId,
    });
    if (!parsed.success) {
      return {
        success: false,
        error:
          "Invalid input: " +
          parsed.error.issues.map((i) => i.message).join(", "),
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Unauthorized" };
    }
    const { allowed: taskRlOk } = await consumeRateLimit(
      `task:${user.id}`,
      60,
      60,
    );
    if (!taskRlOk) return { success: false, error: "Rate limit exceeded" };
    await requireProjectCapability(
      parsed.data.projectId,
      user.id,
      "assign_tasks",
    );

    const result = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) {
        throw new Error("Task does not belong to this project");
      }

      const snapshotIds = [
        user.id,
        locked.previousAssigneeId,
        assigneeId,
      ].filter((id): id is string => !!id);

      // PURE OPTIMIZATION (Item 5): Combine profile snapshots and assignee project membership in 1 query.
      const profileSnapshots =
        snapshotIds.length > 0
          ? await tx
              .select({
                id: profiles.id,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                memberRole: projectMembers.role,
              })
              .from(profiles)
              .leftJoin(
                projectMembers,
                and(
                  eq(projectMembers.userId, profiles.id),
                  eq(projectMembers.projectId, locked.projectId),
                ),
              )
              .where(inArray(profiles.id, snapshotIds))
          : [];

      if (assigneeId) {
        const assigneeRow = profileSnapshots.find((p) => p.id === assigneeId);
        if (!assigneeRow || !assigneeRow.memberRole) {
          throw new Error("Assignee must be a project member");
        }
        if (!isProjectMemberEligibleFor(assigneeRow.memberRole, "assign")) {
          throw new Error("Assignee must be an assignable project member");
        }
      }

      const snapshotById = new Map(
        profileSnapshots.map((profile) => [profile.id, profile]),
      );
      const actorSnapshot = snapshotById.get(user.id);
      const previousAssigneeSnapshot = locked.previousAssigneeId
        ? (snapshotById.get(locked.previousAssigneeId) ?? null)
        : null;
      const assigneeSnapshot = assigneeId
        ? (snapshotById.get(assigneeId) ?? null)
        : null;

      const updatedAt = new Date();
      await tx
        .update(tasks)
        .set({
          assigneeId: assigneeId || null,
          updatedAt,
        })
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

      let assignmentEventId: string | null = null;
      if (locked.previousAssigneeId !== assigneeId) {
        assignmentEventId = await recordTaskAssignment(tx, {
          taskId, projectId: locked.projectId, sprintId: locked.previousSprintId,
          title: locked.title, taskNumber: locked.taskNumber, status: locked.currentStatus,
          actorId: user.id,
          actorName: actorSnapshot?.fullName ?? taskActorSnapshot(user).actorName,
          actorAvatarUrl: actorSnapshot?.avatarUrl ?? taskActorSnapshot(user).actorAvatarUrl,
          previousAssigneeId: locked.previousAssigneeId, previousAssignee: previousAssigneeSnapshot,
          assigneeId, assignee: assigneeSnapshot,
        });
      }

      return { ...locked, assignmentEventId, updatedAt };
    });

    await wakeEmailWorker();
    await queueCounterRefreshBestEffort([
      result.previousAssigneeId,
      assigneeId,
    ]);
    if (
      assigneeId &&
      assigneeId !== user.id &&
      assigneeId !== result.previousAssigneeId
    ) {
      try {
        const actor = taskActorSnapshot(user);
        await enqueueProjectNotificationEvent(taskAssignmentNotification({
          taskId, projectId: result.projectId, projectSlug: result.projectSlug ?? null,
          projectKey: result.projectKey ?? null, taskNumber: result.taskNumber,
          title: result.title, actorId: user.id, ...actor,
          assigneeId, eventId: result.assignmentEventId!,
        }));
      } catch (notificationError) {
        logger.error("tasks.assignment_notification_failed", {
          module: "tasks",
          projectId: result.projectId,
          taskId,
          actorUserId: user.id,
          targetUserId: assigneeId,
          error:
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError),
        });
      }
    }
    revalidatePath(`/projects/${result.projectId}`);
    return { success: true, updatedAt: result.updatedAt.toISOString() };
  } catch (error: any) {
    console.error("Unexpected error:", error);
    return { success: false, error: error?.message || "Failed to assign task" };
  }
}

/**
 * Approve task review
 */
export async function approveTaskReviewAction(
  taskId: string,
  projectId: string,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const result = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task mismatch");
      if (!locked.isOwner)
        return { error: "Only project leads can approve tasks" } as const;
      if (locked.reviewStatus !== "pending")
        throw new Error("Task is not pending review");

      const updatedAt = new Date();
      const linkedFiles = await tx
        .select({
          linkId: taskNodeLinks.id,
          tags: taskNodeLinks.tags,
          annotation: taskNodeLinks.annotation,
          id: projectNodes.id,
          name: projectNodes.name,
          type: projectNodes.type,
          path: projectNodes.path,
          canonicalNodeId: projectNodes.canonicalNodeId,
          currentVersion: projectNodes.currentVersion,
          revisedAt: fileVersions.uploadedAt,
        })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(projectNodes.id, taskNodeLinks.nodeId))
        .innerJoin(fileVersions, and(eq(fileVersions.nodeId, projectNodes.id), eq(fileVersions.version, projectNodes.currentVersion)))
        .where(and(eq(taskNodeLinks.taskId, taskId), isNull(projectNodes.deletedAt)))
        .for("update");

      // Approval belongs to a specific file version in this task, not every
      // future upload or every other task that references the same file.
      const approvedLinks = linkedFiles
        .filter((file) => file.type === "file" && inferTaskFileRole(file) === "deliverable")
        .map((file) => ({ id: file.linkId, tags: markTaskFileVersionApproved(file.tags, file.currentVersion, file.revisedAt) }));
      if (approvedLinks.length > 0) {
        await tx.update(taskNodeLinks)
          .set({
            tags: sql`CASE ${taskNodeLinks.id} ${sql.join(approvedLinks.map((link) => sql`WHEN ${link.id}::uuid THEN ${JSON.stringify(link.tags)}::jsonb`), sql` `)} ELSE ${taskNodeLinks.tags} END`,
          })
          .where(inArray(taskNodeLinks.id, approvedLinks.map((link) => link.id)));
      }
      await tx
        .update(tasks)
        .set({
          reviewStatus: "none",
          updatedAt,
        })
        .where(eq(tasks.id, taskId));

      return { updatedAt } as const;
    });

    if ("error" in result) return { success: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    return { success: true, updatedAt: result.updatedAt.toISOString() };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to approve task" };
  }
}
