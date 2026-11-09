"use server";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reassignBlock, type AssignmentWrite } from "@/lib/organizations/assignment-rules";
import { assertAssignmentWrite } from "@/lib/organizations/assignments";
import { reviewAssignmentCopyAction } from "@/app/actions/assignments";
import { db } from "@/lib/db";
import { wakeEmailWorker } from "@/lib/email/outbox";
import { recordTaskAssignment, refusePeerAssignmentAcrossBlock, taskAssignmentNotification } from "@/lib/workspaces/task-assignment";
import {
  fileVersions,
  profiles,
  workspaceMembers,
  workspaceNodes,
  workspaceSprints,
  sprintTaskMemberships,
  workspaceWorkflowColumns,
  taskActivityEvents,
  taskNodeLinks,
  tasks,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { queueCounterRefreshBestEffort } from "@/lib/my-work/counter-buffer";
import {
  getTaskFileWarnings,
  inferTaskFileRole,
  markTaskFileVersionApproved,
} from "@/lib/workspaces/task-file-intelligence";
import { logger } from "@/lib/logger";
import { projectTaskHref } from "@/lib/workspaces/task-presentation";
import {
  isWorkspaceMemberEligibleFor,
  requireWorkspaceCapability,
} from "@/lib/workspaces/collaborator-lifecycle";
import {
  taskDescriptionSchema,
  taskTitleSchema,
  updateTaskFieldSchema,
} from "@/lib/validations/task";

import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { childGrant, orgCan } from "@/lib/organizations/permissions";
import { taskReviewSnapshot } from "@/lib/workspaces/task-review-snapshot";
import { taskActorSnapshot, taskContextLabel, lockTaskForWrite, transitionTaskTx, afterTaskTransition, MAIN_ASSIGNMENT_NOT_REVIEWED } from "@/lib/workspaces/task-transition-service";
import { viaPayload } from "@/lib/server/request-via";

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
      return { success: false, error: "Sign in to continue" };
    }
    const { allowed: taskRlOk } = await consumeRateLimit(
      `task:${user.id}`,
      60,
      60,
    );
    if (!taskRlOk) return { success: false, error: "Too many attempts. Try again in a minute." };

    const requestedSprintId =
      parsed.data.field === "sprintId" &&
      typeof parsed.data.value === "string" &&
      parsed.data.value
        ? parsed.data.value
        : null;

    const result = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) {
        throw new Error("Task does not belong to this workspace");
      }
      const assignment = await assertAssignmentWrite(tx, taskId, { role: locked.orgRole, isHolder: locked.isHolder, onOrgBoard: locked.onOrgBoard }, field as AssignmentWrite);

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
        // Owners and admins plan sprints (decision 146); a team plans its own group work (report §19.3).
        if (!locked.isOwner && !locked.isLeader && !assignment?.groupCopy) {
          throw new Error(
            "Only owners and admins can change sprint assignments",
          );
        }
        const sprintId = requestedSprintId;
        if (sprintId) {
          const sprint = await tx.query.workspaceSprints.findFirst({
            where: and(
              eq(workspaceSprints.id, sprintId),
              eq(workspaceSprints.projectId, locked.projectId),
            ),
            columns: { id: true, status: true },
          });
          if (!sprint) {
            throw new Error("Sprint must belong to this workspace");
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
            throw new Error("Estimate must be between 0 and 100");
          }
          updates.storyPoints = num;
        }
      }

      await tx.update(tasks).set(updates).where(eq(tasks.id, taskId));
      // A main assignment's copies in the organization change sprint with it (report §42.10 problem 18).
      if (field === "sprintId" && assignment?.isMaster && locked.previousSprintId !== requestedSprintId) {
        const copies = await tx.update(tasks).set({ sprintId: requestedSprintId, updatedAt })
          .where(and(eq(tasks.assignmentId, taskId), eq(tasks.projectId, locked.projectId), isNull(tasks.deletedAt)))
          .returning({ id: tasks.id });
        if (copies.length > 0) {
          await tx.update(sprintTaskMemberships).set({ removedAt: updatedAt, removedBy: user.id })
            .where(and(inArray(sprintTaskMemberships.taskId, copies.map((c) => c.id)), isNull(sprintTaskMemberships.removedAt)));
          if (requestedSprintId) {
            await tx.insert(sprintTaskMemberships).values(copies.map((c) => ({ projectId: locked.projectId, sprintId: requestedSprintId, taskId: c.id, addedBy: user.id })));
          }
        }
      }
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
        payload: { ...(await viaPayload()),
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
                  payload: { ...(await viaPayload()),
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
                  payload: { ...(await viaPayload()),
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
          await enqueueWorkspaceNotificationEvent({
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
    revalidatePath(`/workspaces/${result.projectId}`);
    // The client patches this server version in, so the next drag's version check matches.
    return { success: true, updatedAt: result.updatedAt.toISOString() };
  } catch (error: any) {
    console.error("Unexpected error:", error);
    return { success: false, error: error?.message || "Couldn’t update task" };
  }
}

async function requireTaskWriter() {
  const { user } = await requireAuthenticatedUser();
  if (!user) return null;
  const { allowed } = await consumeRateLimit(`task:${user.id}`, 60, 60);
  if (!allowed) throw new Error("Too many attempts. Try again in a minute.");
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
/**
 * Sprint redesign §8.6, Add work: moves up to 30 tasks into a sprint, each through the same rules as changing one
 * task's sprint (who may plan, the sprint's state, an assignment's copies follow it). One refusal doesn't stop the rest.
 */
export async function addTasksToSprintAction(input: { projectId: string; sprintId: string; taskIds: string[] }): Promise<{ added: number; failed: Array<{ id: string; error: string }> }> {
  const ids = [...new Set(input.taskIds)];
  if (ids.length === 0 || input.taskIds.length > 30) return { added: 0, failed: [{ id: "", error: "Add up to 30 tasks at a time." }] };
  let added = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of ids) {
    const result = await updateTaskFieldAction(id, "sprintId", input.sprintId, input.projectId);
    if (result.success) added += 1;
    else failed.push({ id, error: ("error" in result && result.error) || "Couldn’t add this task." });
  }
  return { added, failed };
}

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
    if (!user) return { success: false, error: "Sign in to continue" };
    const expectedVersion = parseExpectedVersion(expectedUpdatedAt);

    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task does not belong to this workspace");
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
      error: error?.message || "Couldn’t update task status",
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
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const expectedVersion = parseExpectedVersion(expectedUpdatedAt);

    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId)
        throw new Error("Task does not belong to this workspace");
      // Members move their own or unassigned tasks; leads move any (the board mirrors this).
      if (!locked.isLeader && locked.previousAssigneeId && locked.previousAssigneeId !== user.id)
        throw new Error("Only the assignee, the owner or an admin can move this task.");
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
      return { success: false, error: "Sign in to continue" };
    }
    const { allowed: taskRlOk } = await consumeRateLimit(
      `task:${user.id}`,
      60,
      60,
    );
    if (!taskRlOk) return { success: false, error: "Too many attempts. Try again in a minute." };
    await requireWorkspaceCapability(
      parsed.data.projectId,
      user.id,
      "assign_tasks",
    );
    await refusePeerAssignmentAcrossBlock(db, parsed.data.projectId, user.id, parsed.data.assigneeId);

    const result = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) {
        throw new Error("Task does not belong to this workspace");
      }
      // Decision 149. A group copy inside a workspace has that workspace as its team, and its lead as the lead;
      // the membership check below keeps the new person inside it.
      const [work] = await tx.execute<{ master: boolean; copy: boolean; team: boolean; lead: boolean; target: boolean; group: boolean }>(sql`
        SELECT t.kind = 'assignment' AND t.assignment_id IS NULL AS master, t.assignment_id IS NOT NULL AS copy,
               EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id) AS team,
               EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = ${user.id} AND tm.is_lead) AS lead,
               (${assigneeId}::uuid IS NULL OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = ${assigneeId}::uuid)) AS target,
               p.kind <> 'organization' AS "group"
        FROM tasks t JOIN workspaces p ON p.id = t.workspace_id WHERE t.id = ${taskId}`);
      const group = Boolean(work?.copy && work.group);
      const blocked = reassignBlock({
        isMaster: Boolean(work?.master), isCopy: Boolean(work?.copy), hasTeam: Boolean(work?.team) || group,
        // Decisions 33 and 109: reassign_group_work in a workspace, the organization's admins on its own team copies.
        actorIsAdmin: group ? childGrant(locked.childRole, "reassign_group_work") === "yes" && locked.childRole !== "lead" : orgCan(locked.orgRole, "edit_group_task_details"),
        actorIsLead: Boolean(work?.lead) || (group && locked.isOwner), targetOnTeam: Boolean(work?.target) || group,
      });
      if (blocked) throw new Error(blocked);

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
                memberRole: workspaceMembers.role,
              })
              .from(profiles)
              .leftJoin(
                workspaceMembers,
                and(
                  eq(workspaceMembers.userId, profiles.id),
                  eq(workspaceMembers.projectId, locked.projectId),
                ),
              )
              .where(inArray(profiles.id, snapshotIds))
          : [];

      if (assigneeId) {
        const assigneeRow = profileSnapshots.find((p) => p.id === assigneeId);
        if (!assigneeRow || !assigneeRow.memberRole) {
          throw new Error("Assignee must be a workspace member");
        }
        if (!isWorkspaceMemberEligibleFor(assigneeRow.memberRole, "assign")) {
          throw new Error("Assignee must be an assignable workspace member");
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
        await enqueueWorkspaceNotificationEvent(taskAssignmentNotification({
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
    revalidatePath(`/workspaces/${result.projectId}`);
    return { success: true, updatedAt: result.updatedAt.toISOString() };
  } catch (error: any) {
    console.error("Unexpected error:", error);
    return { success: false, error: error?.message || "Couldn’t assign task" };
  }
}

/**
 * Approve task review
 */
/**
 * Decision 141: Approve and Return on an assignment copy are the review queue's action, with its checks and
 * notices, from the task panel too. Null for ordinary tasks, which keep their own review.
 */
async function reviewCopyFromPanel(taskId: string, projectId: string, decision: "approve" | "return", reason?: string, expectedUpdatedAt?: string) {
  const [task] = await db.select({ assignmentId: tasks.assignmentId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task?.assignmentId) return null;
  const result = await reviewAssignmentCopyAction(taskId, decision, reason, { projectId, updatedAt: expectedUpdatedAt });
  if (!result.success) return { success: false as const, error: result.error };
  const [after] = await db.select({ updatedAt: tasks.updatedAt, status: tasks.status, reviewStatus: tasks.reviewStatus }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return { success: true as const, updatedAt: after!.updatedAt.toISOString(), status: after!.status, reviewStatus: after!.reviewStatus, outcome: decision === "approve" ? "approved" as const : "changes_requested" as const };
}

export async function approveTaskReviewAction(
  taskId: string,
  projectId: string,
  expectedUpdatedAt?:string,
) {
  try {
    if (!z.string().uuid().safeParse(taskId).success || !z.string().uuid().safeParse(projectId).success || (expectedUpdatedAt && !z.string().datetime().safeParse(expectedUpdatedAt).success)) return { success: false, error: "Invalid task review request" };
    // Signed in and rate limited like any review, then a copy goes through the queue's review (decision 141).
    const user = await requireTaskWriter();
    if (!user) return { success: false, error: "Sign in to continue" };
    const copyReview = await reviewCopyFromPanel(taskId, projectId, "approve", undefined, expectedUpdatedAt);
    if (copyReview) return copyReview;

    const result = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task mismatch");
      if (locked.isMaster) throw new Error(MAIN_ASSIGNMENT_NOT_REVIEWED);
      // Decision 95, assignment copies only (42.18): nobody reviews their own or their group's work.
      if (locked.copySubmissionType !== null && (locked.previousAssigneeId === user.id || locked.isTeamMember)) throw new Error("You can’t review your own work. Ask another admin.");
      if(expectedUpdatedAt && new Date(locked.currentUpdatedAt).getTime()!==new Date(expectedUpdatedAt).getTime()) throw new Error("Task changed elsewhere. Reload before approving.");
      if (!locked.isLeader)
        return { error: "Only the owner and admins can approve tasks" } as const;
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
          id: workspaceNodes.id,
          name: workspaceNodes.name,
          type: workspaceNodes.type,
          path: workspaceNodes.path,
          canonicalNodeId: workspaceNodes.canonicalNodeId,
          currentVersion: workspaceNodes.currentVersion,
          revisedAt: fileVersions.uploadedAt,
        })
        .from(taskNodeLinks)
        .innerJoin(workspaceNodes, eq(workspaceNodes.id, taskNodeLinks.nodeId))
        .innerJoin(fileVersions, and(eq(fileVersions.nodeId, workspaceNodes.id), eq(fileVersions.version, workspaceNodes.currentVersion)))
        .where(and(eq(taskNodeLinks.taskId, taskId), isNull(workspaceNodes.deletedAt)))
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

      const [event] = await tx.insert(taskActivityEvents).values({ taskId, projectId, sprintId: locked.previousSprintId, actorId: user.id, eventType: "review_approved", payload: { ...(await viaPayload()), version: 1, taskTitle: locked.title, taskNumber: locked.taskNumber, taskStatus: "done", from: "in_review", to: "done", reviewContentHash: snapshot } }).returning({ id: taskActivityEvents.id });
      return { updatedAt, locked, activityEventId: event?.id ?? null } as const;
    });

    if ("error" in result) return { success: false, error: result.error };
    await afterTaskTransition(user, result.locked, taskId, { updatedAt: result.updatedAt, status: "done", reviewStatus: "none", activityEventId: result.activityEventId, outcome: "approved" });
    return { success: true, updatedAt: result.updatedAt.toISOString(), outcome: "approved" as const };
  } catch (error: any) {
    return { success: false, error: error.message || "Couldn’t approve task" };
  }
}

/** Explicit review actions cannot be bypassed with a generic status move. */
export async function requestTaskChangesAction(taskId: string, projectId: string, reason: string, expectedUpdatedAt: string) {
  if (!z.string().uuid().safeParse(taskId).success || !z.string().uuid().safeParse(projectId).success) return { success: false as const, error: "Invalid task review request" };
  const [task] = await db.select({ assignmentId: tasks.assignmentId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task?.assignmentId) return performTaskReviewAction(taskId, projectId, expectedUpdatedAt, { reviewReason: reason });
  // A copy: signed in and rate limited like any review, then the queue's review (decision 141).
  try {
    if (!await requireTaskWriter()) return { success: false as const, error: "Sign in to continue" };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Review update failed" };
  }
  return (await reviewCopyFromPanel(taskId, projectId, "return", reason, expectedUpdatedAt))!;
}

export async function resubmitTaskReviewAction(taskId: string, projectId: string, expectedUpdatedAt: string) {
  return performTaskReviewAction(taskId, projectId, expectedUpdatedAt, { resubmit: true });
}

async function performTaskReviewAction(taskId: string, projectId: string, expectedUpdatedAt: string, action: { resubmit?: boolean; reviewReason?: string }) {
  try {
    if (!z.object({ taskId: z.string().uuid(), projectId: z.string().uuid(), expectedUpdatedAt: z.string().datetime() }).safeParse({ taskId, projectId, expectedUpdatedAt }).success) throw new Error("Invalid task review request");
    if (!action.resubmit) action.reviewReason = z.string().trim().min(1, "Explain the requested changes").max(2000).parse(action.reviewReason);
    const user = await requireTaskWriter();
    if (!user) throw new Error("Sign in to continue");
    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task mismatch");
      // Decision 95, assignment copies only (42.18): nobody reviews their own or their group's work. Resubmitting is theirs.
      if (!action.resubmit && locked.copySubmissionType !== null && (locked.previousAssigneeId === user.id || locked.isTeamMember)) throw new Error("You can’t review your own work. Ask another admin.");
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
    const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
    if (!canReadWorkspaceTab(access, "tasks")) throw new Error("You don’t have access to this");
    const task = await db.query.tasks.findFirst({ where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)) });
    if (!task) throw new Error("Task not found");
    const changed = task.reviewStatus === "pending" && (!task.reviewContentHash || task.reviewContentHash !== await taskReviewSnapshot(db, taskId));
    const latest = task.reviewStatus === "rejected" ? await db.query.taskActivityEvents.findFirst({ where: and(eq(taskActivityEvents.taskId, taskId), eq(taskActivityEvents.eventType, "changes_requested")), orderBy: [desc(taskActivityEvents.createdAt)] }) : null;
    return { success: true as const, changed, submittedAt: task.reviewSubmittedAt?.toISOString() ?? null, completedAt: task.completedAt?.toISOString() ?? null, reason: typeof latest?.payload?.reason === "string" ? latest.payload.reason : null };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load review" }; }
}
