import { sql } from "drizzle-orm";
import { copyState } from "@/lib/organizations/assignment-rules";

import { chatRows, uuidArray } from "@/lib/messaging/server";
import type { ChatCardRef, ChatCardView } from "@/lib/messaging/types";

const person = (prefix: string) => sql.raw(
  `jsonb_build_object('id', ${prefix}.id, 'username', ${prefix}.username, 'full_name', ${prefix}.full_name, 'avatar_url', ${prefix}.avatar_url)`,
);

/**
 * Hydrate live cards for one page: one query per card kind, each with the
 * viewer's access check. Cards the viewer may not see come back restricted.
 */
export async function hydrateCards(viewerId: string, refs: ChatCardRef[]): Promise<Record<string, ChatCardView>> {
  const ids = (kind: ChatCardRef["kind"]) => [...new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.ref_id))];
  const applicationIds = ids("application");
  const taskIds = ids("task");
  const inviteIds = ids("invite");
  const announcementIds = ids("announcement");
  const assignmentIds = ids("assignment");

  const [applications, tasks, invites] = await Promise.all([
    applicationIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT a.id, a.status::text AS status, a.message, a.created_at, a.decision_at, a.workspace_id AS project_id,
             p.title AS project_title, p.slug AS project_slug, coalesce(r.title, r.role) AS role_title,
             a.role_id, a.role_id IS NULL AS role_removed, a.details,
             a.decision_reason_code, a.decision_reason_text,
             CASE WHEN dp.id IS NULL THEN NULL ELSE ${person("dp")} END AS decided_by,
             (SELECT c.id FROM chat_channels c WHERE c.workspace_id = a.workspace_id AND c.is_default AND app_private.chat_is_member(c.id, ${viewerId}::uuid)) AS project_chat_id,
             ap.headline AS applicant_headline,
             CASE WHEN jsonb_typeof(ap.skills) = 'array' THEN (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(ap.skills) AS s LIMIT 4) top) ELSE '[]'::jsonb END AS applicant_skills,
             ${person("ap")} AS applicant,
             a.applicant_id = ${viewerId}::uuid AS is_applicant,
             (p.owner_id = ${viewerId}::uuid OR EXISTS (
               SELECT 1 FROM workspace_members pm
               WHERE pm.workspace_id = a.workspace_id AND pm.user_id = ${viewerId}::uuid AND pm.role IN ('owner', 'admin')
             )) AS is_reviewer
      FROM role_applications a
      JOIN workspaces p ON p.id = a.workspace_id
      JOIN profiles ap ON ap.id = a.applicant_id
      LEFT JOIN profiles dp ON dp.id = a.decision_by
      LEFT JOIN workspace_open_roles r ON r.id = a.role_id
      WHERE a.id = ANY(${uuidArray(applicationIds)})
    `),
    taskIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT t.id, t.title, t.status::text AS status, t.priority, t.due_date, t.task_number, t.workspace_id AS project_id,
             p.key AS project_key, p.slug AS project_slug, p.title AS project_title,
             CASE WHEN asg.id IS NULL THEN NULL ELSE ${person("asg")} END AS assignee,
             t.deleted_at IS NOT NULL AS deleted,
             -- In an organization, only the tasks the board would show them (0042): never a draft or another person's copy.
             (app_private.chat_is_workspace_member(t.workspace_id, ${viewerId}::uuid) AND app_private.nb_org_task_visible_to(t.id, ${viewerId}::uuid)) AS can_view,
             -- Same rule as updateTaskStatusAction (lockTaskForWrite): the owner, or a member who isn't a viewer.
             (p.owner_id = ${viewerId}::uuid OR EXISTS (
               SELECT 1 FROM workspace_members pm
               WHERE pm.workspace_id = t.workspace_id AND pm.user_id = ${viewerId}::uuid AND lower(coalesce(pm.role, '')) <> 'viewer'
             )) AS can_edit
      FROM tasks t
      JOIN workspaces p ON p.id = t.workspace_id
      LEFT JOIN profiles asg ON asg.id = t.assignee_id
      WHERE t.id = ANY(${uuidArray(taskIds)})
    `),
    inviteIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT i.id, i.status, i.kind AS invite_kind, i.role_title, i.guidance_label, i.project_title, i.workspace_id AS project_id,
             p.slug AS project_slug, i.note, i.expires_at, ${person("inv")} AS inviter,
             i.candidate_id = ${viewerId}::uuid AS is_candidate,
             (i.inviter_id = ${viewerId}::uuid OR EXISTS (
               SELECT 1 FROM workspace_members pm
               WHERE pm.workspace_id = i.workspace_id AND pm.user_id = ${viewerId}::uuid AND pm.role IN ('owner', 'admin')
             )) AS can_cancel
      FROM workspace_invitations i
      JOIN workspaces p ON p.id = i.workspace_id
      JOIN profiles inv ON inv.id = i.inviter_id
      WHERE i.id = ANY(${uuidArray(inviteIds)})
    `),
  ]);

  // Org cards (report §25.5): an announcement for the people its audience allows; an assignment with the
  // viewer's own copy status, or counts for owners and admins.
  const [announcements, assignments] = await Promise.all([
    announcementIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT u.id, left(u.content, 400) AS content, u.workspace_id AS project_id, p.slug AS project_slug, p.title AS project_title,
             u.created_at, u.deleted_at IS NOT NULL AS deleted,
             (p.owner_id = ${viewerId}::uuid OR EXISTS (
               SELECT 1 FROM workspace_members m WHERE m.workspace_id = u.workspace_id AND m.user_id = ${viewerId}::uuid
                 AND (u.audience = '{}'::jsonb OR m.role = 'admin' OR u.author_id = ${viewerId}::uuid OR u.audience->'roles' @> to_jsonb(m.role::text)
                   OR EXISTS (SELECT 1 FROM workspace_members cm JOIN workspaces cp ON cp.id = cm.workspace_id AND cp.deleted_at IS NULL AND cp.parent_id = u.workspace_id
                     WHERE cm.user_id = ${viewerId}::uuid
                     AND cm.workspace_id::text IN (SELECT jsonb_array_elements_text(coalesce(u.audience->'projectIds', '[]'::jsonb)))))
             )) AS can_view
      FROM workspace_updates u JOIN workspaces p ON p.id = u.workspace_id
      WHERE u.id = ANY(${uuidArray(announcementIds)})
    `),
    assignmentIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT t.id, t.title, t.due_date, t.workspace_id AS project_id, p.slug AS project_slug, p.title AS project_title, t.deleted_at IS NOT NULL AS deleted,
             (p.owner_id = ${viewerId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = p.id AND m.user_id = ${viewerId}::uuid AND m.role = 'admin')) AS is_admin,
             (EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = p.id AND m.user_id = ${viewerId}::uuid) OR p.owner_id = ${viewerId}::uuid)
               AND app_private.nb_org_task_visible_to(t.id, ${viewerId}::uuid) AS can_view,
             (SELECT jsonb_build_object('copy_id', c.id, 'status', c.status, 'review_status', c.review_status, 'due_date', c.due_date,
                     'submitted_at', c.review_submitted_at, 'completed_at', c.completed_at, 'excused_at', c.excused_at)
              FROM tasks c WHERE c.assignment_id = t.id AND c.deleted_at IS NULL AND (c.assignee_id = ${viewerId}::uuid
                OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${viewerId}::uuid)) LIMIT 1) AS own,
             (SELECT jsonb_build_object('total', count(*) FILTER (WHERE c.excused_at IS NULL), 'done', count(*) FILTER (WHERE c.status = 'done'),
                     'submitted', count(*) FILTER (WHERE c.review_status = 'pending' OR c.status = 'done'))
              FROM tasks c WHERE c.assignment_id = t.id AND c.deleted_at IS NULL) AS counts
      FROM tasks t JOIN workspaces p ON p.id = t.workspace_id
      WHERE t.id = ANY(${uuidArray(assignmentIds)}) AND t.assignment_id IS NULL
    `),
  ]);

  const cards: Record<string, ChatCardView> = {};
  for (const ref of refs) cards[`${ref.kind}:${ref.ref_id}`] = { kind: ref.kind, id: ref.ref_id, restricted: true };
  for (const row of applications) {
    if (row.is_applicant || row.is_reviewer) cards[`application:${row.id}`] = { kind: "application", ...row } as ChatCardView;
  }
  for (const row of tasks) {
    if (row.can_view) {
      const { can_view: _canView, ...task } = row;
      cards[`task:${row.id}`] = { kind: "task", ...task } as ChatCardView;
    }
  }
  for (const row of invites) {
    if (row.is_candidate || row.can_cancel) cards[`invite:${row.id}`] = { kind: "invite", ...row } as ChatCardView;
  }
  for (const row of announcements) {
    if (row.can_view) {
      const { can_view: _canView, ...announcement } = row;
      cards[`announcement:${row.id}`] = { kind: "announcement", ...announcement } as ChatCardView;
    }
  }
  for (const row of assignments) {
    if (!row.can_view) continue;
    const { can_view: _canView, is_admin: isAdmin, own, counts, ...assignment } = row;
    const copy = own as Record<string, string | null> | null;
    const state = copy ? copyState({
      status: String(copy.status), reviewStatus: String(copy.review_status), dueDate: copy.due_date ? new Date(copy.due_date) : null,
      submittedAt: copy.submitted_at ? new Date(copy.submitted_at) : null, completedAt: copy.completed_at ? new Date(copy.completed_at) : null,
      excusedAt: copy.excused_at ? new Date(copy.excused_at) : null,
    }) : null;
    cards[`assignment:${row.id}`] = {
      kind: "assignment", ...assignment,
      own: copy && state ? { copy_id: String(copy.copy_id), state: state.state, late: state.late } : null,
      counts: isAdmin ? counts : null,
    } as ChatCardView;
  }
  return cards;
}
