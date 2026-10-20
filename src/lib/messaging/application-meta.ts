import { sql, type SQL } from "drizzle-orm";

import { chatRows, uuidArray } from "@/lib/messaging/server";
import type { ChatApplicationMeta, ChatChannelSummary } from "@/lib/messaging/types";

/** A scalar subquery: the application's meta for the viewer, as JSON. `applicationId` is a SQL expression. */
export function applicationMetaSql(applicationId: SQL, viewerId: string): SQL {
  return sql`(
    SELECT jsonb_build_object(
      'status', a.status::text, 'role_title', coalesce(r.title, r.role), 'role_removed', a.role_id IS NULL,
      'project_title', p.title, 'project_slug', p.slug, 'decision_at', a.decision_at, 'created_at', a.created_at,
      'is_applicant', a.applicant_id = ${viewerId}::uuid,
      'applicant', jsonb_build_object('id', ap.id, 'username', ap.username, 'full_name', ap.full_name, 'avatar_url', ap.avatar_url),
      'lead', jsonb_build_object('id', lp.id, 'username', lp.username, 'full_name', lp.full_name, 'avatar_url', lp.avatar_url))
    FROM role_applications a
    JOIN projects p ON p.id = a.project_id
    JOIN profiles ap ON ap.id = a.applicant_id
    JOIN profiles lp ON lp.id = p.owner_id
    LEFT JOIN project_open_roles r ON r.id = a.role_id
    WHERE a.id = ${applicationId})`;
}

/** Adds `application` to every application thread in a bootstrap page: one query for all of them. */
export async function withApplicationMeta<T extends Pick<ChatChannelSummary, "application_id">>(channels: T[], viewerId: string): Promise<(T & { application?: ChatApplicationMeta | null })[]> {
  const ids = [...new Set(channels.map((channel) => channel.application_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return channels;
  const rows = await chatRows<{ id: string; application: ChatApplicationMeta | null }>(sql`
    SELECT x.id, ${applicationMetaSql(sql`x.id`, viewerId)} AS application FROM unnest(${uuidArray(ids)}) AS x(id)
  `);
  const byId = new Map(rows.map((row) => [row.id, row.application]));
  return channels.map((channel) => channel.application_id ? { ...channel, application: byId.get(channel.application_id) ?? null } : channel);
}
