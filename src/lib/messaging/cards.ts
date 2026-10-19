import { sql } from "drizzle-orm";

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

  const [applications, tasks, invites] = await Promise.all([
    applicationIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT a.id, a.status::text AS status, a.message, a.created_at, a.decision_at, a.project_id,
             p.title AS project_title, p.slug AS project_slug, coalesce(r.title, r.role) AS role_title,
             a.role_id, a.role_id IS NULL AS role_removed, a.details,
             a.decision_reason_code, a.decision_reason_text,
             CASE WHEN dp.id IS NULL THEN NULL ELSE ${person("dp")} END AS decided_by,
             ap.headline AS applicant_headline,
             CASE WHEN jsonb_typeof(ap.skills) = 'array' THEN (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(ap.skills) AS s LIMIT 4) top) ELSE '[]'::jsonb END AS applicant_skills,
             ${person("ap")} AS applicant,
             a.applicant_id = ${viewerId}::uuid AS is_applicant,
             (p.owner_id = ${viewerId}::uuid OR EXISTS (
               SELECT 1 FROM project_members pm
               WHERE pm.project_id = a.project_id AND pm.user_id = ${viewerId}::uuid AND pm.role IN ('owner', 'admin')
             )) AS is_reviewer
      FROM role_applications a
      JOIN projects p ON p.id = a.project_id
      JOIN profiles ap ON ap.id = a.applicant_id
      LEFT JOIN profiles dp ON dp.id = a.decision_by
      LEFT JOIN project_open_roles r ON r.id = a.role_id
      WHERE a.id = ANY(${uuidArray(applicationIds)})
    `),
    taskIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT t.id, t.title, t.status::text AS status, t.priority, t.due_date, t.task_number, t.project_id,
             p.key AS project_key, p.slug AS project_slug, p.title AS project_title,
             CASE WHEN asg.id IS NULL THEN NULL ELSE ${person("asg")} END AS assignee,
             t.deleted_at IS NOT NULL AS deleted,
             app_private.chat_is_project_member(t.project_id, ${viewerId}::uuid) AS can_view,
             -- Same rule as updateTaskStatusAction (lockTaskForWrite): the owner, or a member who isn't a viewer.
             (p.owner_id = ${viewerId}::uuid OR EXISTS (
               SELECT 1 FROM project_members pm
               WHERE pm.project_id = t.project_id AND pm.user_id = ${viewerId}::uuid AND lower(coalesce(pm.role, '')) <> 'viewer'
             )) AS can_edit
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN profiles asg ON asg.id = t.assignee_id
      WHERE t.id = ANY(${uuidArray(taskIds)})
    `),
    inviteIds.length === 0 ? [] : chatRows<Record<string, unknown>>(sql`
      SELECT i.id, i.status, i.kind AS invite_kind, i.role_title, i.guidance_label, i.project_title, i.project_id,
             p.slug AS project_slug, i.note, i.expires_at, ${person("inv")} AS inviter,
             i.candidate_id = ${viewerId}::uuid AS is_candidate,
             (i.inviter_id = ${viewerId}::uuid OR EXISTS (
               SELECT 1 FROM project_members pm
               WHERE pm.project_id = i.project_id AND pm.user_id = ${viewerId}::uuid AND pm.role IN ('owner', 'admin')
             )) AS can_cancel
      FROM project_invitations i
      JOIN projects p ON p.id = i.project_id
      JOIN profiles inv ON inv.id = i.inviter_id
      WHERE i.id = ANY(${uuidArray(inviteIds)})
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
  return cards;
}
