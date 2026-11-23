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
  workspaces,
  sprintTaskMemberships,
  workspaceWorkflowColumns,
  taskActivityEvents,
  taskNodeLinks,
  taskDependencies,
  tasks,
} from "@/lib/db/schema";
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
import { canBeParent, canBePartOf, completion, conflicts, daysBetween, dependentsToShift, type Dep } from "@/lib/workflows/planner";
import { taskActorSnapshot, taskContextLabel, lockTaskForWrite, transitionTaskTx, afterTaskTransition, MAIN_ASSIGNMENT_NOT_REVIEWED } from "@/lib/workspaces/task-transition-service";
import { viaPayload } from "@/lib/server/request-via";
import { boardMove, stageMove } from "@/lib/workflows/rules";

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

    // Browser session or a CLI/agent token on an allowed route (report A2.1: one implementation for both).
    const { user } = await requireAuthenticatedUser();
    if (!user) {
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

const stageMoveSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  stage: z.string().min(1).max(40),
  /** Joining the board (B5): the sprint to add it to; none or toBacklog sends it to the Backlog. */
  sprintId: z.string().uuid().nullish(),
  toBacklog: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime().nullish(),
});

/**
 * Report 38.2 F1: move a typed item (bug, request, content) to a stage. The stage sets the status and whether it's on
 * the board, through the one transition (review gating included). Joining the board takes the sprint the mover picks;
 * only owners and admins plan sprints (decision 146), so a member's item goes to the Backlog (F3 call 3). Leaving the
 * board takes it out of its sprint and keeps that in the sprint's history as "moved back" (B7).
 */
export async function setTaskStageAction(input: z.infer<typeof stageMoveSchema>) {
  try {
    const parsed = stageMoveSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Invalid stage move" };
    const { taskId, projectId, stage, sprintId, toBacklog } = parsed.data;
    const user = await requireTaskWriter();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const expectedVersion = parseExpectedVersion(parsed.data.expectedUpdatedAt);

    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task does not belong to this workspace");
      if (expectedVersion && new Date(locked.currentUpdatedAt).getTime() !== expectedVersion.getTime())
        throw new Error("This task changed elsewhere. Reload and try again.");
      const [ws] = await tx.select({ on: workspaces.workflowsEnabled }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
      if (!ws?.on) throw new Error("Workflows aren’t on in this workspace.");
      // Report 38.6 (A2.2): a bug closes with its reason (Close… / closeBugAction), which records it first; a bare
      // stage move to Won't fix, Duplicate or Can't reproduce is refused.
      if (locked.itemType === "bug" && ["wont_fix", "duplicate", "cant_reproduce"].includes(stage) && locked.stage !== stage) {
        const [row] = await tx.select({ fields: tasks.typeFields }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if ((row?.fields as Record<string, unknown> | null)?.closeReason !== stage) throw new Error("Close a bug with Close…, so it says why");
      }
      // Report 38.7 W4.3 (A2.4): Declined says why; only Decline (which records the reason first) closes a request.
      if (locked.itemType === "request" && stage === "declined" && locked.stage !== "declined") {
        const [row] = await tx.select({ fields: tasks.typeFields }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!(row?.fields as Record<string, unknown> | null)?.declineReason) throw new Error("Decline a request with Decline…, so the asker knows why");
      }
      const move = stageMove(locked.itemType, locked.stage, stage);
      // Leaving the board takes it out of its sprint, and only owners and admins change sprints (decision 146).
      if (move.leaves && locked.previousSprintId && !locked.isLeader) throw new Error("This is in a sprint. Ask an owner or admin to move it off the board.");
      const result = await transitionTaskTx(tx, locked, { taskId, userId: user.id, stage });
      const now = new Date();
      const via = await viaPayload();
      const sprintEvent = (eventType: string, sprint: string, payload: Record<string, unknown>) => tx.insert(taskActivityEvents).values({
        taskId, projectId, sprintId: sprint, actorId: user.id, eventType,
        payload: { ...via, version: 1, taskTitle: locked.title, taskNumber: locked.taskNumber, taskStatus: result.status, ...payload },
      });
      const joinSprint = move.joins && locked.isLeader && !toBacklog ? sprintId ?? null : null;
      if (joinSprint) {
        const [sprint] = await tx.select({ status: workspaceSprints.status }).from(workspaceSprints)
          .where(and(eq(workspaceSprints.id, joinSprint), eq(workspaceSprints.projectId, projectId))).limit(1);
        if (!sprint) throw new Error("Sprint must belong to this workspace");
        if (sprint.status !== "planning" && sprint.status !== "active") throw new Error("Tasks can only be added to Planning or Active sprints");
        await tx.update(tasks).set({ sprintId: joinSprint, ...(!locked.timelineOriginSprintId && { timelineOriginSprintId: joinSprint, timelineOriginAt: now }) }).where(eq(tasks.id, taskId));
        await tx.insert(sprintTaskMemberships).values({ projectId, sprintId: joinSprint, taskId, addedBy: user.id });
        await sprintEvent("added_to_sprint", joinSprint, { reason: "joined_from_workflow", stage });
      }
      if (move.leaves && locked.previousSprintId) {
        await tx.update(tasks).set({ sprintId: null }).where(eq(tasks.id, taskId));
        await tx.update(sprintTaskMemberships).set({ removedAt: now, removedBy: user.id })
          .where(and(eq(sprintTaskMemberships.taskId, taskId), isNull(sprintTaskMemberships.removedAt)));
        await sprintEvent("removed_from_sprint", locked.previousSprintId, { reason: "moved_back", toStage: stage, itemType: locked.itemType, nextSprintId: null });
      }
      return { locked, result };
    });
    const warnings = await afterTaskTransition(user, locked, taskId, result);
    // A1.6: a completed project tells the people on it (Summary); every path (panel, tables, CLI) comes through here.
    if (locked.itemType === "project" && stage === "completed" && locked.stage !== "completed") {
      const { notifyProjectCompleted } = await import("@/lib/workflows/planner-notify");
      await notifyProjectCompleted(user.id, taskId);
    }
    // A2.1: a bug reaching Fixed tells its reporter and the people who see it too.
    if (locked.itemType === "bug" && stage === "fixed" && locked.stage !== "fixed") {
      const { notifyBugFixed } = await import("@/lib/workflows/bug-notify");
      await notifyBugFixed(taskId, user.id);
    }
    return { success: true as const, updatedAt: result.updatedAt.toISOString(), status: result.status, reviewStatus: result.reviewStatus, outcome: result.outcome, warnings };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t move this item" };
  }
}

// ---- Projects (report 38.5 T1, plan A1.3) ----
const partOfSchema = z.object({ projectId: z.string().uuid(), taskIds: z.array(z.string().uuid()).min(1).max(100), partOfId: z.string().uuid().nullable() });

/**
 * W3: put tasks into a project (or take them out). Every task passes the usual write check; projects and off-board
 * items can't be Part of; the parent must be a project in the same workspace.
 */
export async function setPartOfAction(input: z.infer<typeof partOfSchema>) {
  try {
    const { projectId, taskIds, partOfId } = partOfSchema.parse(input);
    const user = await requireTaskWriter();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    // Call 11 (A1.1): organizations keep the board only, so their work never joins a project.
    if ((await getWorkspaceAccessById(projectId, user.id)).project?.kind === "organization") return { success: false as const, error: "Projects aren’t available in organizations" };
    await db.transaction(async (tx) => {
      if (partOfId) {
        const [parent] = await tx.select({ itemType: tasks.itemType }).from(tasks).where(and(eq(tasks.id, partOfId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1).for("share");
        if (!parent || !canBeParent(parent.itemType)) throw new Error("Part of must be a project in this workspace");
      }
      for (const taskId of taskIds) {
        const locked = await lockTaskForWrite(tx, taskId, user.id);
        if (locked.projectId !== projectId) throw new Error("Task does not belong to this workspace");
        const [row] = await tx.select({ itemType: tasks.itemType, kind: tasks.kind }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (row?.kind === "assignment") throw new Error("Assignments can’t be Part of a project");
        if (partOfId && (!row || !canBePartOf(row.itemType) || taskId === partOfId)) throw new Error("A project can’t be Part of another project");
        await tx.update(tasks).set({ partOfId, updatedAt: new Date() }).where(eq(tasks.id, taskId));
      }
    });
    return { success: true as const, count: taskIds.length };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t change Part of" };
  }
}

// ---- Change type (report 38.6 rollout 3, plan A2.3) ----
const changeTypeSchema = z.object({ projectId: z.string().uuid(), taskIds: z.array(z.string().uuid()).min(1).max(100), toType: z.string().min(1).max(40), stage: z.string().min(1).max(40).optional() });

/**
 * Turn plain tasks into another type (bugs today). The stage defaults to Confirmed, Fixing once work started, Fixed
 * when done, and must keep the task's status (a type change never moves work). Leaving the board takes it out of its
 * sprint, which only owners and admins do (decision 146). Assignments and projects keep their type.
 */
export async function changeTaskTypeAction(input: z.infer<typeof changeTypeSchema>) {
  try {
    const { projectId, taskIds, toType, stage } = changeTypeSchema.parse(input);
    const user = await requireTaskWriter();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const { WORKFLOW_TYPES } = await import("@/lib/workflows/types");
    const { WORKFLOW_CATALOG } = await import("@/lib/workflows/catalog");
    const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
    const { changeTypeOptions } = await import("@/lib/workflows/bugs");
    const { isOnBoard } = await import("@/lib/workflows/rules");
    const type = WORKFLOW_TYPES[toType];
    const entry = WORKFLOW_CATALOG.find((w) => w.types.includes(toType));
    if (!type || !entry || toType !== "bug") return { success: false as const, error: "Tasks can change to a bug" };
    if (!(await readWorkspaceWorkflows(projectId, user.id)).added.some((w) => w.workflow === entry.id)) return { success: false as const, error: `${entry.name} isn’t in this workspace` };
    const via = await viaPayload();
    await db.transaction(async (tx) => {
      for (const taskId of taskIds) {
        const locked = await lockTaskForWrite(tx, taskId, user.id);
        if (locked.projectId !== projectId) throw new Error("Task does not belong to this workspace");
        const [row] = await tx.select({ kind: tasks.kind }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (row?.kind === "assignment") throw new Error("Assignments keep their type");
        // Report 38.7 W4.4 (A2.4): a New request can become a bug too (This is a bug); the asker stays Reported by.
        if (locked.itemType !== "task" && !(locked.itemType === "request" && locked.stage === "new")) throw new Error(`${locked.taskNumber ? `#${locked.taskNumber}` : "This"} is already a ${WORKFLOW_TYPES[locked.itemType]?.label.toLowerCase() ?? locked.itemType}`);
        const options = changeTypeOptions(locked.currentStatus);
        const to = stage ?? options[0]!;
        if (!options.includes(to)) throw new Error("Pick a stage that matches where the task is now");
        const onBoard = isOnBoard(toType, to);
        if (!onBoard && locked.previousSprintId && !locked.isLeader) throw new Error("This is in a sprint. Ask an owner or admin to change its type.");
        await tx.update(tasks).set({ itemType: toType, stage: to, typeFields: {}, onBoard, ...(!onBoard && { sprintId: null }), updatedAt: new Date() }).where(eq(tasks.id, taskId));
        if (!onBoard && locked.previousSprintId) {
          await tx.update(sprintTaskMemberships).set({ removedAt: new Date(), removedBy: user.id })
            .where(and(eq(sprintTaskMemberships.taskId, taskId), isNull(sprintTaskMemberships.removedAt)));
          await tx.insert(taskActivityEvents).values({
            taskId, projectId, sprintId: locked.previousSprintId, actorId: user.id, eventType: "removed_from_sprint",
            payload: { ...via, version: 1, taskTitle: locked.title, taskNumber: locked.taskNumber, taskStatus: locked.currentStatus, reason: "moved_back", toStage: to, itemType: toType, nextSprintId: null },
          });
        }
      }
    });
    return { success: true as const, count: taskIds.length };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t change the type" };
  }
}

/** W3.4: Group into a project: a new project (Not started) holding the chosen tasks. */
export async function groupIntoProjectAction(input: { projectId: string; taskIds: string[]; name: string }) {
  const name = String(input?.name ?? "").trim().slice(0, 200);
  if (!name) return { success: false as const, error: "Name the project" };
  const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
  const created = await createTaskAction({ projectId: input.projectId, title: name, status: "todo", priority: "medium", itemType: "project", stage: "not_started" });
  if (!created.success || !("task" in created) || !created.task) return { success: false as const, error: created.error ?? "Couldn’t make the project" };
  const linked = await setPartOfAction({ projectId: input.projectId, taskIds: input.taskIds, partOfId: created.task.id });
  return linked.success ? { success: true as const, id: created.task.id } : linked;
}

/** W3 and W5: a project's work, its completion and subtask counts, for the panel's Work tab. */
export async function readProjectWorkAction(projectId: string, projectTaskId: string) {
  try {
    if (!z.string().uuid().safeParse(projectId).success || !z.string().uuid().safeParse(projectTaskId).success) return { success: false as const, error: "Not found" };
    const { user } = await requireAuthenticatedUser();
    const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
    if (!access.project || access.project.kind === "organization" || !canReadWorkspaceTab(access, "tasks")) return { success: false as const, error: "Not found" };
    const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    const work = await db.select({ id: tasks.id, taskNumber: tasks.taskNumber, title: tasks.title, status: tasks.status, stage: tasks.stage, itemType: tasks.itemType, dueDate: tasks.dueDate, assigneeId: tasks.assigneeId, sprintId: tasks.sprintId })
      .from(tasks).where(and(eq(tasks.partOfId, projectTaskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).orderBy(tasks.taskNumber).limit(200);
    const [project] = await db.select({ typeFields: tasks.typeFields }).from(tasks).where(and(eq(tasks.id, projectTaskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "project"), isNull(tasks.deletedAt))).limit(1);
    if (!project) return { success: false as const, error: "Not found" };
    const [subs] = await db.execute<{ done: number; total: number }>(sql`SELECT count(*) FILTER (WHERE completed)::int AS done, count(*)::int AS total FROM task_subtasks WHERE task_id = ${projectTaskId}`);
    const override = typeof project?.typeFields?.completionOverride === "number" ? (project.typeFields.completionOverride as number) : null;
    return {
      success: true as const, projectKey: ws?.key ?? null,
      work: work.map((w) => ({ ...w, dueDate: w.dueDate ? w.dueDate.toISOString() : null })),
      completion: completion(work, { done: subs?.done ?? 0, total: subs?.total ?? 0 }, override),
    };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load the work" };
  }
}

/** W1 (A1.3): the workspace's projects with dates, stage and completion worked out in SQL from their work. */
export async function readProjectsAction(projectId: string) {
  try {
    if (!z.string().uuid().safeParse(projectId).success) return { success: false as const, error: "Not found" };
    const { user } = await requireAuthenticatedUser();
    const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
    if (!access.project || access.project.kind === "organization" || !(access.isOwner || access.isMember)) return { success: false as const, error: "Not found" };
    const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    const rows = await db.execute<{ id: string; task_number: number | null; title: string; stage: string | null; status: string; priority: string; start_date: Date | null; due_date: Date | null; assignee_id: string | null; done: number; total: number; override: number | null }>(sql`
      SELECT p.id, p.task_number, p.title, p.stage, p.status, p.priority, p.start_date, p.due_date, p.assignee_id,
        (SELECT count(*) FILTER (WHERE w.status = 'done')::int FROM tasks w WHERE w.part_of_id = p.id AND w.deleted_at IS NULL AND w.stage IS DISTINCT FROM 'cancelled') AS done,
        (SELECT count(*)::int FROM tasks w WHERE w.part_of_id = p.id AND w.deleted_at IS NULL AND w.stage IS DISTINCT FROM 'cancelled') AS total,
        (p.type_fields->>'completionOverride')::int AS override
      FROM tasks p WHERE p.workspace_id = ${projectId}::uuid AND p.item_type = 'project' AND p.deleted_at IS NULL
      ORDER BY p.start_date NULLS LAST, p.task_number`);
    return {
      success: true as const, projectKey: ws?.key ?? null, deps: await projectDeps(projectId),
      projects: Array.from(rows).map((r) => ({
        id: r.id, taskNumber: r.task_number, title: r.title, stage: r.stage, status: r.status, priority: r.priority, assigneeId: r.assignee_id,
        startDate: r.start_date ? new Date(r.start_date).toISOString() : null, dueDate: r.due_date ? new Date(r.due_date).toISOString() : null,
        completion: completion(Array.from({ length: Number(r.total) }, (_, i) => ({ status: i < Number(r.done) ? "done" : "todo" })), { done: 0, total: 0 }, r.override),
      })),
    };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load projects" };
  }
}

/**
 * W5.3: complete a project. Its open work stays where it is, or goes to the Backlog (out of its sprint; owners and
 * admins, who plan sprints).
 */
export async function completeProjectAction(input: { projectId: string; projectTaskId: string; openTasks: "leave" | "backlog" }) {
  const moved = await setTaskStageAction({ taskId: input.projectTaskId, projectId: input.projectId, stage: "completed", toBacklog: true });
  if (!moved.success || input.openTasks !== "backlog") return moved;
  const user = await requireTaskWriter();
  const access = user ? await getWorkspaceAccessById(input.projectId, user.id) : null;
  if (!access || !(access.isOwner || access.memberRole === "admin")) return { ...moved, warnings: ["Only owners and admins move work to the Backlog"] };
  // Through the usual sprint change, so sprint history records each one leaving.
  const open = await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.partOfId, input.projectTaskId), eq(tasks.projectId, input.projectId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`, sql`${tasks.sprintId} IS NOT NULL`));
  for (const t of open) await updateTaskFieldAction(t.id, "sprintId", null, input.projectId);
  return moved;
}

// ---- Timeline (report 38.5 S3, S7, W4; plan A1.4) ----
const dayKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateInput = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), "Pick a valid date").nullable().optional();
const datesSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid(), startDate: dateInput, dueDate: dateInput });

/** Project-to-project waits in a workspace (the arrows), both ends live projects. */
async function projectDeps(projectId: string): Promise<Dep[]> {
  const rows = await db.execute<{ task_id: string; blocked_by_task_id: string }>(sql`
    SELECT d.task_id, d.blocked_by_task_id FROM task_dependencies d
    JOIN tasks a ON a.id = d.task_id AND a.workspace_id = ${projectId}::uuid AND a.item_type = 'project' AND a.deleted_at IS NULL
    JOIN tasks b ON b.id = d.blocked_by_task_id AND b.item_type = 'project' AND b.deleted_at IS NULL`);
  return Array.from(rows).map((r) => ({ taskId: r.task_id, blockedById: r.blocked_by_task_id }));
}

/**
 * S3: dragging or stretching a bar (and the Calendar keeping a span's length). Task edit rights; the start never after
 * the due date. Returns the projects that would now start before this one ends, with everything that would move with
 * them, so the page can ask (S7); nothing else moves here.
 */
export async function setTaskDatesAction(input: z.infer<typeof datesSchema>) {
  try {
    const { projectId, taskId, startDate, dueDate } = datesSchema.parse(input);
    const user = await requireTaskWriter();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const moved = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Task does not belong to this workspace");
      await assertAssignmentWrite(tx, taskId, { role: locked.orgRole, isHolder: locked.isHolder, onOrgBoard: locked.onOrgBoard }, "dueDate");
      const [row] = await tx.select({ startDate: tasks.startDate, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      const next = {
        startDate: startDate === undefined ? row?.startDate ?? null : startDate ? new Date(startDate) : null,
        dueDate: dueDate === undefined ? row?.dueDate ?? null : dueDate ? new Date(dueDate) : null,
      };
      if (next.startDate && next.dueDate && next.startDate > next.dueDate) throw new Error("The start date is after the due date");
      await tx.update(tasks).set({ ...next, updatedAt: new Date() }).where(eq(tasks.id, taskId));
      await tx.insert(taskActivityEvents).values({ taskId, projectId, sprintId: locked.previousSprintId, actorId: user.id, eventType: "field_updated",
        payload: { ...(await viaPayload()), version: 1, field: "dueDate", taskTitle: locked.title, taskNumber: locked.taskNumber, taskStatus: locked.currentStatus } });
      return { before: dayKey(row?.dueDate ?? null), after: dayKey(next.dueDate) };
    });
    const deps = await projectDeps(projectId);
    const direct = deps.filter((d) => d.blockedById === taskId).map((d) => d.taskId);
    if (!direct.length || !moved.after) return { success: true as const, conflicts: [], toShift: [], days: 0 };
    const rows = await db.select({ id: tasks.id, title: tasks.title, startDate: tasks.startDate, dueDate: tasks.dueDate }).from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), inArray(tasks.id, [taskId, ...dependentsToShift(taskId, deps)])));
    const late = conflicts(rows.map((r) => ({ id: r.id, start: dayKey(r.startDate), end: dayKey(r.dueDate) })), deps.filter((d) => d.blockedById === taskId));
    const shift = late.length ? dependentsToShift(taskId, deps) : [];
    // A1.6: the assignee of a project that now starts before this one ends hears about it (Normal).
    if (late.length) {
      const { notifyProjectConflicts } = await import("@/lib/workflows/planner-notify");
      await notifyProjectConflicts(user.id, { title: rows.find((r) => r.id === taskId)?.title ?? "its blocker", end: moved.after }, late.map((c) => c.blocked));
    }
    return {
      success: true as const,
      conflicts: late.map((c) => c.blocked),
      toShift: rows.filter((r) => shift.includes(r.id)).map((r) => ({ id: r.id, title: r.title })),
      days: moved.before ? daysBetween(moved.before, moved.after) : 0,
    };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t change the dates" };
  }
}

const shiftSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid(), days: z.number().int().min(-3660).max(3660) });

/** S7: move every project waiting on this one (through others too) by the same days, in one transaction. Undo is -days. */
export async function shiftDependentsAction(input: z.infer<typeof shiftSchema>) {
  try {
    const { projectId, taskId, days } = shiftSchema.parse(input);
    const user = await requireTaskWriter();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const ids = dependentsToShift(taskId, await projectDeps(projectId));
    if (!ids.length || !days) return { success: true as const, count: 0 };
    const blockerTitle = await db.transaction(async (tx) => {
      for (const id of ids) {
        const locked = await lockTaskForWrite(tx, id, user.id);
        if (locked.projectId !== projectId) throw new Error("Task does not belong to this workspace");
        await assertAssignmentWrite(tx, id, { role: locked.orgRole, isHolder: locked.isHolder, onOrgBoard: locked.onOrgBoard }, "dueDate");
        await tx.update(tasks).set({
          startDate: sql`${tasks.startDate} + make_interval(days => ${days})`,
          dueDate: sql`${tasks.dueDate} + make_interval(days => ${days})`,
          updatedAt: new Date(),
        }).where(eq(tasks.id, id));
      }
      const [blocker] = await tx.select({ title: tasks.title, taskNumber: tasks.taskNumber, status: tasks.status }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      await tx.insert(taskActivityEvents).values({ taskId, projectId, actorId: user.id, eventType: "field_updated",
        payload: { ...(await viaPayload()), version: 1, field: "dueDate", shifted: ids.length, days, taskTitle: blocker?.title ?? "", taskNumber: blocker?.taskNumber ?? null, taskStatus: blocker?.status ?? "todo" } });
      return blocker?.title ?? "its blocker";
    });
    // A1.6: the moved projects' assignees get one Summary notice each.
    const { notifyProjectsShifted } = await import("@/lib/workflows/planner-notify");
    await notifyProjectsShifted(user.id, blockerTitle, ids, days, crypto.randomUUID());
    return { success: true as const, count: ids.length };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t move them" };
  }
}

const arrowSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid(), blockedById: z.string().uuid(), remove: z.boolean().optional() });

/** W4: an arrow from one project's end to another: the second is blocked by the first (task_dependencies, loop-checked). */
export async function setBlockedByAction(input: z.infer<typeof arrowSchema>) {
  try {
    const { projectId, taskId, blockedById, remove } = arrowSchema.parse(input);
    const user = await requireTaskWriter();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const names = new Map((await db.select({ id: tasks.id, title: tasks.title }).from(tasks)
      .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, [taskId, blockedById]), isNull(tasks.deletedAt)))).map((r) => [r.id, r.title]));
    if (names.size !== 2) return { success: false as const, error: "Both must be in this workspace" };
    const { updateTaskMeta, TaskMetaError } = await import("@/lib/domain/task-meta");
    try {
      await updateTaskMeta(user.id, taskId, { blockedBy: remove ? { remove: [blockedById] } : { add: [blockedById] } });
    } catch (error) {
      if (error instanceof TaskMetaError && /waits on this task/.test(error.message)) {
        return { success: false as const, error: `That would make a loop: ${names.get(blockedById)} is blocked by ${names.get(taskId)}` };
      }
      throw error;
    }
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t change what it waits on" };
  }
}

export async function moveTaskToWorkflowColumnAction(
  taskId: string,
  projectId: string,
  workflowColumnId: string,
  position?: number,
  expectedUpdatedAt?: string | null,
  /** Assignment flow decision 6: what's in the way, when a copy goes to Blocked. Kept on the move's event. */
  options: { note?: string | null } = {},
) {
  try {
    const note = typeof options?.note === "string" ? options.note.trim().slice(0, 500) : "";
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
      // Members move their own or unassigned tasks; leads move any (the board mirrors this). Assignment flow decision 7:
      // a team's or a group workspace's copy is moved by anyone who holds it, not only its lead.
      if (!locked.isLeader && !locked.isHolder && locked.previousAssigneeId && locked.previousAssigneeId !== user.id)
        throw new Error("Only the assignee, the owner or an admin can move this task.");
      if (expectedVersion && new Date(locked.currentUpdatedAt).getTime() !== expectedVersion.getTime())
        throw new Error("This task changed elsewhere. Reload and try again.");
      return { locked, result: await transitionTaskTx(tx, locked, { taskId, userId: user.id, columnId: workflowColumnId, position, ...(note ? { note } : {}) }) };
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

    // Browser session or a CLI/agent token on an allowed route (report A2.1: one implementation for both).
    const { user } = await requireAuthenticatedUser();
    if (!user) {
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
          // B3: a typed item takes its done stage (Fixed, Delivered, Scheduled) only now.
          ...(locked.itemType !== "task" && locked.stage && { stage: boardMove(locked.itemType, locked.stage, "done", false).stage }),
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
