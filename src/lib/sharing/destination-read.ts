import 'server-only';
import {sql} from 'drizzle-orm';

/** Canonical channel identity/read state, used only by sharing destination reads (c, m, p aliases). */
export function shareDestinationWorkspaceion(viewerId: string) {
  return sql`c.id, c.kind, c.name, CASE WHEN c.application_id IS NOT NULL THEN coalesce(nullif(c.title,''),(
      SELECT concat_ws(' · ',coalesce(ap.full_name,ap.username,'Applicant'),coalesce(nullif(a.accepted_role_title,''),nullif(r.title,''),nullif(r.role,''),'Application'))
      FROM role_applications a LEFT JOIN project_open_roles r ON r.id = a.role_id
      LEFT JOIN profiles ap ON ap.id = a.applicant_id AND ap.deleted_at IS NULL WHERE a.id = c.application_id
    ),'Application conversation') ELSE c.title END AS title, c.topic, c.project_id, c.application_id, c.is_default,
    c.last_seq, c.last_top_seq, c.last_message_at, c.last_preview, c.last_author_id, c.member_count,
    c.archived_at AS channel_archived_at, p.title AS project_title, p.slug AS project_slug,
    coalesce(m.last_read_seq, 0) AS last_read_seq, coalesce(m.mention_count, 0) AS mention_count,
    coalesce(m.notify, 'all') AS notify, coalesce(m.starred, false) AS starred, m.archived_at,
    coalesce(m.role, 'member') AS role,
    (m.user_id IS NOT NULL AND m.archived_at IS NULL AND c.archived_at IS NULL AND (c.project_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
      AND (c.project_id IS NULL OR c.application_id IS NOT NULL OR app_private.chat_is_project_member(c.project_id, ${viewerId}::uuid)) AND NOT (c.kind = 'dm' AND EXISTS (
      SELECT 1 FROM chat_channel_members other WHERE other.channel_id = c.id AND other.user_id <> ${viewerId}::uuid
        AND app_private.chat_is_blocked(${viewerId}::uuid, other.user_id)
    ))) AS can_send,
    CASE WHEN c.archived_at IS NOT NULL OR m.archived_at IS NOT NULL THEN 'archived' WHEN c.kind = 'dm' AND EXISTS (
      SELECT 1 FROM chat_channel_members other WHERE other.channel_id = c.id AND other.user_id <> ${viewerId}::uuid
        AND app_private.chat_is_blocked(${viewerId}::uuid, other.user_id)
    ) THEN 'blocked' ELSE NULL END AS send_disabled_reason,
    CASE WHEN c.kind = 'dm' THEN (
      SELECT jsonb_build_object('id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url)
      FROM chat_channel_members other JOIN profiles pr ON pr.id = other.user_id
      WHERE other.channel_id = c.id ORDER BY (other.user_id = ${viewerId}::uuid) LIMIT 1
    ) END AS dm_user,
    CASE WHEN c.kind = 'private' AND c.name IS NULL THEN (
      SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'username', gp.username, 'full_name', gp.full_name, 'avatar_url', gp.avatar_url) ORDER BY preview.joined_at, gp.id)
      FROM (SELECT other.user_id, other.joined_at FROM chat_channel_members other
        WHERE other.channel_id = c.id AND other.user_id <> ${viewerId}::uuid ORDER BY other.joined_at LIMIT 3) preview
      JOIN profiles gp ON gp.id = preview.user_id
    ) ELSE NULL::jsonb END AS members_preview`;
}

