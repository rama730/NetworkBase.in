import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { dismissUpdateNotifications } from "@/lib/notifications/service";
import type { ReportTargetKind } from "@/lib/trust/rules";

// What a report points at (docs/trust-and-safety-concept.md §5.1, F11): whether the reporter can see it, whose it is,
// where it lives (workspace and org, for routing), a readable label, and the evidence frozen at report time.

export type ReportTarget = {
  kind: ReportTargetKind;
  id: string;
  seq: number | null;
  subjectId: string | null;
  workspaceId: string | null;
  orgId: string | null;
  /** True for direct and group DMs: never routed to org moderators. */
  privateConversation: boolean;
  label: string;
  href: string | null;
  snapshot: Record<string, unknown>;
};

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const one = async <T>(executor: Executor, query: ReturnType<typeof sql>) => (await executor.execute(query))[0] as T | undefined;
const clip = (value: unknown, max = 4000) => (typeof value === "string" ? value.slice(0, max) : value ?? null);

/** The org a workspace belongs to: itself when it is one, else its parent organization. */
async function orgOf(executor: Executor, workspaceId: string | null) {
  if (!workspaceId) return null;
  const row = await one<{ org_id: string | null }>(executor, sql`
    SELECT CASE WHEN w.kind = 'organization' THEN w.id ELSE o.id END AS org_id
    FROM workspaces w LEFT JOIN workspaces o ON o.id = w.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
    WHERE w.id = ${workspaceId}`);
  return row?.org_id ?? null;
}

async function canReadWorkspace(workspaceId: string, viewerId: string) {
  return (await getWorkspaceAccessById(workspaceId, viewerId)).canRead;
}

const nameOf = (row: { full_name?: string | null; username?: string | null }) => row.full_name || (row.username ? `@${row.username}` : "someone");

/**
 * Resolves a reportable thing for this viewer, or null when it doesn't exist or they can't see it. The same lookup
 * serves staff (viewerId null skips the visibility check) when a case is opened by hand.
 */
export async function resolveReportTarget(kind: ReportTargetKind, id: string, seq: number | null, viewerId: string | null, executor: Executor = db): Promise<ReportTarget | null> {
  const base = { kind, id, seq: kind === "chat_message" ? seq : null, privateConversation: false };
  const withOrg = async (target: Omit<ReportTarget, "orgId" | keyof typeof base>) => ({ ...base, ...target, orgId: await orgOf(executor, target.workspaceId) });

  if (kind === "project") {
    const w = await one<{ id: string; owner_id: string; title: string; slug: string | null; kind: string; short_description: string | null; description: string | null; cover_image: string | null; external_links: unknown; tags: string[] | null }>(executor, sql`
      SELECT id, owner_id, title, slug, kind, short_description, description, cover_image, external_links, tags FROM workspaces WHERE id = ${id} AND deleted_at IS NULL`);
    if (!w || (viewerId && !(await canReadWorkspace(w.id, viewerId)))) return null;
    const org = w.kind === "organization";
    return withOrg({ subjectId: w.owner_id, workspaceId: w.id, label: `${org ? "Organization" : "Workspace"} ${w.title}`, href: `/${org ? "org" : "workspaces"}/${encodeURIComponent(w.slug ?? w.id)}`,
      snapshot: { title: w.title, tagline: w.short_description, description: clip(w.description), cover: w.cover_image, links: w.external_links, tags: w.tags, kind: w.kind } });
  }

  if (kind === "person") {
    const p = await one<{ id: string; username: string | null; full_name: string | null; headline: string | null; bio: string | null; avatar_url: string | null; location: string | null }>(executor, sql`
      SELECT id, username, full_name, headline, bio, avatar_url, location FROM profiles WHERE id = ${id} AND deleted_at IS NULL`);
    if (!p || p.id === viewerId) return null;
    return { ...base, subjectId: p.id, workspaceId: null, orgId: null, label: `Profile of ${nameOf(p)}`, href: p.username ? `/u/${encodeURIComponent(p.username)}` : null,
      snapshot: { name: p.full_name, username: p.username, headline: p.headline, bio: clip(p.bio), avatar: p.avatar_url, location: p.location } };
  }

  if (kind === "update" || kind === "update_comment") {
    const r = kind === "update"
      ? await one<{ workspace_id: string; author_id: string | null; content: unknown; title: string; slug: string | null; full_name: string | null; username: string | null; created_at: string }>(executor, sql`
          SELECT u.workspace_id, u.author_id, u.content, w.title, w.slug, p.full_name, p.username, u.created_at::text
          FROM workspace_updates u JOIN workspaces w ON w.id = u.workspace_id LEFT JOIN profiles p ON p.id = u.author_id
          WHERE u.id = ${id} AND u.deleted_at IS NULL`)
      : await one<{ workspace_id: string; author_id: string | null; content: unknown; title: string; slug: string | null; full_name: string | null; username: string | null; created_at: string; update_id: string }>(executor, sql`
          SELECT c.workspace_id, c.user_id AS author_id, c.content, w.title, w.slug, p.full_name, p.username, c.created_at::text, c.update_id
          FROM workspace_update_comments c JOIN workspaces w ON w.id = c.workspace_id LEFT JOIN profiles p ON p.id = c.user_id
          WHERE c.id = ${id} AND c.deleted_at IS NULL`);
    if (!r || (viewerId && !(await canReadWorkspace(r.workspace_id, viewerId)))) return null;
    return withOrg({ subjectId: r.author_id, workspaceId: r.workspace_id, label: `${kind === "update" ? "Post" : "Comment"} by ${nameOf(r)} in ${r.title}`,
      href: `/workspaces/${encodeURIComponent(r.slug ?? r.workspace_id)}?tab=updates`, snapshot: { content: clip(typeof r.content === "string" ? r.content : JSON.stringify(r.content)), author: nameOf(r), createdAt: r.created_at } });
  }

  if (kind === "doc") {
    const d = await one<{ workspace_id: string; filename: string; slug: string; owner_id: string; title: string; wslug: string | null }>(executor, sql`
      SELECT d.workspace_id, d.filename, d.slug, w.owner_id, w.title, w.slug AS wslug FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id WHERE d.id = ${id}`);
    if (!d || (viewerId && !(await canReadWorkspace(d.workspace_id, viewerId)))) return null;
    return withOrg({ subjectId: d.owner_id, workspaceId: d.workspace_id, label: `Doc ${d.filename} in ${d.title}`, href: `/workspaces/${encodeURIComponent(d.wslug ?? d.workspace_id)}?tab=docs&doc=${encodeURIComponent(d.slug)}`,
      snapshot: { filename: d.filename } });
  }

  if (kind === "task" || kind === "task_comment") {
    const t = kind === "task"
      ? await one<{ workspace_id: string; author_id: string | null; title: string; description: string | null; wtitle: string; wslug: string | null; task_id: string; full_name: string | null; username: string | null }>(executor, sql`
          SELECT t.workspace_id, t.creator_id AS author_id, t.title, t.description, w.title AS wtitle, w.slug AS wslug, t.id AS task_id, p.full_name, p.username
          FROM tasks t JOIN workspaces w ON w.id = t.workspace_id LEFT JOIN profiles p ON p.id = t.creator_id WHERE t.id = ${id} AND t.deleted_at IS NULL`)
      : await one<{ workspace_id: string; author_id: string | null; title: string; description: string | null; wtitle: string; wslug: string | null; task_id: string; full_name: string | null; username: string | null }>(executor, sql`
          SELECT t.workspace_id, c.user_id AS author_id, t.title, c.content AS description, w.title AS wtitle, w.slug AS wslug, t.id AS task_id, p.full_name, p.username
          FROM task_comments c JOIN tasks t ON t.id = c.task_id JOIN workspaces w ON w.id = t.workspace_id LEFT JOIN profiles p ON p.id = c.user_id
          WHERE c.id = ${id} AND c.deleted_at IS NULL AND t.deleted_at IS NULL`);
    if (!t || (viewerId && !(await canReadWorkspace(t.workspace_id, viewerId)))) return null;
    return withOrg({ subjectId: t.author_id, workspaceId: t.workspace_id, label: `${kind === "task" ? "Task" : "Task comment"} by ${nameOf(t)} in ${t.wtitle}`,
      href: `/workspaces/${encodeURIComponent(t.wslug ?? t.workspace_id)}?tab=tasks&task=${t.task_id}`,
      snapshot: kind === "task" ? { title: t.title, description: clip(t.description) } : { task: t.title, content: clip(t.description) } });
  }

  if (kind === "file") {
    const f = await one<{ workspace_id: string; created_by: string | null; name: string; size: number | null; mime_type: string | null; title: string; slug: string | null }>(executor, sql`
      SELECT n.workspace_id, n.created_by, n.name, n.size, n.mime_type, w.title, w.slug FROM workspace_nodes n JOIN workspaces w ON w.id = n.workspace_id
      WHERE n.id = ${id} AND n.type = 'file' AND n.deleted_at IS NULL`);
    if (!f || (viewerId && !(await canReadWorkspace(f.workspace_id, viewerId)))) return null;
    return withOrg({ subjectId: f.created_by, workspaceId: f.workspace_id, label: `File ${f.name} in ${f.title}`, href: `/workspaces/${encodeURIComponent(f.slug ?? f.workspace_id)}?tab=files&file=${id}`,
      snapshot: { name: f.name, size: f.size, type: f.mime_type } });
  }

  if (kind === "chat_message") {
    if (seq == null) return null;
    const m = await one<{ author_id: string | null; body: string | null; kind: string; ckind: string; cname: string | null; workspace_id: string | null; full_name: string | null; username: string | null; created_at: string }>(executor, sql`
      SELECT m.author_id, m.body, m.kind, c.kind AS ckind, coalesce(c.name, c.title) AS cname, c.workspace_id, p.full_name, p.username, m.created_at::text
      FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id LEFT JOIN profiles p ON p.id = m.author_id
      WHERE m.channel_id = ${id} AND m.channel_seq = ${seq} AND m.deleted_at IS NULL`);
    if (!m || m.kind !== "user") return null;
    if (viewerId && !(await one<{ ok: boolean }>(executor, sql`SELECT app_private.chat_is_member(${id}::uuid, ${viewerId}::uuid) AS ok`))?.ok) return null;
    // The reported message and the 5 before it, from this conversation only (T4).
    const context = await executor.execute<{ seq: number; author: string | null; body: string | null; at: string }>(sql`
      SELECT m.channel_seq::int AS seq, coalesce(p.full_name, p.username) AS author, left(m.body, 2000) AS body, m.created_at::text AS at
      FROM chat_messages m LEFT JOIN profiles p ON p.id = m.author_id
      WHERE m.channel_id = ${id} AND m.channel_seq <= ${seq} AND m.thread_root_seq IS NOT DISTINCT FROM (SELECT thread_root_seq FROM chat_messages WHERE channel_id = ${id} AND channel_seq = ${seq})
        AND m.deleted_at IS NULL AND m.kind = 'user'
      ORDER BY m.channel_seq DESC LIMIT 6`);
    const dm = m.ckind === "dm";
    return withOrg({ subjectId: m.author_id, workspaceId: dm ? null : m.workspace_id, label: `Message from ${nameOf(m)} ${dm ? "in a direct message" : `in #${m.cname ?? "channel"}`}`,
      href: `/messages?channel=${id}&seq=${seq}`, snapshot: { message: clip(m.body, 4000), author: nameOf(m), createdAt: m.created_at, context: [...context].reverse() } }).then((t) => ({ ...t, privateConversation: dm }));
  }

  if (kind === "chat_channel") {
    const c = await one<{ created_by: string | null; name: string | null; title: string | null; topic: string | null; description: string | null; workspace_id: string | null; kind: string }>(executor, sql`
      SELECT created_by, name, title, topic, description, workspace_id, kind FROM chat_channels WHERE id = ${id} AND archived_at IS NULL`);
    if (!c) return null;
    if (viewerId && !(await one<{ ok: boolean }>(executor, sql`SELECT app_private.chat_is_member(${id}::uuid, ${viewerId}::uuid) AS ok`))?.ok) return null;
    return withOrg({ subjectId: c.created_by, workspaceId: c.workspace_id, label: `Channel #${c.name ?? c.title ?? "channel"}`, href: `/messages?channel=${id}`,
      snapshot: { name: c.name ?? c.title, topic: c.topic, description: clip(c.description) } });
  }

  if (kind === "role") {
    const r = await one<{ workspace_id: string; owner_id: string; role: string; title: string | null; description: string | null; wtitle: string; slug: string | null }>(executor, sql`
      SELECT r.workspace_id, w.owner_id, r.role, r.title, r.description, w.title AS wtitle, w.slug FROM workspace_open_roles r JOIN workspaces w ON w.id = r.workspace_id
      WHERE r.id = ${id} AND w.deleted_at IS NULL`);
    if (!r || (viewerId && !(await canReadWorkspace(r.workspace_id, viewerId)))) return null;
    return withOrg({ subjectId: r.owner_id, workspaceId: r.workspace_id, label: `Role ${r.title ?? r.role} in ${r.wtitle}`, href: `/workspaces/${encodeURIComponent(r.slug ?? r.workspace_id)}`,
      snapshot: { title: r.title ?? r.role, description: clip(r.description) } });
  }

  if (kind === "application") {
    // Only the people who receive an application can report its note.
    const a = await one<{ workspace_id: string; applicant_id: string; message: string | null; details: unknown; full_name: string | null; username: string | null; title: string }>(executor, sql`
      SELECT a.workspace_id, a.applicant_id, a.message, a.details, p.full_name, p.username, w.title FROM role_applications a
      JOIN workspaces w ON w.id = a.workspace_id LEFT JOIN profiles p ON p.id = a.applicant_id WHERE a.id = ${id}`);
    if (!a) return null;
    if (viewerId) {
      const access = await getWorkspaceAccessById(a.workspace_id, viewerId);
      if (!(access.isOwner || access.memberRole === "admin" || access.isInheritedAdmin)) return null;
    }
    return withOrg({ subjectId: a.applicant_id, workspaceId: a.workspace_id, label: `Application from ${nameOf(a)} to ${a.title}`, href: null,
      snapshot: { message: clip(a.message), details: a.details } });
  }

  if (kind === "invitation") {
    const i = await one<{ workspace_id: string; inviter_id: string; candidate_id: string; note: string | null; full_name: string | null; username: string | null; title: string }>(executor, sql`
      SELECT i.workspace_id, i.inviter_id, i.candidate_id, i.note, p.full_name, p.username, w.title FROM workspace_invitations i
      JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN profiles p ON p.id = i.inviter_id WHERE i.id = ${id}`);
    if (!i || (viewerId && i.candidate_id !== viewerId)) return null;
    return withOrg({ subjectId: i.inviter_id, workspaceId: i.workspace_id, label: `Invitation from ${nameOf(i)} to ${i.title}`, href: "/network?tab=invitations",
      snapshot: { note: clip(i.note), workspace: i.title } }).then((t) => ({ ...t, orgId: null }));
  }

  if (kind === "connection_request") {
    const c = await one<{ requester_id: string; addressee_id: string; message: string | null; full_name: string | null; username: string | null }>(executor, sql`
      SELECT c.requester_id, c.addressee_id, c.message, p.full_name, p.username FROM connections c LEFT JOIN profiles p ON p.id = c.requester_id WHERE c.id = ${id}`);
    if (!c || (viewerId && c.addressee_id !== viewerId)) return null;
    return { ...base, subjectId: c.requester_id, workspaceId: null, orgId: null, label: `Connection request from ${nameOf(c)}`, href: "/network?tab=invitations", snapshot: { message: clip(c.message) } };
  }

  if (kind === "contribution") {
    const c = await one<{ profile_id: string; role_title: string | null; summary: string | null; presentation: unknown; project_title: string | null; username: string | null; full_name: string | null }>(executor, sql`
      SELECT c.profile_id, c.role_title, c.summary, c.presentation, c.project_title, p.username, p.full_name FROM profile_contributions c
      JOIN profiles p ON p.id = c.profile_id WHERE c.id = ${id} AND c.deleted_at IS NULL`);
    if (!c || c.profile_id === viewerId) return null;
    return { ...base, subjectId: c.profile_id, workspaceId: null, orgId: null, label: `Contribution story by ${nameOf(c)}`, href: c.username ? `/u/${encodeURIComponent(c.username)}` : null,
      snapshot: { title: c.project_title, role: c.role_title, summary: clip(c.summary), story: c.presentation } };
  }

  return null;
}

/** Content that moderation can hide: the table and soft-delete column behind each kind. */
const SOFT_DELETE: Partial<Record<ReportTargetKind, { table: string; key: "id" | "channel" }>> = {
  update: { table: "workspace_updates", key: "id" },
  update_comment: { table: "workspace_update_comments", key: "id" },
  task: { table: "tasks", key: "id" },
  task_comment: { table: "task_comments", key: "id" },
  file: { table: "workspace_nodes", key: "id" },
  chat_message: { table: "chat_messages", key: "channel" },
  contribution: { table: "profile_contributions", key: "id" },
};
export const canSoftHide = (kind: ReportTargetKind) => Boolean(SOFT_DELETE[kind]);

/**
 * Hides (or brings back) a piece of content for everyone through its own soft-delete column, so every existing
 * reader drops it with no new filter. Returns false when the kind has no soft delete.
 */
export async function setContentHidden(kind: ReportTargetKind, id: string, seq: number | null, hidden: boolean, executor: Executor = db) {
  const target = SOFT_DELETE[kind];
  if (!target) return false;
  const table = sql.raw(target.table);
  const where = target.key === "channel" ? sql`channel_id = ${id} AND channel_seq = ${seq}` : sql`id = ${id}`;
  await executor.execute(hidden
    ? sql`UPDATE ${table} SET deleted_at = coalesce(deleted_at, now()) WHERE ${where}`
    : sql`UPDATE ${table} SET deleted_at = NULL WHERE ${where}`);
  // Notifications about it quote its text, so they go too. Restoring the content doesn't bring them back.
  if (hidden && kind === "update") await dismissUpdateNotifications("updateId", id, executor);
  if (hidden && kind === "update_comment") await dismissUpdateNotifications("commentId", id, executor);
  return true;
}
