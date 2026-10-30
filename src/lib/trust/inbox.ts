import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { moderationCases, moderationMessageTemplates } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { logModerationEvent } from "@/lib/trust/cases";
import { notifySafety } from "@/lib/trust/notify";
import { caseLabel, ruleLabel, type ReportReason, type ReportTargetKind, type Severity } from "@/lib/trust/rules";
import { listStaff } from "@/lib/trust/staff";

// The Inbox (Trust & Safety Console Redesign R2, S1–S13): one list of reports, appeals and verification requests,
// paged; one counts query; claims as leases; assign and escalate; the live cursor; case views; message context and
// file previews; per-rule message templates.

/** A claim holds while renewed: 10 minutes from the last interaction, 2 minutes from the last heartbeat (S3). */
export const LEASE_MINUTES = 10;
export const PRESENCE_GRACE_MINUTES = 2;
const LIVE_LEASE = sql`(c.assignee_id IS NOT NULL AND c.claimed_until > now() AND c.claim_seen_at > now() - make_interval(mins => ${PRESENCE_GRACE_MINUTES}))`;
const PAGE = 50;

export type InboxView = "needs_me" | "unclaimed" | "urgent" | "appeals" | "org" | "escalated" | "mine" | "done";
export type InboxFilters = { view?: InboxView; q?: string; severity?: Severity; kind?: ReportTargetKind; source?: string; sort?: "due" | "newest" | "reports"; due?: "overdue" | "hour"; org?: string };
export type InboxItem = {
  type: "case" | "appeal" | "verification";
  id: string; number: number | null; severity: Severity | null; state: string; reason: ReportReason | null; kind: ReportTargetKind | null;
  label: string | null; reports: number; due_at: string | null; created_at: string; sort_at: string;
  routed_to: string | null; pile_on: boolean; legal_hold: boolean; escalated: boolean; source: string | null; version: number;
  subject_id: string | null; subject_name: string | null; subject_username: string | null; subject_avatar: string | null;
  claimer_id: string | null; claimer_name: string | null; assigned_id: string | null; assigned_name: string | null; outcome: string | null; decided_at: string | null;
};

/** One page of the Inbox, ordered by what's due first; the cursor is the last row's sort key and id. */
export async function readInbox(staffId: string, f: InboxFilters, cursor: { at: string; id: string } | null) {
  const view = f.view ?? "needs_me";
  const done = view === "done";
  const q = f.q?.trim().replace(/^@/, "") ?? "";
  const number = Number(q.replace(/^nb-?/i, ""));
  const byNumber = q && Number.isInteger(number) && number > 0;
  const nameMatch = (alias: string) => sql`(${sql.raw(alias)}.username ILIKE ${`${q}%`} OR ${sql.raw(alias)}.full_name ILIKE ${`%${q}%`})`;
  const caseWhere = [
    done ? sql`c.state IN ('decided', 'closed')` : sql`c.state IN ('open', 'in_review')`,
    sql`c.merged_into IS NULL`,
    view === "needs_me" ? sql`(NOT ${LIVE_LEASE} OR c.assignee_id = ${staffId}) AND (c.assigned_to IS NULL OR c.assigned_to = ${staffId})` : sql`true`,
    view === "unclaimed" ? sql`NOT ${LIVE_LEASE} AND c.assigned_to IS NULL` : sql`true`,
    view === "urgent" ? sql`c.severity = 'urgent'` : sql`true`,
    view === "org" ? sql`c.routed_to = 'org'` : sql`true`,
    view === "escalated" ? sql`c.escalated_at IS NOT NULL` : sql`true`,
    view === "mine" ? sql`(c.assigned_to = ${staffId} OR (c.assignee_id = ${staffId} AND ${LIVE_LEASE}))` : sql`true`,
    f.severity ? sql`c.severity = ${f.severity}` : sql`true`,
    f.kind ? sql`c.target_kind = ${f.kind}` : sql`true`,
    f.source ? sql`c.source = ${f.source}` : sql`true`,
    f.org ? sql`c.org_id = ${f.org}` : sql`true`,
    f.due === "overdue" ? sql`c.deadline_at < now()` : f.due === "hour" ? sql`c.deadline_at >= now() AND c.deadline_at < now() + interval '1 hour'` : sql`true`,
    q ? (byNumber ? sql`c.number = ${number}` : sql`(c.snapshot->>'label' ILIKE ${`%${q}%`} OR ${nameMatch("s")})`) : sql`true`,
  ];
  const withCases = view !== "appeals";
  const narrowed = Boolean(f.severity || f.kind || f.source || f.due || f.org);
  const withAppeals = (view === "needs_me" || view === "appeals" || view === "done" || view === "mine") && !narrowed;
  const withVerification = (view === "needs_me" || view === "unclaimed") && !narrowed && !byNumber;
  const sortCol = f.sort === "newest" ? "created" : f.sort === "reports" ? "reports" : "due";
  const parts = [
    withCases ? sql`
      SELECT 'case' AS type, c.id, c.number::int AS number, c.severity, c.state, c.reason, c.target_kind AS kind, c.snapshot->>'label' AS label,
             (SELECT count(*)::int FROM content_reports r WHERE r.case_id = c.id) AS reports, c.deadline_at AS due_at, c.created_at,
             ${done ? sql`coalesce(c.decided_at, c.updated_at)` : sql`coalesce(c.deadline_at, c.created_at)`} AS due_key,
             c.routed_to, c.pile_on, c.legal_hold, c.escalated_at IS NOT NULL AS escalated, c.source, c.version, c.outcome,
             c.subject_id, s.full_name AS subject_name, s.username AS subject_username, s.avatar_url AS subject_avatar,
             CASE WHEN ${LIVE_LEASE} THEN c.assignee_id END AS claimer_id, CASE WHEN ${LIVE_LEASE} THEN coalesce(a.full_name, a.username) END AS claimer_name,
             c.assigned_to AS assigned_id, coalesce(g.full_name, g.username) AS assigned_name, c.decided_at::text AS decided_at
      FROM moderation_cases c LEFT JOIN profiles s ON s.id = c.subject_id LEFT JOIN profiles a ON a.id = c.assignee_id LEFT JOIN profiles g ON g.id = c.assigned_to
      WHERE ${sql.join(caseWhere, sql` AND `)}` : null,
    withAppeals ? sql`
      SELECT 'appeal' AS type, c.id, c.number::int AS number, c.severity, ap.state, c.reason, c.target_kind AS kind, c.snapshot->>'label' AS label, 0 AS reports,
             ap.deadline_at AS due_at, ap.created_at,
             ${done ? sql`coalesce(ap.decided_at, ap.created_at)` : sql`ap.deadline_at`} AS due_key,
             'staff' AS routed_to, false AS pile_on, c.legal_hold, false AS escalated, 'appeal' AS source, c.version, ap.state AS outcome,
             ap.subject_id, s.full_name AS subject_name, s.username AS subject_username, s.avatar_url AS subject_avatar,
             CASE WHEN ap.state = 'in_review' THEN ap.assignee_id END AS claimer_id,
             CASE WHEN ap.state = 'in_review' THEN coalesce(a.full_name, a.username) END AS claimer_name,
             NULL::uuid AS assigned_id, NULL::text AS assigned_name, ap.decided_at::text AS decided_at
      FROM moderation_appeals ap JOIN moderation_cases c ON c.id = ap.case_id LEFT JOIN profiles s ON s.id = ap.subject_id LEFT JOIN profiles a ON a.id = ap.assignee_id
      WHERE ${done ? sql`ap.state NOT IN ('pending', 'in_review')` : sql`ap.state IN ('pending', 'in_review')`}
        AND ${view === "mine" ? sql`ap.assignee_id = ${staffId}` : view === "needs_me" ? sql`(ap.assignee_id IS NULL OR ap.assignee_id = ${staffId})` : sql`true`}
        AND ${q ? (byNumber ? sql`c.number = ${number}` : nameMatch("s")) : sql`true`}` : null,
    withVerification ? sql`
      SELECT 'verification' AS type, w.id, NULL::int AS number, NULL::text AS severity, 'open' AS state, NULL::text AS reason, 'project' AS kind, w.title AS label,
             0 AS reports, w.verification_requested_at + interval '3 days' AS due_at, w.verification_requested_at AS created_at,
             w.verification_requested_at + interval '3 days' AS due_key, NULL::text AS routed_to, false AS pile_on, false AS legal_hold, false AS escalated,
             'verification' AS source, 1 AS version, NULL::text AS outcome,
             w.owner_id AS subject_id, o.full_name AS subject_name, o.username AS subject_username, o.avatar_url AS subject_avatar,
             NULL::uuid AS claimer_id, NULL::text AS claimer_name, NULL::uuid AS assigned_id, NULL::text AS assigned_name, NULL::text AS decided_at
      FROM workspaces w LEFT JOIN profiles o ON o.id = w.owner_id
      WHERE w.kind = 'organization' AND w.verification_requested_at IS NOT NULL AND w.verified_at IS NULL AND w.deleted_at IS NULL
        AND ${q ? sql`w.title ILIKE ${`%${q}%`}` : sql`true`}` : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null);
  if (!parts.length) return { items: [] as InboxItem[], next: null };
  const key = sortCol === "created" ? sql`u.created_at` : sortCol === "reports" ? sql`(-u.reports)::text` : sql`u.due_key`;
  const desc = done || sortCol === "created";
  const after = cursor
    ? (desc ? sql`AND (u.sort_at, u.id::text) < (${cursor.at}, ${cursor.id})` : sql`AND (u.sort_at, u.id::text) > (${cursor.at}, ${cursor.id})`)
    : sql``;
  const rows = await db.execute<InboxItem>(sql`
    SELECT * FROM (
      SELECT u.*, u.due_at::text AS due_at_text, u.created_at::text AS created_text,
             ${sortCol === "reports" ? sql`lpad((100000 - u.reports)::text, 6, '0') || u.due_key::text` : sql`to_char(${key} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`} AS sort_at
      FROM (${sql.join(parts, sql` UNION ALL `)}) u
    ) u WHERE true ${after}
    ORDER BY u.sort_at ${desc ? sql`DESC` : sql`ASC`}, u.id::text ${desc ? sql`DESC` : sql`ASC`} LIMIT ${PAGE + 1}`);
  const list = [...rows].map((r) => {
    const row = r as InboxItem & { due_at_text: string | null; created_text: string };
    return { ...row, due_at: row.due_at_text ? new Date(row.due_at_text).toISOString() : null, created_at: new Date(row.created_text).toISOString() } as InboxItem;
  });
  const more = list.length > PAGE;
  const items = list.slice(0, PAGE);
  const last = items.at(-1);
  return { items, next: more && last ? { at: last.sort_at, id: last.id } : null };
}

/** The Today strip and tab counts in one pass (S7), reused for 10 seconds per server. */
let countsCache: { at: number; value: InboxCounts } | null = null;
export type InboxCounts = { open: number; urgent: number; overdue: number; due_hour: number; appeals: number; unclaimed: number; escalated: number; active: number; verification: number };
export async function inboxCounts(fresh = false): Promise<InboxCounts> {
  if (!fresh && countsCache && Date.now() - countsCache.at < 10_000) return countsCache.value;
  const [row] = await db.execute<InboxCounts>(sql`
    WITH open AS (SELECT * FROM moderation_cases c WHERE c.state IN ('open', 'in_review') AND c.merged_into IS NULL)
    SELECT count(*)::int AS open,
           count(*) FILTER (WHERE severity = 'urgent')::int AS urgent,
           count(*) FILTER (WHERE deadline_at < now())::int AS overdue,
           count(*) FILTER (WHERE deadline_at >= now() AND deadline_at < now() + interval '1 hour')::int AS due_hour,
           count(*) FILTER (WHERE NOT (assignee_id IS NOT NULL AND claimed_until > now() AND claim_seen_at > now() - make_interval(mins => ${PRESENCE_GRACE_MINUTES})) AND assigned_to IS NULL)::int AS unclaimed,
           count(*) FILTER (WHERE escalated_at IS NOT NULL)::int AS escalated,
           (SELECT count(*)::int FROM moderation_appeals WHERE state IN ('pending', 'in_review')) AS appeals,
           (SELECT count(*)::int FROM moderation_actions WHERE undone_at IS NULL AND reversed_at IS NULL AND lifted_at IS NULL
              AND action IN ('limit', 'suspension', 'ban', 'restrict', 'suspend_workspace', 'remove_workspace', 'hide_discover')
              AND (ends_at IS NULL OR ends_at > now())) AS active,
           (SELECT count(*)::int FROM workspaces WHERE kind = 'organization' AND verification_requested_at IS NOT NULL AND verified_at IS NULL AND deleted_at IS NULL) AS verification
    FROM open c`);
  const value = row ?? { open: 0, urgent: 0, overdue: 0, due_hour: 0, appeals: 0, unclaimed: 0, escalated: 0, active: 0, verification: 0 };
  countsCache = { at: Date.now(), value };
  return value;
}

/** Organizations with open cases, for the Filter popover's Org list. */
export async function inboxOrgs() {
  const rows = await db.execute<{ id: string; title: string }>(sql`
    SELECT w.id, w.title FROM workspaces w WHERE w.id IN (SELECT DISTINCT org_id FROM moderation_cases WHERE org_id IS NOT NULL AND state IN ('open', 'in_review'))
    ORDER BY w.title LIMIT 100`);
  return [...rows];
}

/** The live cursor (S1): everything logged after `seq`, oldest first, so a screen catches up exactly. */
export async function eventsSince(seq: number, limit = 500) {
  const rows = await db.execute<{ seq: number; case_id: string | null; kind: string; actor_id: string | null; at: string }>(sql`
    SELECT seq::bigint::float8 AS seq, case_id, kind, actor_id, created_at::text AS at FROM moderation_events
    WHERE seq > ${seq} ORDER BY seq LIMIT ${limit + 1}`);
  const list = [...rows].map((r) => ({ ...r, seq: Number(r.seq), at: new Date(r.at).toISOString() }));
  return { events: list.slice(0, limit), more: list.length > limit };
}

export async function latestSeq() {
  const [row] = await db.execute<{ seq: number | null }>(sql`SELECT max(seq)::float8 AS seq FROM moderation_events`);
  return Number(row?.seq ?? 0);
}

type CaseLock = { id: string; version: number; state: string; assignee_id: string | null; leased: boolean; assignee_name: string | null };
async function lockCase(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], caseId: string) {
  const [row] = await tx.execute<CaseLock>(sql`
    SELECT c.id, c.version, c.state, c.assignee_id, ${LIVE_LEASE} AS leased, coalesce(a.full_name, a.username) AS assignee_name
    FROM moderation_cases c LEFT JOIN profiles a ON a.id = c.assignee_id WHERE c.id = ${caseId} FOR UPDATE OF c`);
  return row ?? null;
}

export type Stale = { ok: false; code: "stale"; error: string; version: number };
/** Who changed the case last, for "Rao changed this a moment ago" (S2). */
async function staleResult(caseId: string, version: number, staffId: string): Promise<Stale> {
  const [last] = await db.execute<{ name: string | null }>(sql`
    SELECT coalesce(p.full_name, p.username) AS name FROM moderation_events e LEFT JOIN profiles p ON p.id = e.actor_id
    WHERE e.case_id = ${caseId} AND e.actor_id IS NOT NULL ORDER BY e.seq DESC LIMIT 1`);
  await logModerationEvent(db, { caseId, actorId: staffId, kind: "stale_refused", data: { version } });
  return { ok: false, code: "stale", error: `${last?.name ?? "Someone"} changed this a moment ago. Review the latest, then try again.`, version };
}

/** Optimistic check for any case write: the version the staff member saw must still be current (S2). */
export async function checkVersion(caseId: string, expected: number | null | undefined, staffId: string): Promise<Stale | null> {
  if (expected == null) return null;
  const [row] = await db.select({ version: moderationCases.version }).from(moderationCases).where(eq(moderationCases.id, caseId)).limit(1);
  return row && row.version !== expected ? staleResult(caseId, row.version, staffId) : null;
}

/**
 * Claims are leases (S3): claiming, or touching the decision form, holds the case 10 minutes; a heartbeat every
 * 45 seconds while the tab is open keeps it; leaving frees it within 2 minutes. Take over is logged.
 */
export async function claimLease(caseId: string, staffId: string, mode: "claim" | "take_over", expected?: number | null) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    if (!c || (c.state !== "open" && c.state !== "in_review")) return { ok: false as const, error: "This case was already decided." };
    if (expected != null && c.version !== expected && c.assignee_id !== staffId) return staleResult(caseId, c.version, staffId);
    if (mode === "claim" && c.leased && c.assignee_id !== staffId) return { ok: false as const, error: `${c.assignee_name ?? "Someone"} is reviewing this case.`, claimedBy: c.assignee_name };
    const fresh = c.assignee_id !== staffId || !c.leased;
    await tx.execute(sql`
      UPDATE moderation_cases SET assignee_id = ${staffId}, claimed_at = CASE WHEN ${fresh} THEN now() ELSE claimed_at END, state = 'in_review',
        claimed_until = now() + make_interval(mins => ${LEASE_MINUTES}), claim_seen_at = now(), updated_at = now() WHERE id = ${caseId}`);
    if (fresh) await logModerationEvent(tx, { caseId, actorId: staffId, kind: mode === "claim" ? "claimed" : "taken_over" });
    const [v] = await tx.select({ version: moderationCases.version }).from(moderationCases).where(eq(moderationCases.id, caseId));
    return { ok: true as const, version: v!.version };
  });
}

/** The heartbeat: `active` (they touched the form recently) extends the 10 minutes; any beat keeps the 2. */
export async function renewLease(caseId: string, staffId: string, active: boolean) {
  const updated = await db.execute<{ id: string }>(sql`
    UPDATE moderation_cases SET claim_seen_at = now(),
      claimed_until = CASE WHEN ${active} THEN now() + make_interval(mins => ${LEASE_MINUTES}) ELSE claimed_until END
    WHERE id = ${caseId} AND assignee_id = ${staffId} AND state = 'in_review' AND claimed_until > now() RETURNING id`);
  return updated.length > 0;
}

export async function releaseLease(caseId: string, staffId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE moderation_cases SET assignee_id = NULL, claimed_at = NULL, claimed_until = NULL, claim_seen_at = NULL, state = 'open', updated_at = now()
    WHERE id = ${caseId} AND assignee_id = ${staffId} AND state = 'in_review' RETURNING id`);
  if (rows.length) await logModerationEvent(db, { caseId, actorId: staffId, kind: "released" });
  return rows.length > 0;
}

/** Assign to a staff member with a reason (S11); they get a tray notice and it shows in their Mine view. */
export async function assignCase(caseId: string, staffId: string, to: string | null, reason: string, expected?: number | null) {
  const stale = await checkVersion(caseId, expected, staffId);
  if (stale) return stale;
  const [c] = await db.update(moderationCases).set({ assignedTo: to, updatedAt: new Date() }).where(and(eq(moderationCases.id, caseId), sql`${moderationCases.state} IN ('open', 'in_review')`))
    .returning({ number: moderationCases.number });
  if (!c) return { ok: false as const, error: "This case was already decided." };
  await logModerationEvent(db, { caseId, actorId: staffId, kind: to ? "assigned" : "unassigned", data: { to, reason: reason.slice(0, 500) } });
  if (to && to !== staffId) await notifySafety({ to, title: `${caseLabel(Number(c.number))} was assigned to you`, body: reason.slice(0, 300) || null, href: `/admin/trust?case=${caseLabel(Number(c.number))}`, dedupeKey: `assigned:${caseId}:${to}:${Date.now()}` });
  return { ok: true as const };
}

/** "Needs an admin" (S11): a moderator hands a case up; admins hear by tray and push. */
export async function escalateCase(caseId: string, staffId: string, note: string, on: boolean, expected?: number | null) {
  const stale = await checkVersion(caseId, expected, staffId);
  if (stale) return stale;
  const [c] = await db.update(moderationCases).set({ escalatedAt: on ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(moderationCases.id, caseId), sql`${moderationCases.state} IN ('open', 'in_review')`)).returning({ number: moderationCases.number });
  if (!c) return { ok: false as const, error: "This case was already decided." };
  await logModerationEvent(db, { caseId, actorId: staffId, kind: on ? "escalated" : "escalation_cleared", data: { note: note.slice(0, 1000) } });
  if (on) {
    const label = caseLabel(Number(c.number));
    for (const admin of (await listStaff()).filter((s) => s.role === "admin" && s.id !== staffId)) {
      await notifySafety({ to: admin.id, title: `${label} needs an admin`, body: note.slice(0, 300) || null, href: `/admin/trust?case=${label}`, dedupeKey: `escalated:${caseId}:${admin.id}` });
    }
  }
  return { ok: true as const };
}

/** Who opened a case and when (S13): one entry per person per case per 10 minutes. */
export async function logCaseView(caseId: string, staffId: string) {
  const [recent] = await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM moderation_events WHERE case_id = ${caseId} AND actor_id = ${staffId} AND kind = 'viewed' AND created_at > now() - interval '10 minutes') AS ok`);
  if (!recent?.ok) await logModerationEvent(db, { caseId, actorId: staffId, kind: "viewed" });
}

/** Ten more messages before `beforeSeq`, only while the first reporter can still see the conversation (S9). */
export async function messageContext(caseId: string, beforeSeq: number) {
  const [c] = await db.execute<{ channel: string; reporter: string | null }>(sql`
    SELECT c.target_id AS channel, (SELECT r.reporter_id FROM content_reports r WHERE r.case_id = c.id ORDER BY r.created_at LIMIT 1) AS reporter
    FROM moderation_cases c WHERE c.id = ${caseId} AND c.target_kind = 'chat_message'`);
  if (!c?.reporter) return null;
  const [member] = await db.execute<{ ok: boolean }>(sql`SELECT app_private.chat_is_member(${c.channel}::uuid, ${c.reporter}::uuid) AS ok`);
  if (!member?.ok) return null;
  const rows = await db.execute<{ seq: number; author: string | null; body: string | null; at: string; deleted: boolean }>(sql`
    SELECT m.channel_seq::int AS seq, coalesce(p.full_name, p.username) AS author, m.body, m.created_at::text AS at, m.deleted_at IS NOT NULL AS deleted
    FROM chat_messages m LEFT JOIN profiles p ON p.id = m.author_id
    WHERE m.channel_id = ${c.channel} AND m.channel_seq < ${beforeSeq} AND m.kind = 'user' ORDER BY m.channel_seq DESC LIMIT 10`);
  return [...rows].reverse().map((m) => ({ ...m, body: m.deleted ? null : (m.body ?? "").slice(0, 2000) }));
}

/** A short-lived link to a reported file (S9): opened on click by staff, never downloaded by the console. */
export async function filePreviewUrl(caseId: string) {
  const [f] = await db.execute<{ bucket: string | null; key: string | null; mime: string | null; name: string }>(sql`
    SELECT coalesce(a.bucket, 'project-files') AS bucket, coalesce(a.storage_key, n.s3_key) AS key, n.mime_type AS mime, n.name
    FROM moderation_cases c JOIN workspace_nodes n ON n.id = c.target_id LEFT JOIN storage_assets a ON a.id = n.asset_id
    WHERE c.id = ${caseId} AND c.target_kind = 'file'`);
  if (!f?.key || !f.bucket) return null;
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(f.bucket).createSignedUrl(f.key, 10 * 60);
  return error || !data?.signedUrl ? null : { url: data.signedUrl, mime: f.mime, name: f.name };
}

export type TemplateKey = `rule:${number}` | `appeal:${"upheld" | "reduced" | "reversed"}`;
export const TEMPLATE_KEY = /^(rule:([1-9]|1[0-5])|appeal:(upheld|reduced|reversed))$/;

/** Saved messages (S13, R10): per rule and per appeal outcome; a missing one starts from the built-in sentence. */
export async function messageTemplates() {
  const rows = await db.select({ key: moderationMessageTemplates.key, message: moderationMessageTemplates.message }).from(moderationMessageTemplates);
  return Object.fromEntries(rows.map((r) => [r.key, r.message])) as Partial<Record<TemplateKey, string>>;
}

export async function saveMessageTemplate(key: TemplateKey, message: string, staffId: string) {
  const text = message.trim().slice(0, 4000);
  if (!text) {
    await db.delete(moderationMessageTemplates).where(eq(moderationMessageTemplates.key, key));
  } else {
    await db.insert(moderationMessageTemplates).values({ key, message: text, updatedBy: staffId })
      .onConflictDoUpdate({ target: moderationMessageTemplates.key, set: { message: text, updatedBy: staffId, updatedAt: new Date() } });
  }
  await logModerationEvent(db, { caseId: null, actorId: staffId, kind: "template_saved", data: { key, label: key.startsWith("rule:") ? ruleLabel(Number(key.slice(5))) : key } });
}
