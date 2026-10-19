"use server";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { projects, tasks, projectMembers, roleApplications } from "@/lib/db/schema";
import { countPendingInvitationsForCandidate } from "@/lib/projects/project-invitations";
import { eq, and, isNull, sql, exists, ne, or, count } from "drizzle-orm";
import { canReviewProjectSql } from "@/lib/applications/reviewers";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";

function normalizeWorkspaceLimit(rawLimit: unknown, fallback = 24) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit);
    return Number.isFinite(parsed)
        ? Math.max(1, Math.min(Math.trunc(parsed), 100))
        : fallback;
}

/** Small drawer badges deliberately use scalar counts rather than task lists. */
export async function getWorkspaceSummaryAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false as const, error: "Not authenticated" };

        const [taskResult, applicationResult, inviteResult] = await Promise.all([
            db.select({ value: count() }).from(tasks).where(and(
                isNull(tasks.deletedAt),
                sql`${tasks.status} <> 'done'`,
                eq(tasks.assigneeId, user.id),
                exists(db.select({ id: projects.id }).from(projects).where(and(
                    eq(projects.id, tasks.projectId),
                    isNull(projects.deletedAt),
                    or(
                        eq(projects.ownerId, user.id),
                        exists(db.select({ id: projectMembers.id }).from(projectMembers).where(and(
                            eq(projectMembers.projectId, tasks.projectId),
                            eq(projectMembers.userId, user.id),
                        ))),
                    ),
                ))),
            )),
            db.select({ value: count() }).from(roleApplications).where(and(
                eq(roleApplications.status, "pending"),
                canReviewProjectSql(user.id, sql`${roleApplications.projectId}`),
            )),
            countPendingInvitationsForCandidate(user.id).then((value) => [{ value }]),
        ]);

        return {
            success: true as const,
            taskCount: taskResult[0]?.value ?? 0,
            requestCount: (applicationResult[0]?.value ?? 0) + (inviteResult[0]?.value ?? 0),
        };
    } catch (error) {
        console.error("Workspace summary fetch failed:", error);
        return { success: false as const, error: "Failed to fetch workspace summary" };
    }
}

/**
 * Fetch active tasks from projects the authenticated user can access.
 *
 * The workspace is an overview, not a personal-assignment inbox: the default
 * includes the team's open work so a collaborator can still see a project's
 * workload when nothing is assigned to them personally.
 */
export async function fetchWorkspaceTasksAction(
    limit: number = 24,
    scope: "my" | "team" | "all" = "all"
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Not authenticated" };
        }

        const safeLimit = normalizeWorkspaceLimit(limit);

        const baseWhere = and(
            isNull(tasks.deletedAt),
            sql`${tasks.status} <> 'done'`
        );

        const visibleProjectCheck = exists(
            db.select({ id: projects.id })
                .from(projects)
                .where(and(
                    eq(projects.id, tasks.projectId),
                    isNull(projects.deletedAt),
                    or(
                        eq(projects.ownerId, user.id),
                        exists(
                            db.select({ id: projectMembers.id })
                                .from(projectMembers)
                                .where(and(
                                    eq(projectMembers.projectId, tasks.projectId),
                                    eq(projectMembers.userId, user.id),
                                )),
                        ),
                    ),
                )),
        );

        let scopeWhere;
        if (scope === "my") {
            scopeWhere = and(visibleProjectCheck, eq(tasks.assigneeId, user.id));
        } else {
            if (scope === "team") {
                scopeWhere = and(
                    visibleProjectCheck,
                    or(isNull(tasks.assigneeId), ne(tasks.assigneeId, user.id)),
                );
            } else {
                scopeWhere = visibleProjectCheck;
            }
        }

        const taskPage = await db.query.tasks.findMany({
            where: and(baseWhere, scopeWhere),
            orderBy: (t, { asc, desc }) => [
                sql`CASE WHEN ${t.dueDate} IS NOT NULL AND ${t.dueDate} < now() THEN 0 ELSE 1 END`,
                sql`CASE ${t.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
                asc(t.dueDate),
                desc(t.updatedAt),
                desc(t.id),
            ],
            // Fetch one extra row so the compact drawer never silently hides work.
            limit: safeLimit + 1,
            with: {
                project: {
                    columns: { id: true, title: true, key: true, slug: true },
                },
                sprint: {
                    columns: { id: true, name: true, status: true },
                },
                assignee: {
                    columns: { id: true, fullName: true, username: true, avatarUrl: true },
                },
            }
        });

        const hasMore = taskPage.length > safeLimit;
        const page = taskPage.slice(0, safeLimit);
        const taskIds = page.map((task) => task.id);

        const countMap = new Map<string, { subtaskCount: number; completedSubtaskCount: number; fileCount: number; commentCount: number }>();
        if (taskIds.length > 0) {
            // Interpolating a JavaScript array directly into a Drizzle SQL template
            // produces a PostgreSQL record tuple: ($1, $2, ...). A tuple cannot be
            // cast to uuid[], which made the workspace drawer fail as soon as it
            // had tasks to enrich. Build an actual UUID array from typed scalars.
            const taskIdArray = sql`ARRAY[${sql.join(
                taskIds.map((taskId) => sql`${taskId}::uuid`),
                sql`, `,
            )}]::uuid[]`;
            const counts = (await db.execute(sql`
                WITH ids AS (
                    SELECT unnest(${taskIdArray}) AS id
                ),
                st AS (
                    SELECT task_id, count(*)::int AS subtask_count, count(*) FILTER (WHERE completed = true)::int AS completed_subtask_count
                    FROM task_subtasks
                    WHERE task_id = ANY(${taskIdArray})
                    GROUP BY task_id
                ),
                fl AS (
                    SELECT tnl.task_id, count(*)::int AS file_count
                    FROM task_node_links tnl
                    JOIN project_nodes pn ON pn.id = tnl.node_id
                    WHERE tnl.task_id = ANY(${taskIdArray}) AND pn.deleted_at IS NULL
                    GROUP BY tnl.task_id
                ),
                cm AS (
                    SELECT task_id, count(*)::int AS comment_count
                    FROM task_comments
                    WHERE task_id = ANY(${taskIdArray}) AND deleted_at IS NULL
                    GROUP BY task_id
                )
                SELECT 
                    ids.id::text AS task_id,
                    COALESCE(st.subtask_count, 0)::int AS subtask_count,
                    COALESCE(st.completed_subtask_count, 0)::int AS completed_subtask_count,
                    COALESCE(fl.file_count, 0)::int AS file_count,
                    COALESCE(cm.comment_count, 0)::int AS comment_count
                FROM ids
                LEFT JOIN st ON st.task_id = ids.id
                LEFT JOIN fl ON fl.task_id = ids.id
                LEFT JOIN cm ON cm.task_id = ids.id
            `)) as unknown as Array<{
                task_id: string;
                subtask_count: number;
                completed_subtask_count: number;
                file_count: number;
                comment_count: number;
            }>;

            for (const c of counts) {
                countMap.set(c.task_id, {
                    subtaskCount: Number(c.subtask_count ?? 0),
                    completedSubtaskCount: Number(c.completed_subtask_count ?? 0),
                    fileCount: Number(c.file_count ?? 0),
                    commentCount: Number(c.comment_count ?? 0),
                });
            }
        }

        const normalized = page.map((task) => {
            const counts = countMap.get(task.id) ?? { subtaskCount: 0, completedSubtaskCount: 0, fileCount: 0, commentCount: 0 };
            return {
                ...normalizeTaskSurfaceRecord({
                    ...task,
                    subtaskCount: counts.subtaskCount,
                    completedSubtaskCount: counts.completedSubtaskCount,
                    fileCount: counts.fileCount,
                    commentCount: counts.commentCount,
                }),
                project: task.project,
                sprint: task.sprint,
                assignee: task.assignee,
            };
        });
        return { success: true as const, tasks: normalized, hasMore };
    } catch (e) {
        console.error("Workspace tasks fetch failed:", e);
        return { success: false as const, error: "Failed to fetch workspace tasks" };
    }
}
