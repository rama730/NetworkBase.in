import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces, taskSubtasks, tasks } from "@/lib/db/schema";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// COR-023: authority and the live task are read in the write transaction. FOR SHARE on the project
// and membership rows waits out a concurrent owner transfer or removal instead of racing it.
export async function lockSubtaskWriteScope(
  tx: Tx,
  target: { taskId: string } | { subtaskId: string },
  projectId: string,
  userId: string,
): Promise<string> {
  const match =
    "taskId" in target
      ? sql`t.id = ${target.taskId}`
      : sql`t.id = (SELECT s.task_id FROM ${taskSubtasks} s WHERE s.id = ${target.subtaskId})`;
  const rows = await tx.execute<{
    id: string;
    project_id: string;
    owner_id: string;
    role: string | null;
    org: boolean;
    mine: boolean;
  }>(sql`
        SELECT t.id, t.workspace_id AS project_id, p.owner_id, m.role, p.kind = 'organization' AS org,
               (t.assignee_id = ${userId} OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = ${userId})) AS mine
        FROM ${tasks} t
        JOIN ${workspaces} p ON p.id = t.workspace_id AND p.deleted_at IS NULL
        LEFT JOIN ${workspaceMembers} m ON m.workspace_id = p.id AND m.user_id = ${userId}
        WHERE ${match} AND t.deleted_at IS NULL
        LIMIT 1
        FOR SHARE OF t, p
    `);
  const row = Array.from(rows)[0];
  if (!row || row.project_id !== projectId) {
    throw new Error(
      "taskId" in target ? "Task not found" : "Subtask not found",
    );
  }
  const role = row.owner_id === userId ? "owner" : row.role;
  if (!role || (role !== "owner" && role !== "admin" && role !== "member")) {
    throw new Error(
      "You do not have permission to perform this workspace action",
    );
  }
  // Report §42.12 problem 28: in an organization, members change steps only on their own (or their team's) copy;
  // the main assignment and everything else on its board belong to owners and admins.
  if (row.org && role === "member" && !row.mine) {
    throw new Error("Only your own work's steps can be changed here.");
  }
  return row.id;
}
