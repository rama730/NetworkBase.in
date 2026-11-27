import "server-only";

import { and, asc, eq, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { scopeWords } from "@/lib/agents/access";
import { canReviewWorkspaceSql } from "@/lib/applications/reviewers";
import { userNotifications } from "@/lib/db/schema";
import { toNotificationItem } from "@/lib/notifications/service";
import type { NotificationItem } from "@/lib/notifications/types";

/**
 * Needs you (notifications mix): the things waiting on this person, read from the things themselves so each one
 * stays until it is answered (not until it is seen). Reviews, connection requests, applications, agent questions and
 * access requests; plus unread important notices, which stay until read.
 */
export type NeedsYouSource = "review" | "connection" | "application" | "agent_question" | "agent_access" | "important";
export type NotificationAct = { act: "accept" | "ignore" | "allow" | "deny" | "answer" | "open"; label: string; value?: string };
export type NeedsYouItem = {
  key: string;
  source: NeedsYouSource;
  notificationId: string | null;
  actor: { id: string | null; name: string | null; avatarUrl: string | null } | null;
  sentence: { actor: string; verb: string; object: string };
  snippet: string | null;
  context: string | null;
  href: string;
  waitingSince: string;
  blocksOthers: number;
  primary: NotificationAct | null;
  secondary: NotificationAct | null;
  options?: Array<{ value: string; label: string; recommended?: boolean }>;
  questionKey?: string;
  /** Important notices carry their row; the tray renders it through the sentence builder. */
  notification?: NotificationItem;
};

/** Kinds whose rows are represented by a Needs you item from its own table (never shown twice). */
export const NEEDS_YOU_REQUEST_KINDS = ["connection_request_received", "application_received", "agent_question", "agent_access_request", "merge_request"] as const;

const reviewsSql = (me: string): SQL => sql`
  SELECT m.id, m.number, m.title, w.id AS workspace_id, w.slug, w.title AS workspace, b.name AS branch,
         p.id AS actor_id, COALESCE(p.full_name, p.username) AS actor_name, p.avatar_url, r.created_at
  FROM merge_request_reviews r
  JOIN merge_requests m ON m.id = r.merge_request_id AND m.state = 'open'
  JOIN workspaces w ON w.id = m.workspace_id AND w.deletion_scheduled_at IS NULL
  JOIN branches b ON b.id = m.source_branch_id
  LEFT JOIN profiles p ON p.id = m.author_id
  WHERE r.reviewer_id = ${me}::uuid AND r.state = 'requested'
    AND (w.owner_id = ${me}::uuid OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = m.workspace_id AND wm.user_id = ${me}::uuid))`;

const connectionsSql = (me: string): SQL => sql`
  SELECT c.id, c.created_at, p.id AS actor_id, COALESCE(p.full_name, p.username) AS actor_name, p.avatar_url, p.headline
  FROM connections c JOIN profiles p ON p.id = c.requester_id AND p.deleted_at IS NULL
  WHERE c.addressee_id = ${me}::uuid AND c.status = 'pending' AND c.blocked_by IS NULL`;

const applicationsSql = (me: string): SQL => sql`
  SELECT a.id, a.created_at, w.title AS workspace, p.id AS actor_id, COALESCE(p.full_name, p.username) AS actor_name, p.avatar_url
  FROM role_applications a
  JOIN profiles p ON p.id = a.applicant_id AND p.deleted_at IS NULL
  JOIN workspaces w ON w.id = a.workspace_id
  WHERE a.status = 'pending' AND a.applicant_id <> ${me}::uuid
    AND ${canReviewWorkspaceSql(me, sql`a.workspace_id`)}
    AND NOT app_private.review_hidden_by_block(${me}::uuid, a.applicant_id, a.workspace_id)`;

const questionsSql = (me: string): SQL => sql`
  SELECT q.id, q.workspace_id, q.task_id, q.agent_name, q.questions, q.created_at, w.title AS workspace
  FROM agent_questions q JOIN workspaces w ON w.id = q.workspace_id
  WHERE q.to_user_id = ${me}::uuid AND q.status = 'open' AND q.expires_at > now() AND w.deletion_scheduled_at IS NULL`;

const accessSql = (me: string): SQL => sql`
  SELECT r.id, r.session_id, r.scope, r.created_at, s.agent_name
  FROM agent_access_requests r JOIN extension_device_sessions s ON s.id = r.session_id
  WHERE r.user_id = ${me}::uuid AND r.status = 'open' AND r.expires_at > now()`;

const importantSql = (me: string): SQL => sql`
  SELECT n.* FROM user_notifications n
  WHERE n.user_id = ${me}::uuid AND n.importance = 'important' AND n.read_at IS NULL AND n.dismissed_at IS NULL
    AND (n.snoozed_until IS NULL OR n.snoozed_until <= now())
    AND n.kind <> ALL(${sql.raw(`ARRAY[${NEEDS_YOU_REQUEST_KINDS.map((k) => `'${k}'`).join(",")}]`)}::text[])`;

const rows = async <T>(q: SQL) => Array.from(await db.execute<T & Record<string, unknown>>(q)) as T[];
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function countNeedsYou(userId: string): Promise<number> {
  // The same caps as the list, so the bell and the tab title never disagree with what the tray shows.
  const parts = ([[reviewsSql, 50], [connectionsSql, 50], [applicationsSql, 50], [questionsSql, 20], [accessSql, 20], [importantSql, 20]] as const)
    .map(([part, cap]) => sql`(SELECT count(*) FROM (${part(userId)} LIMIT ${cap}) x)`);
  const [row] = await rows<{ n: number }>(sql`SELECT (${sql.join(parts, sql` + `)})::int AS n`);
  return Number(row?.n ?? 0);
}

export async function readNeedsYou(userId: string): Promise<NeedsYouItem[]> {
  const [reviews, conns, apps, questions, access, important, linked] = await Promise.all([
    rows<{ id: string; number: number; title: string; workspace_id: string; slug: string | null; workspace: string; branch: string; actor_id: string | null; actor_name: string | null; avatar_url: string | null; created_at: unknown }>(sql`${reviewsSql(userId)} ORDER BY r.created_at LIMIT 50`),
    rows<{ id: string; created_at: unknown; actor_id: string; actor_name: string | null; avatar_url: string | null; headline: string | null }>(sql`${connectionsSql(userId)} ORDER BY c.created_at LIMIT 50`),
    rows<{ id: string; created_at: unknown; workspace: string; actor_id: string; actor_name: string | null; avatar_url: string | null }>(sql`${applicationsSql(userId)} ORDER BY a.created_at LIMIT 50`),
    rows<{ id: string; workspace_id: string; task_id: string | null; agent_name: string | null; questions: unknown; created_at: unknown; workspace: string }>(sql`${questionsSql(userId)} ORDER BY q.created_at LIMIT 20`),
    rows<{ id: string; session_id: string; scope: string; created_at: unknown; agent_name: string | null }>(sql`${accessSql(userId)} ORDER BY r.created_at LIMIT 20`),
    db.select().from(userNotifications).where(and(
      eq(userNotifications.userId, userId), eq(userNotifications.importance, "important"),
      isNull(userNotifications.readAt), isNull(userNotifications.dismissedAt),
      or(isNull(userNotifications.snoozedUntil), lte(userNotifications.snoozedUntil, new Date())),
      notInArray(userNotifications.kind, [...NEEDS_YOU_REQUEST_KINDS]),
    )).orderBy(asc(userNotifications.activityAt)).limit(20),
    rows<{ id: string; dedupe_key: string; href: string | null; application_id: string | null }>(sql`
      SELECT id, dedupe_key, href, entity_refs->>'applicationId' AS application_id FROM user_notifications
      WHERE user_id = ${userId}::uuid AND dismissed_at IS NULL
        AND kind = ANY(${sql.raw(`ARRAY[${NEEDS_YOU_REQUEST_KINDS.map((k) => `'${k}'`).join(",")}]`)}::text[])
      ORDER BY activity_at DESC LIMIT 300`),
  ]);
  const byKey = new Map(linked.map((n) => [n.dedupe_key, n]));
  const byPrefix = (prefix: string) => linked.find((n) => n.dedupe_key.startsWith(prefix)) ?? null;
  const items: NeedsYouItem[] = [];

  for (const r of reviews) items.push({
    key: `review:${r.id}`, source: "review", notificationId: byPrefix(`merge-request:${r.id}:`)?.id ?? null,
    actor: { id: r.actor_id, name: r.actor_name, avatarUrl: r.avatar_url },
    sentence: { actor: r.actor_name ?? "Someone", verb: " asked you to review ", object: `!${r.number} ${r.title}` },
    snippet: null, context: `${r.workspace} · ${r.branch}`, waitingSince: iso(r.created_at), blocksOthers: 0,
    href: `/workspaces/${r.slug ?? r.workspace_id}?tab=files&filesView=merge-requests&mr=${r.number}`,
    primary: { act: "open", label: "Review" }, secondary: null,
  });
  for (const c of conns) items.push({
    key: `connection:${c.id}`, source: "connection", notificationId: byKey.get(`connection:${c.id}:received`)?.id ?? null,
    actor: { id: c.actor_id, name: c.actor_name, avatarUrl: c.avatar_url },
    sentence: { actor: c.actor_name ?? "Someone", verb: " wants to connect", object: "" },
    snippet: null, context: c.headline, waitingSince: iso(c.created_at), blocksOthers: 0, href: "/network?tab=invitations",
    primary: { act: "accept", label: "Accept" }, secondary: { act: "ignore", label: "Ignore" },
  });
  for (const a of apps) {
    const row = linked.find((n) => n.application_id === a.id) ?? null;
    items.push({
      key: `application:${a.id}`, source: "application", notificationId: row?.id ?? null,
      actor: { id: a.actor_id, name: a.actor_name, avatarUrl: a.avatar_url },
      sentence: { actor: a.actor_name ?? "Someone", verb: " applied to join ", object: a.workspace },
      snippet: null, context: "Application", waitingSince: iso(a.created_at), blocksOthers: 0, href: row?.href ?? "/network?tab=invitations",
      primary: { act: "open", label: "View application" }, secondary: null,
    });
  }
  for (const q of questions) {
    const all = (Array.isArray(q.questions) ? q.questions : []) as Array<{ key?: string; question?: string; options?: Array<{ value: string; label: string; recommended?: boolean }> }>;
    const first = all[0] ?? null;
    // One answer closes the whole ask, so options show in the row only when the ask has one question.
    const single = all.length === 1;
    const more = all.length - 1;
    items.push({
      key: `agent_question:${q.id}`, source: "agent_question", notificationId: byKey.get(`agent-question:${q.id}`)?.id ?? null, actor: null,
      sentence: { actor: q.agent_name || "An agent", verb: " asks in ", object: q.workspace },
      snippet: first?.question ? (single ? first.question : `${first.question} (and ${more} more ${more === 1 ? "question" : "questions"})`) : null, context: "Agent question", waitingSince: iso(q.created_at), blocksOthers: 0,
      href: q.task_id ? `/workspaces/${q.workspace_id}?tab=tasks&task=${q.task_id}&question=${q.id}` : `/workspaces/${q.workspace_id}?question=${q.id}`,
      primary: null, secondary: { act: "open", label: "Answer in chat" },
      options: single ? (first?.options ?? []).slice(0, 4).map((o) => ({ value: o.value, label: o.label, recommended: o.recommended === true })) : [],
      questionKey: single ? first?.key : undefined,
    });
  }
  for (const r of access) items.push({
    key: `agent_access:${r.id}`, source: "agent_access", notificationId: byKey.get(`agent-access-request:${r.id}`)?.id ?? null, actor: null,
    sentence: { actor: r.agent_name || "An AI agent", verb: " asks to also ", object: scopeWords(r.scope) },
    snippet: null, context: "Not in its access", waitingSince: iso(r.created_at), blocksOthers: 0,
    href: `/settings/agents/${r.session_id}?request=${r.id}`,
    primary: { act: "allow", label: "Allow once" }, secondary: { act: "deny", label: "Deny" },
  });
  for (const row of important) {
    const n = toNotificationItem(row);
    items.push({
      key: `important:${n.id}`, source: "important", notificationId: n.id, actor: null,
      sentence: { actor: "", verb: n.title, object: "" }, snippet: null, context: null,
      waitingSince: n.activityAt, blocksOthers: n.entityRefs?.status === "blocked" ? 1 : 0, href: n.href ?? "",
      primary: null, secondary: null, notification: n,
    });
  }
  return items.sort((a, b) => b.blocksOthers - a.blocksOthers || a.waitingSince.localeCompare(b.waitingSince));
}
