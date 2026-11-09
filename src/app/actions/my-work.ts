"use server";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { workspaces, tasks, workspaceMembers } from "@/lib/db/schema";
import { countPendingInvitationsForCandidate } from "@/lib/workspaces/workspace-invitations";
import { eq, and, isNull, sql, exists, ne, or, count } from "drizzle-orm";
import { countReviewableApplications } from "@/lib/applications/reviewers";
import { normalizeTaskSurfaceRecord } from "@/lib/workspaces/task-presentation";
import { copyState } from "@/lib/organizations/assignment-rules";
import { readOrgPendingCountAction } from "@/app/actions/org-workspace";
import { mineSql, orgCopyRules } from "@/lib/domain/my-tasks";

function normalizeMyWorkLimit(rawLimit: unknown, fallback = 24) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit);
    return Number.isFinite(parsed)
        ? Math.max(1, Math.min(Math.trunc(parsed), 100))
        : fallback;
}

/** Small drawer badges deliberately use scalar counts rather than task lists. */
export async function getMyWorkSummaryAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false as const, error: "Sign in to continue" };

        const [taskResult, applicationResult, inviteResult] = await Promise.all([
            db.select({ value: count() }).from(tasks).where(and(
                isNull(tasks.deletedAt),
                sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
                // Your open work, including assignment copies you or your team hold (report §29.2).
                mineSql(user.id),
                orgCopyRules(user.id),
                exists(db.select({ id: workspaces.id }).from(workspaces).where(and(
                    eq(workspaces.id, tasks.projectId),
                    isNull(workspaces.deletedAt),
                    or(
                        eq(workspaces.ownerId, user.id),
                        exists(db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(
                            eq(workspaceMembers.projectId, tasks.projectId),
                            eq(workspaceMembers.userId, user.id),
                        ))),
                    ),
                ))),
            )),
            countReviewableApplications(user.id).then((value) => [{ value }]),
            countPendingInvitationsForCandidate(user.id).then((value) => [{ value }]),
        ]);
        // Invitations badge: org invitations, plus join requests for orgs you run (report §29.2).
        const orgPending = await readOrgPendingCountAction().catch(() => 0);

        return {
            success: true as const,
            taskCount: taskResult[0]?.value ?? 0,
            requestCount: (applicationResult[0]?.value ?? 0) + (inviteResult[0]?.value ?? 0) + orgPending,
        };
    } catch (error) {
        console.error("Workspace summary fetch failed:", error);
        return { success: false as const, error: "Couldn’t fetch workspace summary" };
    }
}

/**
 * Fetch active tasks from projects the authenticated user can access.
 *
 * The workspace is an overview, not a personal-assignment inbox: the default
 * includes the team's open work so a collaborator can still see a project's
 * workload when nothing is assigned to them personally.
 */
export async function fetchMyWorkTasksAction(
    limit: number = 24,
    scope: "my" | "team" | "all" = "all"
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue" };
        }

        const safeLimit = normalizeMyWorkLimit(limit);

        const baseWhere = and(
            isNull(tasks.deletedAt),
            sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
            orgCopyRules(user.id),
        );

        const visibleProjectCheck = exists(
            db.select({ id: workspaces.id })
                .from(workspaces)
                .where(and(
                    eq(workspaces.id, tasks.projectId),
                    isNull(workspaces.deletedAt),
                    or(
                        eq(workspaces.ownerId, user.id),
                        exists(
                            db.select({ id: workspaceMembers.id })
                                .from(workspaceMembers)
                                .where(and(
                                    eq(workspaceMembers.projectId, tasks.projectId),
                                    eq(workspaceMembers.userId, user.id),
                                )),
                        ),
                    ),
                )),
        );

        let scopeWhere;
        if (scope === "my") {
            scopeWhere = and(visibleProjectCheck, mineSql(user.id));
        } else {
            if (scope === "team") {
                scopeWhere = and(
                    visibleProjectCheck,
                    or(isNull(tasks.assigneeId), ne(tasks.assigneeId, user.id)),
                    sql`NOT ${mineSql(user.id)}`,
                );
            } else {
                scopeWhere = visibleProjectCheck;
            }
        }

        const taskPage = await db.query.tasks.findMany({
            where: and(baseWhere, scopeWhere),
            orderBy: (t, { asc, desc }) => [
                // My tasks: soonest due first (report §29.2).
                ...(scope === "my" ? [sql`${t.dueDate} ASC NULLS LAST`] : []),
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
                    JOIN workspace_nodes pn ON pn.id = tnl.node_id
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

        // Org context per row: "CSE-3A", "CSE-3A / Compiler Lab" or the personal project; "From Ms. Rao",
        // Late / Missing and the team for assignment copies (report §29.2).
        const orgInfo = taskIds.length ? (await db.execute(sql`
            SELECT t.id::text AS task_id, p.kind, p.title AS project_title, coalesce(o.id, CASE WHEN p.kind = 'organization' THEN p.id END)::text AS org_id,
              o.title AS org_title, t.team_name, t.review_submitted_at, t.completed_at, t.excused_at,
              (SELECT coalesce(pr.full_name, pr.username) FROM tasks m JOIN profiles pr ON pr.id = m.creator_id WHERE m.id = t.assignment_id) AS from_name
            FROM tasks t JOIN workspaces p ON p.id = t.workspace_id LEFT JOIN workspaces o ON o.id = p.parent_id AND o.kind = 'organization'
            WHERE t.id = ANY(${sql`ARRAY[${sql.join(taskIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`})`)) as unknown as Array<{
            task_id: string; kind: string; project_title: string; org_id: string | null; org_title: string | null; team_name: string | null;
            review_submitted_at: string | null; completed_at: string | null; excused_at: string | null; from_name: string | null;
        }> : [];
        const orgById = new Map(orgInfo.map((row) => [row.task_id, row]));
        const now = new Date();

        const normalized = page.map((task) => {
            const info = orgById.get(task.id);
            const copy = task.assignmentId ? copyState({ status: task.status, reviewStatus: task.reviewStatus, dueDate: task.dueDate, submittedAt: info?.review_submitted_at ? new Date(info.review_submitted_at) : null, completedAt: info?.completed_at ? new Date(info.completed_at) : null, excusedAt: info?.excused_at ? new Date(info.excused_at) : null }, now) : null;
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
                org: info ? {
                    id: info.org_id,
                    context: info.kind === "organization" ? info.project_title : info.org_title ? `${info.org_title} / ${info.project_title}` : info.project_title,
                    fromName: task.assignmentId ? info.from_name : null,
                    teamName: info.team_name,
                    copyState: copy?.state ?? null,
                    late: copy?.late ?? false,
                } : null,
            };
        });
        return { success: true as const, tasks: normalized, hasMore };
    } catch (e) {
        console.error("Workspace tasks fetch failed:", e);
        return { success: false as const, error: "Couldn’t fetch workspace tasks" };
    }
}
