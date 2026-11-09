import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  workspaceMembers,
  workspaceNodes,
  workspaceWorkflowColumns,
  taskActivityEvents,
  taskNodeLinks,
  tasks,
} from "@/lib/db/schema";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";
import { queueCounterRefreshBestEffort } from "@/lib/my-work/counter-buffer";
import { getTaskFileWarnings } from "@/lib/workspaces/task-file-intelligence";
import { logger } from "@/lib/logger";
import { orgCan, orgRoleOf, type ChildRole, type OrgRole } from "@/lib/organizations/permissions";
import { projectTaskHref } from "@/lib/workspaces/task-presentation";
import { taskReviewSnapshot } from "@/lib/workspaces/task-review-snapshot";
import { assertAssignmentWrite } from "@/lib/organizations/assignments";
import { viaPayload } from "@/lib/server/request-via";

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
export const MAIN_ASSIGNMENT_NOT_REVIEWED = "A main assignment isn’t reviewed. Review each person’s copy from In review.";

export async function lockTaskForWrite(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  taskId: string,
  userId: string,
): Promise<{
  projectId: string;
  isOwner: boolean;
  isLeader: boolean;
  /** The actor's column in the permissions table for the organization this work belongs to. */
  orgRole: OrgRole;
  /** In a workspace inside an organization, the actor's column in the workspace rows of the table. */
  childRole: ChildRole;
  isHolder: boolean;
  onOrgBoard: boolean;
  ownerId: string;
  reviewRequired: boolean;
  reviewContentHash: string | null;
  policyVersion: number;
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
  /** An assignment copy (0244): its master's submission type, or null for ordinary tasks. */
  copySubmissionType: string | null;
  isTeamMember: boolean;
  /** An organization's main assignment (decision 14): no state of its own, never reviewed. */
  isMaster: boolean;
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
    updated_at: Date | string;
    owner_id: string;
    task_review_required: boolean;
    task_completion_policy_version: number;
    review_content_hash: string | null;
    slug: string | null;
    key: string | null;
    deleted_at: Date | string | null;
    task_deleted_at: Date | string | null;
    member_role: string | null;
    assignment_id: string | null;
    master_settings: { submissionType?: string; reviewRequired?: boolean } | null;
    in_team: boolean;
    kind: string | null;
    org_role: string | null;
    project_kind: string | null;
    parent_org_admin: boolean;
  }>(sql`
        SELECT
            t.id, t.workspace_id AS project_id, t.assignee_id, t.sprint_id, t.workflow_column_id,
            t.timeline_origin_sprint_id, t.creator_id, t.title, t.task_number,
            t.status, t.review_status, t.review_content_hash, t.updated_at, t.deleted_at AS task_deleted_at,
            p.owner_id, p.slug, p.key, p.deleted_at, p.task_review_required, p.task_completion_policy_version,
            m.role as member_role,
            t.assignment_id, t.kind,
            mt.assignment_settings AS master_settings,
            EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = ${userId}) AS in_team,
            -- The actor's role in the organization the work belongs to: a copy's assignment's org, or this org's board.
            (SELECT CASE WHEN o.owner_id = ${userId} THEN 'owner'
                    ELSE (SELECT om.role FROM workspace_members om WHERE om.workspace_id = o.id AND om.user_id = ${userId}) END
             FROM workspaces o WHERE o.id = CASE WHEN t.assignment_id IS NOT NULL THEN mp.id WHEN p.kind = 'organization' THEN p.id END) AS org_role,
            p.kind AS project_kind,
            -- Decision 139: an organization admin moves a workspace's tasks without being on its team.
            (p.parent_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM workspaces po WHERE po.id = p.parent_id AND po.kind = 'organization' AND po.deleted_at IS NULL AND (po.owner_id = ${userId}
                OR EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = po.id AND pm.user_id = ${userId} AND pm.role = 'admin'))
            )) AS parent_org_admin
        FROM tasks t
        JOIN workspaces p ON p.id = t.workspace_id
        LEFT JOIN workspace_members m ON m.workspace_id = p.id AND m.user_id = ${userId}
        LEFT JOIN tasks mt ON mt.id = t.assignment_id
        LEFT JOIN workspaces mp ON mp.id = mt.workspace_id
        WHERE t.id = ${taskId}
        -- Audit N66: the task is locked; its workspace only shared, so moves on one board don't queue behind each other.
        FOR UPDATE OF t FOR SHARE OF p
    `);
  const row = Array.from(rows)[0];
  if (!row) {
    const [exists] = await tx.execute<{ id: string }>(
      sql`SELECT id FROM tasks WHERE id = ${taskId} LIMIT 1`,
    );
    if (!exists) {
      throw new Error("Task not found");
    }
    throw new Error("You don’t have access to this");
  }
  // COR-026: a deleted task is read-only; only its explicit restore may touch it.
  if (row.task_deleted_at) {
    throw new Error("This task was deleted");
  }
  if (row.deleted_at) {
    throw new Error("You don’t have access to this");
  }
  const isOwner = row.owner_id === userId;
  // Assignment copies are reviewed by the assignment's org (report §16.4, §16.6): its admins act as leaders,
  // even on a group copy inside a child project they are not members of.
  const isCopy = Boolean(row.assignment_id);
  const orgRole = orgRoleOf(row.org_role);
  // Decisions 33 and 109: the permissions table says who reviews a copy (approve_return).
  const orgReviewer = isCopy && orgCan(orgRole, "approve_return");
  if (!isOwner && !orgReviewer && !(row.parent_org_admin && !row.member_role)) {
    if (!row.member_role) {
      throw new Error("You don’t have access to this");
    }
    if (!["admin", "member"].includes((row.member_role ?? "").toLowerCase())) {
      throw new Error("You don’t have access to this");
    }
  }
  return {
    projectId: row.project_id,
    ownerId: row.owner_id,
    reviewRequired: isCopy ? row.master_settings?.reviewRequired === true : row.task_review_required,
    policyVersion: row.task_completion_policy_version,
    reviewContentHash: row.review_content_hash,
    isOwner,
    isLeader: isCopy ? orgReviewer : isOwner || (row.member_role ?? "").toLowerCase() === "admin" || (row.parent_org_admin && !row.member_role),
    previousAssigneeId: row.assignee_id ?? null,
    previousSprintId: row.sprint_id ?? null,
    currentWorkflowColumnId: row.workflow_column_id ?? null,
    timelineOriginSprintId: row.timeline_origin_sprint_id ?? null,
    creatorId: row.creator_id,
    title: row.title,
    taskNumber: row.task_number ?? null,
    currentStatus: row.status,
    reviewStatus: row.review_status,
    currentUpdatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    projectSlug: row.slug ?? null,
    projectKey: row.key ?? null,
    copySubmissionType: isCopy ? row.master_settings?.submissionType ?? "none" : null,
    isTeamMember: Boolean(row.in_team),
    orgRole,
    childRole: isOwner ? "lead" : row.member_role === "admin" ? "project_admin" : row.parent_org_admin ? "inherited_admin" : row.member_role ? "unit_member" : "visitor",
    // Their own work: the assignee, the team, or anyone in the workspace holding a group copy.
    isHolder: row.assignee_id === userId || Boolean(row.in_team) || (isCopy && row.project_kind !== "organization" && Boolean(row.member_role)),
    onOrgBoard: row.project_kind === "organization",
    isMaster: row.kind === "assignment" && !row.assignment_id,
  };
}

type TaskLock = Awaited<ReturnType<typeof lockTaskForWrite>>;
export type TaskTransitionResult = {
  updatedAt: Date;
  status: TaskStatus;
  reviewStatus: "none" | "pending" | "rejected";
  activityEventId: string | null;
  outcome?:
    | "submitted"
    | "completed"
    | "changes_requested"
    | "approved"
    | "moved";
  reviewRequired?: boolean;
  policyVersion?: number;
  reviewReason?: string;
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
    resubmit?: boolean;
    reviewReason?: string;
  },
): Promise<TaskTransitionResult> {
  const column = await tx.query.workspaceWorkflowColumns.findFirst({
    where: input.columnId
      ? and(
          eq(workspaceWorkflowColumns.id, input.columnId),
          eq(workspaceWorkflowColumns.projectId, locked.projectId),
        )
      : and(
          eq(workspaceWorkflowColumns.projectId, locked.projectId),
          eq(workspaceWorkflowColumns.status, input.status!),
          eq(workspaceWorkflowColumns.isDefault, true),
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

  if (
    !locked.isLeader &&
    !locked.isTeamMember &&
    locked.previousAssigneeId &&
    locked.previousAssigneeId !== input.userId
  )
    throw new Error("Only the assignee, the owner or an admin can move this task.");
  // Assignment work (report §19.3, decisions 85, 140, 147): only Submit hands a copy in, approved work is locked,
  // and a main assignment has no state of its own. Return and Resubmit are review actions with their own checks.
  // Live-fix 9: Request changes and Resubmit skip the check below, so a main assignment is refused here first.
  if (locked.isMaster && (input.reviewReason || input.resubmit)) throw new Error(MAIN_ASSIGNMENT_NOT_REVIEWED);
  if (!input.reviewReason && !input.resubmit) {
    await assertAssignmentWrite(tx, input.taskId, { role: locked.orgRole, isHolder: locked.isHolder, onOrgBoard: locked.onOrgBoard }, status === "done" && locked.currentStatus !== "done" ? "done" : "status");
  }
  // Audit 9.6: assignment work goes back through Hand in, with its checks and a new version.
  if (input.resubmit && locked.copySubmissionType != null) throw new Error("Use Hand in to send your work again.");
  if (input.resubmit && locked.reviewStatus !== "pending")
    throw new Error("Task is not pending review. Reload before submitting.");
  let reviewStatus = locked.reviewStatus;
  let outcome: TaskTransitionResult["outcome"] = "moved";
  if (locked.reviewStatus === "pending" && status !== "done") {
    if (!locked.isLeader)
      throw new Error("Only the owner and admins can request changes.");
    if (status !== "in_progress" || !input.reviewReason?.trim())
      throw new Error(
        "Use Request changes and provide a reason to return this task to In progress.",
      );
    reviewStatus = "rejected";
    outcome = "changes_requested";
  } else if (
    status === "done" &&
    (locked.currentStatus !== "done" || input.resubmit)
  ) {
    // Turning the setting off never approves an existing pending submission.
    reviewStatus =
      locked.reviewRequired || locked.reviewStatus === "pending"
        ? "pending"
        : "none";
    outcome = reviewStatus === "pending" ? "submitted" : "completed";
  } else if (status !== "done" && reviewStatus !== "rejected")
    reviewStatus = "none";

  const reviewContentHash =
    outcome === "submitted"
      ? await taskReviewSnapshot(tx, input.taskId, true)
      : undefined;
  const updatedAt = new Date();
  await tx
    .update(tasks)
    .set({
      workflowColumnId: column.id,
      status,
      reviewStatus,
      ...(outcome === "submitted" && {
        reviewSubmittedAt: updatedAt,
        reviewContentHash,
        completedAt: null,
        completedBy: null,
        completionSource: null,
      }),
      ...(outcome === "completed" && {
        completedAt: updatedAt,
        completedBy: input.userId,
        completionSource: "direct" as const,
        reviewSubmittedAt: null,
        reviewContentHash: null,
      }),
      ...(status !== "done" && {
        completedAt: null,
        completedBy: null,
        completionSource: null,
        reviewContentHash: null,
      }),
      ...(input.position !== undefined && { position: input.position }),
      updatedAt,
    })
    .where(eq(tasks.id, input.taskId));

  const statusChanged = locked.currentStatus !== status;
  const columnChanged = locked.currentWorkflowColumnId !== column.id;
  let activityEventId: string | null = null;
  if (statusChanged || columnChanged || input.resubmit || outcome === "changes_requested") {
    const via = await viaPayload();
    const [event] = await tx
      .insert(taskActivityEvents)
      .values({
        taskId: input.taskId,
        projectId: locked.projectId,
        sprintId: locked.previousSprintId,
        actorId: input.userId,
        eventType:
          outcome === "submitted"
            ? "review_submitted"
            : outcome === "changes_requested"
              ? "changes_requested"
              : statusChanged
                ? "status_changed"
                : "workflow_column_changed",
        payload:
          statusChanged || input.resubmit || outcome === "changes_requested"
            ? {
                ...via,
                version: 1,
                outcome,
                reviewRequired: locked.reviewRequired,
                policyVersion: locked.policyVersion,
                ...(input.reviewReason && {
                  reason: input.reviewReason.trim(),
                }),
                ...(reviewContentHash && { reviewContentHash }),
                taskTitle: locked.title,
                taskNumber: locked.taskNumber,
                taskStatus: status,
                from: locked.currentStatus,
                to: status,
              }
            : {
                ...via,
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
  return {
    updatedAt,
    status,
    reviewStatus,
    activityEventId,
    outcome,
    reviewRequired: locked.reviewRequired,
    policyVersion: locked.policyVersion,
    reviewReason: input.reviewReason?.trim(),
  };
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
            id: workspaceNodes.id,
            name: workspaceNodes.name,
            type: workspaceNodes.type,
            path: workspaceNodes.path,
            annotation: taskNodeLinks.annotation,
            tags: taskNodeLinks.tags,
            canonicalNodeId: workspaceNodes.canonicalNodeId,
          })
          .from(taskNodeLinks)
          .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
          .where(
            and(
              eq(taskNodeLinks.taskId, taskId),
              eq(workspaceNodes.projectId, locked.projectId),
              isNull(workspaceNodes.deletedAt),
            ),
          )
          .then((rows) =>
            getTaskFileWarnings({ status: result.status, attachments: rows }),
          )
          .catch((error) => {
            logger.error("tasks.file_warnings_failed", {
              taskId,
              error: String(error),
            });
            return [];
          })
      : [];

  await queueCounterRefreshBestEffort([locked.previousAssigneeId]);
  if (
    (result.status !== locked.currentStatus ||
      result.outcome === "submitted" ||
      result.outcome === "approved" ||
      result.outcome === "changes_requested") &&
    result.activityEventId
  ) {
    const recipients = new Set<string>();
    if (locked.creatorId !== user.id) recipients.add(locked.creatorId);
    if (locked.previousAssigneeId && locked.previousAssigneeId !== user.id)
      recipients.add(locked.previousAssigneeId);
    try {
      if (result.outcome === "submitted") {
        recipients.add(locked.ownerId);
        const leads = await db.query.workspaceMembers.findMany({
          where: and(
            eq(workspaceMembers.projectId, locked.projectId),
            eq(workspaceMembers.role, "admin"),
          ),
          columns: { userId: true },
        });
        for (const lead of leads) recipients.add(lead.userId);
      }
      recipients.delete(user.id);
      const outcomeText =
        result.reviewStatus === "pending"
          ? "submitted a task for review"
          : result.outcome === "changes_requested"
            ? "requested changes on a task"
            : result.outcome === "approved"
              ? "approved and completed a task"
              : result.status === "done"
                ? "completed a task"
                : `moved a task to ${result.status.replaceAll("_", " ")}`;
      const actor = taskActorSnapshot(user);
      await enqueueWorkspaceNotificationEvent({
        projectId: locked.projectId,
        actorUserId: user.id,
        ...actor,
        eventKey: "tasks.status_attention",
        taskParticipantIds: Array.from(recipients),
        title: `${actor.actorName || "Someone"} ${outcomeText}`,
        body: result.reviewReason
          ? `${locked.title} — Changes requested: ${result.reviewReason}`
          : locked.title,
        href: projectTaskHref(locked.projectSlug || locked.projectId, taskId),
        entityRefs: {
          projectId: locked.projectId,
          projectSlug: locked.projectSlug ?? null,
          taskId,
          status: result.status,
          reviewStatus: result.reviewStatus,
        },
        preview: {
          actorName: actor.actorName,
          actorAvatarUrl: actor.actorAvatarUrl,
          contextLabel: taskContextLabel(locked.projectKey, locked.taskNumber),
          contextKind: "task",
          secondaryText:
            result.reviewStatus === "pending" ? "In review" : result.status,
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
  revalidatePath(`/workspaces/${locked.projectId}`);
  return warnings;
}
