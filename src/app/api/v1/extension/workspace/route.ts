import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
} from "@/app/api/v1/_shared";
import crypto from "crypto";
import { db } from "@/lib/db";
import {
  profiles,
  projects,
  projectEventCounters,
  projectMembers,
  tasks,
  projectNodes,
  taskNodeLinks,
} from "@/lib/db/schema";
import { eq, and, inArray, isNull, isNotNull, or, gt, asc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  getProjectTaskCountMap,
  getProjectTaskFileCountMap,
  taskFileCountKey,
} from "@/app/api/v1/extension/_workspace-counts";

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

    const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id), columns: {fullName:true,username:true,avatarUrl:true} });
    const identity = {id:user.id,email:user.email,name:profile?.fullName || profile?.username || null,avatarUrl:profile?.avatarUrl || null};
    const url = new URL(request.url);
    const requestedProjectId = url.searchParams.get("projectId")?.trim();
    const requestedSlug=url.searchParams.get("slug")?.trim();
    const cursor=url.searchParams.get("cursor")?.trim();
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(requestedProjectId&&!uuid.test(requestedProjectId)||cursor&&!uuid.test(cursor)||requestedSlug&&requestedSlug.length>200)return jsonError("Invalid workspace page query",400,"BAD_REQUEST");
    const isSummaryMode = url.searchParams.get("mode") === "summary" || request.headers.get("x-nb-workspace-mode") === "summary";
    // 1. Fetch user's projects (via project memberships)
    const userProjects = await db
      .select({
        id: projects.id,
        name: projects.title,
        slug: projects.slug,
        description: projects.description,
        imageUrl: projects.coverImage,
        currentSequenceNumber: sql<number>`coalesce(${projectEventCounters.nextSequence}, ${projects.currentSequenceNumber})`,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(projectMembers, and(eq(projects.id, projectMembers.projectId),eq(projectMembers.userId,user.id)))
      .leftJoin(projectEventCounters, eq(projectEventCounters.projectId, projects.id))
      .where(
        and(or(eq(projects.ownerId,user.id),isNotNull(projectMembers.id)),isNull(projects.deletedAt),requestedProjectId?eq(projects.id,requestedProjectId):requestedSlug?eq(projects.slug,requestedSlug):cursor?gt(projects.id,cursor):undefined),
      ).orderBy(asc(projects.id)).limit(26);

    const filteredProjects=userProjects.slice(0,25);
    const projectPage={hasMore:userProjects.length>25,nextCursor:userProjects.length>25?filteredProjects.at(-1)!.id:null};

    const projectIds = filteredProjects.map((project) => project.id);
    const fileCounts=projectIds.length?await db.select({projectId:projectNodes.projectId,count:sql<number>`count(*)::int`}).from(projectNodes).where(and(inArray(projectNodes.projectId,projectIds),eq(projectNodes.type,"file"),isNull(projectNodes.deletedAt))).groupBy(projectNodes.projectId):[];
    const fileCountMap=new Map(fileCounts.map(row=>[row.projectId,Number(row.count)]));
    if (projectIds.length === 0) {
      return jsonSuccess({
        protocolVersion:2, minimumExtensionVersion:"1.2.0",projectPage,user: identity,
        projects: [],
      });
    }

    const watermark = filteredProjects
      .map((p) => `${p.id}:${p.currentSequenceNumber ?? 0}:${p.updatedAt?.getTime?.() ?? 0}`)
      .join(",");
    const workspaceEtag = `W/"ws-${user.id}-${isSummaryMode ? 'sum' : 'full'}-${crypto.createHash("md5").update(watermark + JSON.stringify(identity)).digest("hex")}"`;

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

    // ponytail: summary mode skips per-project task and file queries. ceiling: counts only until the IDE asks for full mode. upgrade: none; full mode already serves details.
    if (isSummaryMode) {
      const projectTaskCountMap = await getProjectTaskCountMap(projectIds);
      const summaryProjects = filteredProjects.map((project) => ({
        ...project,
        syncSequence: project.currentSequenceNumber,
        fileCount:fileCountMap.get(project.id)||0,
        taskCount: projectTaskCountMap.get(project.id) ?? 0,
        associatedTaskPreview: null,
        tasksTruncated: false,
        tasks: [],
        files: [],
      }));

      return jsonSuccess({
        protocolVersion:2, minimumExtensionVersion:"1.2.0",projectPage,user: identity,
        projects: summaryProjects,
      }, undefined, {
        headers: {
          ETag: workspaceEtag,
          "Cache-Control": "private, no-cache",
        },
      });
    }

    // Org rules (report §16.11, §23): members see masters and their own copies, and no Admins-only folders.
    const seesAllOf = (projectRef: ReturnType<typeof sql>) => sql`EXISTS (
      SELECT 1 FROM projects pr WHERE pr.id = ${projectRef} AND (pr.kind <> 'organization' OR pr.owner_id = ${user.id}::uuid
        OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pr.id AND pm.user_id = ${user.id}::uuid AND pm.role = 'admin'))
    )`;
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
              AND (${seesAllOf(sql`p.id`)} OR (kind = 'assignment' AND assignment_id IS NULL) OR assignee_id = ${user.id}::uuid
                OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = tasks.id AND tm.user_id = ${user.id}::uuid))
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
              AND (metadata->>'access' IS DISTINCT FROM 'admins' OR ${seesAllOf(sql`p.id`)})
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

    const projectsWithDetails = filteredProjects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const projectFilesMap = rootNodesByProject.get(project.id);
      const projectFiles = projectFilesMap ? Array.from(projectFilesMap.values()) : [];
      const taskCount = projectTaskCountMap.get(project.id) ?? 0;
      const singletonTask = taskCount === 1 ? (projectTasks[0] ?? null) : null;
      return {
        ...project,
        syncSequence: project.currentSequenceNumber,
        fileCount:fileCountMap.get(project.id)||0,
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
      protocolVersion:2, minimumExtensionVersion:"1.2.0",projectPage,user: identity,
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
      "Couldn’t fetch workspace details",
      500,
      "INTERNAL_ERROR",
    );
  }
}
