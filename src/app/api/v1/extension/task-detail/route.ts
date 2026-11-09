import { canSeeOrgTask } from "@/lib/organizations/assignments";
import { requireAuthenticatedUser, jsonSuccess, jsonError, getRequestId, denyOutsideTokenWorkspace } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import {
  taskActivityEvents,
  workspaces,
  profiles,
  tasks,
  taskSubtasks,
  taskComments,
  workspaceSprints,
  workspaceNodes,
  fileVersions,
  taskNodeLinks,
  taskPushes,
} from "@/lib/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { orgFileAccessSql, projectContentNodeSql } from "@/lib/files/internal-helpers";
import { inferTaskFileRole } from "@/lib/workspaces/task-file-intelligence";

import { taskReviewSnapshot } from "@/lib/workspaces/task-review-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const { searchParams } = new URL(request.url);
    const rawTaskId = searchParams.get("taskId")?.trim() || "";
    const queryProjectId = searchParams.get("projectId")?.trim() || "";
    const queryTaskNumber = searchParams.get("taskNumber")?.trim() || "";

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const numCandidate = queryTaskNumber || rawTaskId.replace(/^(?:[a-zA-Z]+-)?#?/, "");
    const parsedNumber = /^\d+$/.test(numCandidate) ? Number(numCandidate) : null;

    let rows: Array<{ id: string; projectId: string; title: string; taskNumber: number | null }> = [];

    if (UUID_REGEX.test(rawTaskId)) {
      rows = (await db.execute(sql`
        SELECT t.id, t.workspace_id AS "projectId", t.title, t.task_number AS "taskNumber"
        FROM tasks t
        WHERE t.id = ${rawTaskId}::uuid AND t.deleted_at IS NULL
        LIMIT 1
      `)) as unknown as Array<{ id: string; projectId: string; title: string; taskNumber: number | null }>;
    } else if (parsedNumber !== null && UUID_REGEX.test(queryProjectId)) {
      rows = (await db.execute(sql`
        SELECT t.id, t.workspace_id AS "projectId", t.title, t.task_number AS "taskNumber"
        FROM tasks t
        WHERE t.workspace_id = ${queryProjectId}::uuid
          AND t.task_number = ${parsedNumber}
          AND t.deleted_at IS NULL
        LIMIT 1
      `)) as unknown as Array<{ id: string; projectId: string; title: string; taskNumber: number | null }>;
    } else {
      return jsonError(
        rawTaskId ? "Invalid taskId format: must be a valid UUID or task number with projectId" : "Missing taskId",
        400,
        "BAD_REQUEST",
      );
    }

    const row = rows[0];
    if (!row) return jsonError("Task not found", 404, "NOT_FOUND");
    const outside = await denyOutsideTokenWorkspace(authResult, { projectId: row.projectId });
    if (outside) return outside;
    const taskId = row.id;

    // Canonical rule: drafts/private for owners+members only, task data needs
    // Tasks visibility, linked project files also need Files (AUTH-002).
    const access = await getWorkspaceAccessById(row.projectId, user.id);
    if (!canReadWorkspaceTab(access, "tasks")) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    if (!(await canSeeOrgTask(access, user.id, taskId))) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    const canReadFiles = canReadWorkspaceTab(access, "files");

    const fullTask = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
    if (!fullTask) return jsonError("Task not found", 404, "NOT_FOUND");
    const [subtasks, assignee, sprint, policy, commentRows] = await Promise.all([
      db
        .select()
        .from(taskSubtasks)
        .where(eq(taskSubtasks.taskId, taskId))
        .orderBy(asc(taskSubtasks.position), asc(taskSubtasks.createdAt)),
      fullTask.assigneeId
        ? db.query.profiles.findFirst({
            where: eq(profiles.id, fullTask.assigneeId),
            columns: { id: true, fullName: true, username: true, avatarUrl: true },
          })
        : null,
      fullTask.sprintId
        ? db.query.workspaceSprints.findFirst({
            where: eq(workspaceSprints.id, fullTask.sprintId),
            columns: { id: true, name: true },
          })
        : null,
      db.query.workspaces.findFirst({
        where: eq(workspaces.id, row.projectId),
        columns: { taskReviewRequired: true, taskCompletionPolicyVersion: true },
      }),
      db
        .select({
          id: taskComments.id,
          content: taskComments.content,
          createdAt: taskComments.createdAt,
          authorName: profiles.fullName,
          authorUsername: profiles.username,
        })
        .from(taskComments)
        .leftJoin(profiles, eq(profiles.id, taskComments.userId))
        .where(and(eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt)))
        .orderBy(desc(taskComments.createdAt))
        .limit(20),
    ]);
    const reviewContentChanged =
      fullTask.reviewStatus === "pending" &&
      (!fullTask.reviewContentHash || fullTask.reviewContentHash !== (await taskReviewSnapshot(db, taskId)));
    const latestRequest =
      fullTask.reviewStatus === "rejected"
        ? await db.query.taskActivityEvents.findFirst({
            where: and(eq(taskActivityEvents.taskId, taskId), eq(taskActivityEvents.eventType, "changes_requested")),
            orderBy: [desc(taskActivityEvents.createdAt)],
          })
        : null;
    const canWrite = access.isOwner || ["admin", "member"].includes(access.member?.role || "");
    const task = {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      taskNumber: row.taskNumber,
    };

    const [fileRows, pushRows] = await Promise.all([
      db
        .select({
          node: workspaceNodes,
          order: taskNodeLinks.order,
          annotation: taskNodeLinks.annotation,
          tags: taskNodeLinks.tags,
          linkedAt: taskNodeLinks.linkedAt,
          contentHash: fileVersions.contentHash,
        })
        .from(taskNodeLinks)
        .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
        .leftJoin(
          fileVersions,
          and(
            eq(fileVersions.nodeId, workspaceNodes.id),
            eq(fileVersions.version, workspaceNodes.currentVersion),
          ),
        )
        .where(
          and(
            eq(taskNodeLinks.taskId, taskId),
            eq(workspaceNodes.projectId, task.projectId),
            isNull(workspaceNodes.deletedAt),
            canReadFiles ? undefined : sql`NOT (${projectContentNodeSql})`,
            orgFileAccessSql(access),
          ),
        )
        .orderBy(taskNodeLinks.order, workspaceNodes.name),
      db
        .select({
          id: taskPushes.id,
          message: taskPushes.message,
          filesCount: taskPushes.filesCount,
          pushedAt: taskPushes.pushedAt,
          filesJson: taskPushes.filesJson,
          pushedByName: profiles.fullName,
        })
        .from(taskPushes)
        .leftJoin(profiles, eq(taskPushes.pushedBy, profiles.id))
        .where(eq(taskPushes.taskId, taskId))
        .orderBy(desc(taskPushes.pushedAt))
        .limit(25),
    ]);

    const enrichedSubtasks = subtasks.map((st, idx) => ({
      ...st,
      index: idx + 1,
    }));
    const completedSubtasksCount = enrichedSubtasks.filter((st) => st.completed).length;

    const enrichedFiles = fileRows.map((fRow) => {
      const role = inferTaskFileRole({
        id: fRow.node.id,
        name: fRow.node.name,
        type: fRow.node.type,
        path: fRow.node.path,
        annotation: fRow.annotation,
        tags: fRow.tags,
      });
      return {
        id: fRow.node.id,
        nodeId: fRow.node.id,
        name: fRow.node.name,
        type: fRow.node.type,
        path: fRow.node.path,
        s3Key: fRow.node.s3Key,
        size: fRow.node.size,
        mimeType: fRow.node.mimeType,
        currentVersion: fRow.node.currentVersion,
        contentHash: fRow.contentHash || null,
        syncStatus: fRow.node.syncStatus,
        role,
        tags: fRow.tags || [],
        annotation: fRow.annotation || null,
        order: fRow.order,
        linkedTasks: [{ id: taskId, title: task.title, taskNumber: task.taskNumber }],
        updatedAt: fRow.node.updatedAt?.toISOString?.() ?? fRow.node.updatedAt,
      };
    });

    const filesByRole = {
      reference: enrichedFiles.filter((f) => f.role === "reference"),
      working: enrichedFiles.filter((f) => f.role === "working"),
      deliverable: enrichedFiles.filter((f) => f.role === "deliverable"),
    };

    return jsonSuccess({
      task: {
        ...fullTask,
        reviewContentChanged,
        reviewReason: typeof latestRequest?.payload?.reason === "string" ? latestRequest.payload.reason : null,
        assignee: assignee
          ? {
              id: assignee.id,
              name: assignee.fullName,
              username: assignee.username,
              avatarUrl: assignee.avatarUrl,
            }
          : null,
        sprint,
      },
      subtasks: enrichedSubtasks,
      subtaskSummary: {
        completed: completedSubtasksCount,
        total: enrichedSubtasks.length,
      },
      capabilities: {
        canUpdate:
          canWrite &&
          (access.isOwner ||
            access.member?.role === "admin" ||
            !fullTask.assigneeId ||
            fullTask.assigneeId === user.id),
        canApprove: access.isOwner || access.member?.role === "admin",
        canReadFiles,
        reviewRequired: policy?.taskReviewRequired ?? false,
        policyVersion: policy?.taskCompletionPolicyVersion ?? 0,
      },
      files: enrichedFiles,
      filesByRole,
      comments: commentRows.map((c) => ({
        id: c.id,
        content: c.content,
        authorName: c.authorName || c.authorUsername || "Member",
        authorUsername: c.authorUsername || null,
        createdAt: c.createdAt.toISOString(),
      })),
      pushes: pushRows.map((pRow) => ({
        id: pRow.id,
        message: pRow.message,
        filesCount: pRow.filesCount,
        pushedAt: pRow.pushedAt.toISOString(),
        files: pRow.filesJson,
        pushedByName: pRow.pushedByName || "Member",
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/extension/task-detail", fallback: "Couldn’t get task detail" });
  }
}
