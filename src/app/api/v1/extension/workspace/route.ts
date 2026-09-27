import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
} from "@/app/api/v1/_shared";
import crypto from "crypto";
import { db } from "@/lib/db";
import {
  projects,
  projectMembers,
  tasks,
  projectNodes,
  taskNodeLinks,
} from "@/lib/db/schema";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  getProjectTaskCountMap,
  getProjectTaskFileCountMap,
  taskFileCountKey,
} from "@/app/api/v1/extension/_project-counts";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    // 1. Fetch user's projects (via project memberships)
    const userProjects = await db
      .select({
        id: projects.id,
        name: projects.title,
        slug: projects.slug,
        description: projects.description,
        currentSequenceNumber: projects.currentSequenceNumber,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(projectMembers, eq(projects.id, projectMembers.projectId))
      .where(
        and(eq(projectMembers.userId, user.id), isNull(projects.deletedAt)),
      );

    const projectIds = userProjects.map((project) => project.id);
    if (projectIds.length === 0) {
      return jsonSuccess({
        user: { id: user.id, email: user.email },
        projects: [],
      });
    }

    const url = new URL(request.url);
    const isSummaryMode =
      url.searchParams.get("mode") === "summary" ||
      request.headers.get("x-nb-workspace-mode") === "summary";

    const watermark = userProjects
      .map((p) => `${p.id}:${p.currentSequenceNumber ?? 0}:${p.updatedAt?.getTime?.() ?? 0}`)
      .join(",");
    const workspaceEtag = `W/"ws-${user.id}-${isSummaryMode ? 'sum' : 'full'}-${crypto.createHash("md5").update(watermark).digest("hex")}"`;

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && (ifNoneMatch === workspaceEtag || ifNoneMatch.includes(workspaceEtag))) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: workspaceEtag,
          "Cache-Control": "private, no-cache",
        },
      });
    }

    // ponytail: fast bootstrap summary mode skips expensive window-partition task/file queries
    if (isSummaryMode) {
      const projectTaskCountMap = await getProjectTaskCountMap(projectIds);
      const summaryProjects = userProjects.map((project) => ({
        ...project,
        syncSequence: project.currentSequenceNumber,
        taskCount: projectTaskCountMap.get(project.id) ?? 0,
        associatedTaskPreview: null,
        tasksTruncated: false,
        tasks: [],
        files: [],
      }));

      return jsonSuccess({
        user: {
          id: user.id,
          email: user.email,
        },
        projects: summaryProjects,
      }, undefined, {
        headers: {
          ETag: workspaceEtag,
          "Cache-Control": "private, no-cache",
        },
      });
    }

    const [taskRowsResult, rootNodeIdRowsResult, taskFileCountMap, projectTaskCountMap] =
      await Promise.all([
        db.execute(sql`
          SELECT t.*
          FROM unnest(ARRAY[${sql.join(projectIds.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[]) AS p(id)
          CROSS JOIN LATERAL (
            SELECT id, project_id AS "projectId", title, description, status, priority,
                   task_number AS "taskNumber", updated_at AS "updatedAt"
            FROM tasks
            WHERE project_id = p.id AND deleted_at IS NULL
            ORDER BY updated_at DESC
            LIMIT 50
          ) t
        `),
        db.execute(sql`
          SELECT n.id
          FROM unnest(ARRAY[${sql.join(projectIds.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[]) AS p(id)
          CROSS JOIN LATERAL (
            SELECT id
            FROM project_nodes
            WHERE project_id = p.id
              AND parent_id IS NULL
              AND deleted_at IS NULL
            ORDER BY type, name, id
            LIMIT 100
          ) n
        `),
        getProjectTaskFileCountMap(projectIds),
        getProjectTaskCountMap(projectIds),
      ]);

    const rootNodeIds = (rootNodeIdRowsResult as unknown as Array<{ id: string }>).map((row) => row.id);
    const rootNodeRows = rootNodeIds.length === 0
      ? []
      : await db
          .select({
            node: projectNodes,
            linkedTaskId: tasks.id,
            linkedTaskTitle: tasks.title,
            linkedTaskNumber: tasks.taskNumber,
          })
          .from(projectNodes)
          .leftJoin(taskNodeLinks, eq(projectNodes.id, taskNodeLinks.nodeId))
          .leftJoin(tasks, and(eq(taskNodeLinks.taskId, tasks.id), isNull(tasks.deletedAt)))
          .where(inArray(projectNodes.id, rootNodeIds))
          .orderBy(projectNodes.projectId, projectNodes.type, projectNodes.name, projectNodes.id);

    const taskRows = taskRowsResult as unknown as Array<{
      id: string;
      projectId: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      taskNumber: number;
      updatedAt: string | Date;
    }>;

    const tasksByProject = new Map<string, typeof taskRows>();
    for (const task of taskRows) {
      const list = tasksByProject.get(task.projectId) ?? [];
      list.push(task);
      tasksByProject.set(task.projectId, list);
    }

    const rootNodesByProject = new Map<string, Map<string, any>>();
    for (const row of rootNodeRows) {
      const node = row.node;
      const projectMap = rootNodesByProject.get(node.projectId) ?? new Map<string, any>();
      
      let nodeObj = projectMap.get(node.id);
      if (!nodeObj) {
        nodeObj = {
          id: node.id,
          nodeId: node.id,
          name: node.name,
          type: node.type,
          path: node.path,
          s3Key: node.s3Key,
          size: node.size,
          mimeType: node.mimeType,
          currentVersion: node.currentVersion,
          syncStatus: node.syncStatus,
          linkedTasks: [],
          updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
        };
        projectMap.set(node.id, nodeObj);
      }
      if (row.linkedTaskId) {
        nodeObj.linkedTasks.push({
          id: row.linkedTaskId,
          title: row.linkedTaskTitle,
          taskNumber: row.linkedTaskNumber
        });
      }
      rootNodesByProject.set(node.projectId, projectMap);
    }

    const projectsWithDetails = userProjects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const projectFilesMap = rootNodesByProject.get(project.id);
      const projectFiles = projectFilesMap ? Array.from(projectFilesMap.values()) : [];
      const taskCount = projectTaskCountMap.get(project.id) ?? 0;
      const singletonTask = taskCount === 1 ? (projectTasks[0] ?? null) : null;
      return {
        ...project,
        syncSequence: project.currentSequenceNumber,
        taskCount,
        associatedTaskPreview: singletonTask
          ? {
              id: singletonTask.id,
              title: singletonTask.title,
              description: singletonTask.description,
              status: singletonTask.status,
              priority: singletonTask.priority,
              taskNumber: singletonTask.taskNumber,
              filesCount:
                taskFileCountMap.get(taskFileCountKey(project.id, singletonTask.id)) || 0,
            }
          : null,
        tasksTruncated: projectTasks.length < taskCount,
        tasks: projectTasks.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          taskNumber: task.taskNumber,
          filesCount: taskFileCountMap.get(taskFileCountKey(project.id, task.id)) || 0,
        })),
        files: projectFiles,
      };
    });

    return jsonSuccess({
      user: {
        id: user.id,
        email: user.email,
      },
      projects: projectsWithDetails,
    }, undefined, {
      headers: {
        ETag: workspaceEtag,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (error) {
    logger.error(
      "[api/v1/extension/workspace] Failed to fetch workspace details",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return jsonError(
      "Failed to fetch workspace details",
      500,
      "INTERNAL_ERROR",
    );
  }
}
