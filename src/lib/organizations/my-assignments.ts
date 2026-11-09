import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { copyState, effectiveAiPolicy, lateAfterMs, type AiPolicy, type AssignmentSettings, type CopyState } from "@/lib/organizations/assignment-rules";
import { readOrgWork } from "@/lib/organizations/settings";

export type MyCopy = {
  id: string; number: number | null; title: string; org: string; orgId: string; workspaceId: string;
  due: string | null; state: CopyState; late: boolean; submissionType: string; aiPolicy: AiPolicy; team: string | null;
};

/** My assignment copies, every state (`nb assignment list`, report A8.4): due first, the same states as the roster. */
export async function listMyCopies(userId: string, now = new Date()): Promise<MyCopy[]> {
  const rows = await db.execute<{ id: string; task_number: number | null; title: string; org: string; org_id: string; workspace_id: string; due_date: string | null; status: string; review_status: string; review_submitted_at: string | null; completed_at: string | null; excused_at: string | null; settings: AssignmentSettings; org_settings: unknown; org_type: string | null; team_name: string | null }>(sql`
    SELECT c.id, c.task_number, m.title, o.title AS org, o.id AS org_id, c.workspace_id, c.due_date, c.status, c.review_status, c.review_submitted_at, c.completed_at, c.excused_at,
           m.assignment_settings AS settings, o.org_settings, o.org_type, c.team_name
    FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.deleted_at IS NULL JOIN workspaces o ON o.id = m.workspace_id
    WHERE c.deleted_at IS NULL AND (m.assignment_settings->>'publishedAt') IS NOT NULL
      AND (c.assignee_id = ${userId} OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}))
    ORDER BY c.due_date NULLS LAST, m.title LIMIT 500`);
  return rows.map((r) => {
    const date = (v: string | null) => (v ? new Date(v) : null);
    const s = copyState({ status: r.status, reviewStatus: r.review_status, dueDate: date(r.due_date), submittedAt: date(r.review_submitted_at), completedAt: date(r.completed_at), excusedAt: date(r.excused_at) }, now, lateAfterMs(r.settings));
    return {
      id: r.id, number: r.task_number, title: r.title, org: r.org, orgId: r.org_id, workspaceId: r.workspace_id,
      due: date(r.due_date)?.toISOString() ?? null, state: s.state, late: s.late, submissionType: r.settings?.submissionType ?? "none",
      aiPolicy: effectiveAiPolicy(r.settings, readOrgWork(r.org_settings, r.org_type).aiPolicy), team: r.team_name,
    };
  });
}

/** An assignment copy's rules for its brief (report A8.2 item 3): AI policy, note, hand-in type. Null for other tasks. */
export async function copyRules(taskId: string) {
  const rows = await db.execute<{ settings: AssignmentSettings; org_settings: unknown; org_type: string | null; org: string }>(sql`
    SELECT m.assignment_settings AS settings, o.org_settings, o.org_type, o.title AS org
    FROM tasks c JOIN tasks m ON m.id = c.assignment_id JOIN workspaces o ON o.id = m.workspace_id
    WHERE c.id = ${taskId} LIMIT 1`);
  const r = rows[0];
  if (!r) return null;
  const aiPolicy = effectiveAiPolicy(r.settings, readOrgWork(r.org_settings, r.org_type).aiPolicy);
  return { org: r.org, aiPolicy, aiNote: r.settings?.aiNote ?? null, submissionType: r.settings?.submissionType ?? "none", reviewRequired: Boolean(r.settings?.reviewRequired) };
}
