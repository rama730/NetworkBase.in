import "server-only";

import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tasks, workspaceMembers, workspaces } from "@/lib/db/schema";

/**
 * Org rules for My work (report §29.2): assignment masters never show; excused copies are hidden; an org's
 * person copies show only to their assignee and team (admins don't see them here either). Group copies in
 * child projects show like any project task. Shared by My work and the CLI/agent task count.
 */
export function orgCopyRules(userId: string) {
  // Student check 3: like the board (orgTaskReadFilter), a member's organization work is only their own; admins
  // still see the organization's open tasks.
  return sql`${tasks.kind} <> 'assignment' AND ${tasks.excusedAt} IS NULL AND (
        EXISTS (SELECT 1 FROM workspaces cp WHERE cp.id = ${tasks.projectId} AND cp.kind <> 'organization')
        OR (${tasks.assignmentId} IS NULL AND EXISTS (SELECT 1 FROM workspaces o WHERE o.id = ${tasks.projectId}
            AND (o.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members om WHERE om.workspace_id = o.id AND om.user_id = ${userId}::uuid AND om.role = 'admin'))))
        OR ${tasks.assigneeId} = ${userId}::uuid
        OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${userId}::uuid))`;
}

/** Tasks assigned to this person, alone or with their team. */
export function mineSql(userId: string) {
  return sql`(${tasks.assigneeId} = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${userId}::uuid))`;
}

/** Workspaces the person owns or belongs to, not deleted. */
export function memberWorkspaceSql(userId: string) {
  return exists(
    db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, tasks.projectId),
          isNull(workspaces.deletedAt),
          or(
            eq(workspaces.ownerId, userId),
            exists(db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, tasks.projectId), eq(workspaceMembers.userId, userId)))),
          ),
        ),
      ),
  );
}

export type MyTaskCounts = {
  open: number;
  byStatus: { todo: number; in_progress: number; blocked: number; in_review: number };
  overdue: number;
  dueThisWeek: number;
};

/** "How many tasks do I have": the person's open work, the same set My work counts (report §18.2). */
/** `onlyWorkspaceId`: a token tied to one workspace counts only there. */
/** `onlyWorkspaces`: the workspaces a token may see (agentWorkspaceFilter); null = all of the person's. */
export async function countMyOpenTasks(userId: string, now = new Date(), onlyWorkspaces: Set<string> | null = null): Promise<MyTaskCounts> {
  const nowIso = now.toISOString();
  const weekAheadIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [row] = await db
    .select({
      open: sql<number>`count(*)::int`,
      todo: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'todo')::int`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'in_progress')::int`,
      blocked: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'blocked')::int`,
      inReview: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done' AND ${tasks.reviewStatus} = 'pending')::int`,
      overdue: sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'done' AND ${tasks.dueDate} < ${nowIso}::timestamptz)::int`,
      dueThisWeek: sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'done' AND ${tasks.dueDate} >= ${nowIso}::timestamptz AND ${tasks.dueDate} < ${weekAheadIso}::timestamptz)::int`,
    })
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
        mineSql(userId),
        orgCopyRules(userId),
        memberWorkspaceSql(userId),
        onlyWorkspaces ? (onlyWorkspaces.size ? inArray(tasks.projectId, [...onlyWorkspaces]) : sql`false`) : undefined,
      ),
    );
  return {
    open: row?.open ?? 0,
    byStatus: { todo: row?.todo ?? 0, in_progress: row?.inProgress ?? 0, blocked: row?.blocked ?? 0, in_review: row?.inReview ?? 0 },
    overdue: row?.overdue ?? 0,
    dueThisWeek: row?.dueThisWeek ?? 0,
  };
}
