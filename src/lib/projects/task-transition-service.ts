import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { wakeEmailWorker } from "@/lib/email/outbox";
import {
  recordTaskAssignment,
  taskAssignmentNotification,
} from "@/lib/projects/task-assignment";
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

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";
export function taskActorSnapshot(user: {
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

export function taskContextLabel(
  projectKey?: string | null,
  taskNumber?: number | null,
) {
  return projectKey && taskNumber ? `${projectKey}-${taskNumber}` : "Task";
}

/**
 * SEC-H5 & PURE OPTIMIZATION (Item 3): Atomically lock the task's project + membership
 * rows in a single join query and verify caller write access in 1 DB round-trip.
 */
export async function lockTaskForWrite(
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
    const [exists] = await tx.execute<{ id: string }>(
      sql`SELECT id FROM tasks WHERE id = ${taskId} LIMIT 1`,
    );
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
export async function transitionTaskTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  locked: TaskLock,
  input: {
    taskId: string;
    userId: string;
    status?: TaskStatus;
    columnId?: string;
    position?: number;
  },
): Promise<TaskTransitionResult> {
  const column = await tx.query.projectWorkflowColumns.findFirst({
    where: input.columnId
      ? and(
          eq(projectWorkflowColumns.id, input.columnId),
          eq(projectWorkflowColumns.projectId, locked.projectId),
        )
      : and(
          eq(projectWorkflowColumns.projectId, locked.projectId),
          eq(projectWorkflowColumns.status, input.status!),
          eq(projectWorkflowColumns.isDefault, true),
        ),
    columns: { id: true, status: true, title: true },
  });
  if (!column)
    throw new Error(
      input.columnId
        ? "Section not found"
        : "Default workflow section is unavailable",
    );
  const status = column.status as TaskStatus;

  // Review lifecycle: entering done asks for review; leaving a pending review rejects it (leads only).
  let reviewStatus = locked.reviewStatus;
  if (status === "done" && locked.currentStatus !== "done") {
    reviewStatus = "pending";
  } else if (locked.reviewStatus === "pending" && status !== "done") {
    if (!locked.isOwner)
      throw new Error(
        "Only project leads can move a task out of pending review.",
      );
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
    const [event] = await tx
      .insert(taskActivityEvents)
      .values({
        taskId: input.taskId,
        projectId: locked.projectId,
        sprintId: locked.previousSprintId,
        actorId: input.userId,
        eventType: statusChanged ? "status_changed" : "workflow_column_changed",
        payload: statusChanged
          ? {
              version: 1,
              taskTitle: locked.title,
              taskNumber: locked.taskNumber,
              taskStatus: status,
              from: locked.currentStatus,
              to: status,
            }
          : {
              version: 1,
              taskTitle: locked.title,
              taskNumber: locked.taskNumber,
              fromColumnId: locked.currentWorkflowColumnId,
              toColumnId: column.id,
              toColumnTitle: column.title,
            },
      })
      .returning({ id: taskActivityEvents.id });
    activityEventId = event?.id ?? null;
  }
  return { updatedAt, status, reviewStatus, activityEventId };
}

/** Post-commit effects of a transition, identical for every caller: counters, attention, file warnings. */
export async function afterTaskTransition(
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
          .where(
            and(
              eq(taskNodeLinks.taskId, taskId),
              eq(projectNodes.projectId, locked.projectId),
              isNull(projectNodes.deletedAt),
            ),
          )
          .then((rows) =>
            getTaskFileWarnings({ status: result.status, attachments: rows }),
          )
      : [];

  await queueCounterRefreshBestEffort([locked.previousAssigneeId]);
  if (
    (result.status === "blocked" || result.status === "done") &&
    result.status !== locked.currentStatus &&
    result.activityEventId
  ) {
    const recipients = new Set<string>();
    if (locked.creatorId !== user.id) recipients.add(locked.creatorId);
    if (locked.previousAssigneeId && locked.previousAssigneeId !== user.id)
      recipients.add(locked.previousAssigneeId);
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
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }
  }
  revalidatePath(`/projects/${locked.projectId}`);
  return warnings;
}
