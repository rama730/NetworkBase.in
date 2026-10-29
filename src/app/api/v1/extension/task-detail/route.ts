import { canSeeOrgTask } from "@/lib/organizations/assignments";
import { requireAuthenticatedUser, jsonSuccess, jsonError, getRequestId } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import { taskActivityEvents, workspaces, profiles, tasks, taskSubtasks, workspaceSprints, workspaceNodes, taskNodeLinks, taskPushes, } from "@/lib/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { orgFileAccessSql, projectContentNodeSql } from "@/lib/files/internal-helpers";

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
    const taskId = searchParams.get("taskId")?.trim();
    if (!taskId) return jsonError("Missing taskId", 400, "BAD_REQUEST");
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(taskId)) {
      return jsonError("Invalid taskId format: must be a valid UUID", 400, "BAD_REQUEST");
    }

    const rows = (await db.execute(sql`
      SELECT t.id, t.workspace_id AS "projectId", t.title, t.task_number AS "taskNumber"
      FROM tasks t
      WHERE t.id = ${taskId}::uuid AND t.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ id: string; projectId: string; title: string; taskNumber: number | null }>;

    const row = rows[0];
    if (!row) return jsonError("Task not found", 404, "NOT_FOUND");

    // Canonical rule: drafts/private for owners+members only, task data needs
    // Tasks visibility, linked project files also need Files (AUTH-002).
    const access = await getWorkspaceAccessById(row.projectId, user.id);
    if (!canReadWorkspaceTab(access, "tasks")) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    if (!(await canSeeOrgTask(access, user.id, taskId))) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    const canReadFiles = canReadWorkspaceTab(access, "files");

    const fullTask = await db.query.tasks.findFirst({where:eq(tasks.id,taskId)});
    if (!fullTask) return jsonError("Task not found",404,"NOT_FOUND");
    const [subtasks, assignee, sprint] = await Promise.all([
      db.select().from(taskSubtasks).where(eq(taskSubtasks.taskId,taskId)).orderBy(taskSubtasks.position),
      fullTask.assigneeId ? db.query.profiles.findFirst({where:eq(profiles.id,fullTask.assigneeId),columns:{id:true,fullName:true,avatarUrl:true}}) : null,
      fullTask.sprintId ? db.query.workspaceSprints.findFirst({where:eq(workspaceSprints.id,fullTask.sprintId),columns:{id:true,name:true}}) : null,
    ]);
    const policy = await db.query.workspaces.findFirst({ where: eq(workspaces.id, row.projectId), columns: { taskReviewRequired: true, taskCompletionPolicyVersion: true } });
    const reviewContentChanged = fullTask.reviewStatus === "pending" && (!fullTask.reviewContentHash || fullTask.reviewContentHash !== await taskReviewSnapshot(db, taskId));
    const latestRequest = fullTask.reviewStatus === "rejected" ? await db.query.taskActivityEvents.findFirst({ where: and(eq(taskActivityEvents.taskId, taskId), eq(taskActivityEvents.eventType, "changes_requested")), orderBy: [desc(taskActivityEvents.createdAt)] }) : null;
    const canWrite = access.isOwner || ["admin","member"].includes(access.member?.role || "");
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
        })
        .from(taskNodeLinks)
        .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
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

    return jsonSuccess({
      task: {...fullTask, reviewContentChanged, reviewReason: typeof latestRequest?.payload?.reason === "string" ? latestRequest.payload.reason : null, assignee: assignee ? {id:assignee.id,name:assignee.fullName,avatarUrl:assignee.avatarUrl}:null,sprint},
      subtasks,
      capabilities: {canUpdate:canWrite && (access.isOwner || access.member?.role === "admin" || !fullTask.assigneeId || fullTask.assigneeId === user.id),canApprove:access.isOwner || access.member?.role === "admin",canReadFiles,reviewRequired:policy?.taskReviewRequired ?? false,policyVersion:policy?.taskCompletionPolicyVersion ?? 0},
      files: fileRows.map((row) => ({
        id: row.node.id,
        nodeId: row.node.id,
        name: row.node.name,
        type: row.node.type,
        path: row.node.path,
        s3Key: row.node.s3Key,
        size: row.node.size,
        mimeType: row.node.mimeType,
        currentVersion: row.node.currentVersion,
        syncStatus: row.node.syncStatus,
        linkedTasks: [{ id: taskId, title: task.title, taskNumber: task.taskNumber }],
        updatedAt: row.node.updatedAt?.toISOString?.() ?? row.node.updatedAt,
      })),
      pushes: pushRows.map((row) => ({
        id: row.id,
        message: row.message,
        filesCount: row.filesCount,
        pushedAt: row.pushedAt.toISOString(),
        files: row.filesJson,
        pushedByName: row.pushedByName || "Member",
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/extension/task-detail", fallback: "Couldn’t get task detail" });
  }
}
