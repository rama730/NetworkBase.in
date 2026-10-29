import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { workspaceNodes, taskNodeLinks, tasks } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { orgFileAccessSql, projectContentNodeSql } from "@/lib/files/internal-helpers";
import { eq, and, inArray, isNull, gt, or } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { z } from "zod";

const folderCursorSchema = z.object({
  type: z.enum(["file", "folder"]),
  name: z.string(),
  id: z.string().uuid(),
});

const folderQuerySchema = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  parentPath:z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(2048).optional(),
});

function decodeFolderCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return folderCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

function encodeFolderCursor(value: { type: string; name: string; id: string }) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    const { searchParams } = new URL(request.url);
    const rawParentId = searchParams.get("parentId")?.trim();
    const parsedQuery = folderQuerySchema.safeParse({
      projectId: searchParams.get("projectId")?.trim(),
      parentPath:searchParams.get("parentPath")||undefined,
      parentId: rawParentId && rawParentId !== "null" && rawParentId !== "undefined" ? rawParentId : null,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor")?.trim() || undefined,
    });
    if (!parsedQuery.success) return jsonError("Invalid folder query", 400, "BAD_REQUEST");

    const { projectId, limit, cursor: rawCursor } = parsedQuery.data;
    let parentId=parsedQuery.data.parentId;
    const cursor = decodeFolderCursor(rawCursor);
    if (rawCursor && !cursor) return jsonError("Invalid folder cursor", 400, "BAD_REQUEST");

    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project) {
      return jsonError("Workspace not found", 404, "NOT_FOUND");
    }
    // Files visibility for the listing; task-owned and /.system nodes also need Tasks (AUTH-002).
    if (!canReadWorkspaceTab(access, "files")) {
      return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    }

    if(parsedQuery.data.parentPath&&parsedQuery.data.parentPath!=="/"){
      const folder=await db.query.workspaceNodes.findFirst({where:and(eq(workspaceNodes.projectId,projectId),eq(workspaceNodes.path,parsedQuery.data.parentPath),eq(workspaceNodes.type,"folder"),isNull(workspaceNodes.deletedAt),canReadWorkspaceTab(access,"tasks")?undefined:projectContentNodeSql,orgFileAccessSql(access)),columns:{id:true}});
      if(!folder)return jsonError("Folder not found",404,"NOT_FOUND");if(parentId&&parentId!==folder.id)return jsonError("Folder identity mismatch",400,"BAD_REQUEST");parentId=folder.id;
    }
    // Find the child nodes
    const rows = await db.query.workspaceNodes.findMany({
      where: and(
        eq(workspaceNodes.projectId, projectId),
        parentId ? eq(workspaceNodes.parentId, parentId) : isNull(workspaceNodes.parentId),
        isNull(workspaceNodes.deletedAt),
        canReadWorkspaceTab(access, "tasks") ? undefined : projectContentNodeSql,
        orgFileAccessSql(access),
        cursor
          ? or(
              gt(workspaceNodes.type, cursor.type),
              and(eq(workspaceNodes.type, cursor.type), gt(workspaceNodes.name, cursor.name)),
              and(
                eq(workspaceNodes.type, cursor.type),
                eq(workspaceNodes.name, cursor.name),
                gt(workspaceNodes.id, cursor.id),
              ),
            )
          : undefined,
      ),
      columns: {
        id: true,
        name: true,
        type: true,
        path: true,
        s3Key: true,
        size: true,
        mimeType: true,
        currentVersion: true,
        syncStatus: true,
        updatedAt: true,
      },
      orderBy: (n, { asc }) => [asc(n.type), asc(n.name), asc(n.id)],
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const children = hasMore ? rows.slice(0, limit) : rows;
    const lastChild = children.at(-1);
    const nextCursor = hasMore && lastChild
      ? encodeFolderCursor({ type: lastChild.type, name: lastChild.name, id: lastChild.id })
      : null;

    const childIds = children.map((n) => n.id);
    const linkedTaskRows = childIds.length
      ? await db
          .select({
            nodeId: taskNodeLinks.nodeId,
            taskId: taskNodeLinks.taskId,
            title: tasks.title,
            taskNumber: tasks.taskNumber,
          })
          .from(taskNodeLinks)
          .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
          .where(
            and(
              inArray(taskNodeLinks.nodeId, childIds),
              eq(tasks.projectId, projectId),
              isNull(tasks.deletedAt)
            )
          )
      : [];

    const linkedTaskMap = new Map<string, Array<{ id: string; title: string | null; taskNumber: number | null }>>();
    for (const row of linkedTaskRows) {
      const existing = linkedTaskMap.get(row.nodeId) ?? [];
      existing.push({
        id: row.taskId,
        title: row.title,
        taskNumber: row.taskNumber,
      });
      linkedTaskMap.set(row.nodeId, existing);
    }

    return jsonSuccess({
      children: children.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        path: n.path,
        s3Key: n.s3Key,
        size: n.size,
        mimeType: n.mimeType,
        currentVersion: n.currentVersion,
        syncStatus: n.syncStatus,
        linkedTasks: linkedTaskMap.get(n.id) ?? [],
        updatedAt: n.updatedAt?.toISOString?.() ?? n.updatedAt,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    logger.error("[api/v1/extension/folder] Failed to get folder content", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError("Couldn’t get folder content", 500, "INTERNAL_ERROR");
  }
}
