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

/**
 * Report 38.7 part 8 (A2.6): a request needs this person when it waits on them, or when they asked and it's
 * Delivered with Did this solve it? unanswered. My work lists these beside their own tasks.
 */
export function requestNeedsYouSql(userId: string) {
  return sql`(${tasks.itemType} = 'request' AND (${tasks.typeFields}->'waiting'->>'onUserId' = ${userId}
    OR (${tasks.stage} = 'delivered' AND ${tasks.creatorId} = ${userId}::uuid AND ${tasks.typeFields}->>'solved' IS NULL)))`;
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
  /** Which workspaces the counts cover (report D24), most open first. */
  workspaces: Array<{ id: string; title: string; open: number; overdue: number; dueThisWeek: number }>;
};

/** "How many tasks do I have": the person's open work, the same set My work counts (report §18.2). */
/** `onlyWorkspaceId`: a token tied to one workspace counts only there. */
/** `onlyWorkspaces`: the workspaces a token may see (agentWorkspaceFilter); null = all of the person's. */
export async function countMyOpenTasks(userId: string, now = new Date(), onlyWorkspaces: Set<string> | null = null): Promise<MyTaskCounts> {
  const nowIso = now.toISOString();
  const weekAheadIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const where = and(
    isNull(tasks.deletedAt),
    sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
    mineSql(userId),
    orgCopyRules(userId),
    memberWorkspaceSql(userId),
    onlyWorkspaces ? (onlyWorkspaces.size ? inArray(tasks.projectId, [...onlyWorkspaces]) : sql`false`) : undefined,
  );
  const overdue = sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'done' AND ${tasks.dueDate} < ${nowIso}::timestamptz)::int`;
  const dueThisWeek = sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'done' AND ${tasks.dueDate} >= ${nowIso}::timestamptz AND ${tasks.dueDate} < ${weekAheadIso}::timestamptz)::int`;
  const rows = await db
    .select({
      id: workspaces.id,
      title: workspaces.title,
      open: sql<number>`count(*)::int`,
      todo: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'todo')::int`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'in_progress')::int`,
      blocked: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'blocked')::int`,
      inReview: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done' AND ${tasks.reviewStatus} = 'pending')::int`,
      overdue,
      dueThisWeek,
    })
    .from(tasks)
    .innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
    .where(where)
    .groupBy(workspaces.id, workspaces.title);
  const sum = (key: "open" | "todo" | "inProgress" | "blocked" | "inReview" | "overdue" | "dueThisWeek") => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
  return {
    open: sum("open"),
    byStatus: { todo: sum("todo"), in_progress: sum("inProgress"), blocked: sum("blocked"), in_review: sum("inReview") },
    overdue: sum("overdue"),
    dueThisWeek: sum("dueThisWeek"),
    workspaces: rows
      .map((r) => ({ id: r.id, title: r.title, open: r.open, overdue: r.overdue, dueThisWeek: r.dueThisWeek }))
      .sort((x, y) => y.open - x.open || x.title.localeCompare(y.title)),
  };
}
