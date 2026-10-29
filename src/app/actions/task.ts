"use server";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { queueCounterRefreshBestEffort } from "@/lib/my-work/counter-buffer";
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

import { canReadProjectTab, getProjectAccessById } from "@/lib/data/project-access";
import { taskReviewSnapshot } from "@/lib/projects/task-review-snapshot";
import { taskActorSnapshot, taskContextLabel, lockTaskForWrite, transitionTaskTx, afterTaskTransition } from "@/lib/projects/task-transition-service";

type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

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

async function requireTaskWriter() {
  const { user } = await requireAuthenticatedUser();
  if (!user) return null;
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
      if (expectedVersion && new Date(locked.currentUpdatedAt).getTime() !== expectedVersion.getTime()) {
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
      status: result.status,
      outcome: result.outcome,
      reviewRequired: result.reviewRequired,
      policyVersion: result.policyVersion,
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
      if (expectedVersion && new Date(locked.currentUpdatedAt).getTime() !== expectedVersion.getTime())
        throw new Error("This task changed elsewhere. Reload and try again.");
      return { locked, result: await transitionTaskTx(tx, locked, { taskId, userId: user.id, columnId: workflowColumnId, position }) };
    });
    const warnings = await afterTaskTransition(user, locked, taskId, result);
    return {
      success: true as const,
      updatedAt: result.updatedAt.toISOString(),
      reviewStatus: result.reviewStatus,
      status: result.status,
      outcome: result.outcome,
      reviewRequired: result.reviewRequired,
      policyVersion: result.policyVersion,
      warnings,
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Couldn’t move task",
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
  expectedUpdatedAt?:string,
) {
  try {
    if (!z.string().uuid().safeParse(taskId).success || !z.string().uuid().safeParse(projectId).success || (expectedUpdatedAt && !z.string().datetime().safeParse(expectedUpdatedAt).success)) return { success: false, error: "Invalid task review request" };
    const user = await requireTaskWriter();
    if (!user) return { success: false, error: "Unauthorized" };

    const result = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task mismatch");
      if(expectedUpdatedAt && new Date(locked.currentUpdatedAt).getTime()!==new Date(expectedUpdatedAt).getTime()) throw new Error("Task changed elsewhere. Reload before approving.");
      if (!locked.isLeader)
        return { error: "Only project leads can approve tasks" } as const;
      if (locked.reviewStatus !== "pending" || locked.currentStatus !== "done")
        throw new Error("Task is not pending review");

      const snapshot = await taskReviewSnapshot(tx, taskId, true);
      if (!locked.reviewContentHash || locked.reviewContentHash !== snapshot)
        throw new Error("Task requirements, subtasks or files changed after submission. Ask the assignee to resubmit before approving.");
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
          completedAt: updatedAt,
          completedBy: user.id,
          completionSource: "review",
          updatedAt,
        })
        .where(eq(tasks.id, taskId));

      const [event] = await tx.insert(taskActivityEvents).values({ taskId, projectId, sprintId: locked.previousSprintId, actorId: user.id, eventType: "review_approved", payload: { version: 1, taskTitle: locked.title, taskNumber: locked.taskNumber, taskStatus: "done", from: "in_review", to: "done", reviewContentHash: snapshot } }).returning({ id: taskActivityEvents.id });
      return { updatedAt, locked, activityEventId: event?.id ?? null } as const;
    });

    if ("error" in result) return { success: false, error: result.error };
    await afterTaskTransition(user, result.locked, taskId, { updatedAt: result.updatedAt, status: "done", reviewStatus: "none", activityEventId: result.activityEventId, outcome: "approved" });
    return { success: true, updatedAt: result.updatedAt.toISOString(), outcome: "approved" as const };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to approve task" };
  }
}

/** Explicit review actions cannot be bypassed with a generic status move. */
export async function requestTaskChangesAction(taskId: string, projectId: string, reason: string, expectedUpdatedAt: string) {
  return performTaskReviewAction(taskId, projectId, expectedUpdatedAt, { reviewReason: reason });
}

export async function resubmitTaskReviewAction(taskId: string, projectId: string, expectedUpdatedAt: string) {
  return performTaskReviewAction(taskId, projectId, expectedUpdatedAt, { resubmit: true });
}

async function performTaskReviewAction(taskId: string, projectId: string, expectedUpdatedAt: string, action: { resubmit?: boolean; reviewReason?: string }) {
  try {
    if (!z.object({ taskId: z.string().uuid(), projectId: z.string().uuid(), expectedUpdatedAt: z.string().datetime() }).safeParse({ taskId, projectId, expectedUpdatedAt }).success) throw new Error("Invalid task review request");
    if (!action.resubmit) action.reviewReason = z.string().trim().min(1, "Explain the requested changes").max(2000).parse(action.reviewReason);
    const user = await requireTaskWriter();
    if (!user) throw new Error("Unauthorized");
    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task mismatch");
      if (!expectedUpdatedAt || new Date(locked.currentUpdatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) throw new Error("Task changed elsewhere. Reload before retrying.");
      if (locked.reviewStatus !== "pending") throw new Error("Task is not pending review");
      const result = await transitionTaskTx(tx, locked, { taskId, userId: user.id, status: action.resubmit ? "done" : "in_progress", ...action });
      return { locked, result };
    });
    await afterTaskTransition(user, locked, taskId, result);
    return { success: true as const, updatedAt: result.updatedAt.toISOString(), reviewStatus: result.reviewStatus, status: result.status, outcome: result.outcome };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Review update failed" };
  }
}

export async function getTaskReviewStateAction(taskId: string, projectId: string) {
  try {
    const { user } = await requireAuthenticatedUser();
    const access = await getProjectAccessById(projectId, user?.id ?? null);
    if (!canReadProjectTab(access, "tasks")) throw new Error("Forbidden");
    const task = await db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)) });
    if (!task) throw new Error("Task not found");
    const changed = task.reviewStatus === "pending" && (!task.reviewContentHash || task.reviewContentHash !== await taskReviewSnapshot(db, taskId));
    const latest = task.reviewStatus === "rejected" ? await db.query.taskActivityEvents.findFirst({ where: and(eq(taskActivityEvents.taskId, taskId), eq(taskActivityEvents.eventType, "changes_requested")), orderBy: [desc(taskActivityEvents.createdAt)] }) : null;
    return { success: true as const, changed, submittedAt: task.reviewSubmittedAt?.toISOString() ?? null, completedAt: task.completedAt?.toISOString() ?? null, reason: typeof latest?.payload?.reason === "string" ? latest.payload.reason : null };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : "Unable to load review" }; }
}
