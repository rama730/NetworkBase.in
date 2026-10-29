import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { moderationCases, workspaces } from "@/lib/db/schema";
import { logModerationEvent } from "@/lib/trust/cases";
import { activeStrikes } from "@/lib/trust/decide";
import { deadlinesFor, REASON_RULES, suggestedStep, type ReportReason, type ReportTargetKind, type Severity } from "@/lib/trust/rules";
import { resolveReportTarget } from "@/lib/trust/targets";

// The staff console's reads and small writes (docs/trust-and-safety-concept.md §17, C1–C14). Decisions live in
// decide.ts; this file is everything around them: the queue, one case, claims, notes, Active, People, the log.

export type QueueView = "needs_action" | "mine" | "org" | "decided";
export type QueueFilters = {
  view?: QueueView; q?: string; severity?: Severity; kind?: ReportTargetKind; source?: string;
  overdue?: boolean; pileOn?: boolean; unclaimed?: boolean; sort?: "deadline" | "newest" | "reports";
};
export type QueueRow = {
  id: string; number: number; severity: Severity; state: string; outcome: string | null; reason: ReportReason; target_kind: ReportTargetKind;
  label: string | null; reports: number; deadline_at: string | null; created_at: string; routed_to: "org" | "staff"; pile_on: boolean;
  assignee_id: string | null; assignee_name: string | null; source: string;
};

export async function readQueue(staffId: string, f: QueueFilters = {}): Promise<QueueRow[]> {
  const view = f.view ?? "needs_action";
  const q = f.q?.trim().replace(/^@/, "") ?? "";
  const number = Number(q.replace(/^nb-/i, ""));
  const where = [
    view === "decided" ? sql`c.state IN ('decided', 'closed')` : sql`c.state IN ('open', 'in_review')`,
    view === "mine" ? sql`c.assignee_id = ${staffId}` : sql`true`,
    view === "org" ? sql`c.routed_to = 'org'` : sql`true`,
    f.severity ? sql`c.severity = ${f.severity}` : sql`true`,
    f.kind ? sql`c.target_kind = ${f.kind}` : sql`true`,
    f.source ? sql`c.source = ${f.source}` : sql`true`,
    f.overdue ? sql`c.deadline_at < now()` : sql`true`,
    f.pileOn ? sql`c.pile_on` : sql`true`,
    f.unclaimed ? sql`c.assignee_id IS NULL` : sql`true`,
    q ? (Number.isInteger(number) && number > 0
      ? sql`c.number = ${number}`
      : sql`(c.snapshot->>'label' ILIKE ${`%${q}%`} OR EXISTS (SELECT 1 FROM profiles s WHERE s.id = c.subject_id AND (s.username ILIKE ${`${q}%`} OR s.full_name ILIKE ${`%${q}%`})))`) : sql`true`,
  ];
  const order = f.sort === "newest" ? sql`c.created_at DESC` : f.sort === "reports" ? sql`reports DESC, c.created_at DESC`
    : view === "decided" ? sql`c.decided_at DESC NULLS LAST` : sql`c.deadline_at ASC NULLS LAST, c.created_at`;
  const rows = await db.execute<QueueRow>(sql`
    SELECT c.id, c.number::int AS number, c.severity, c.state, c.outcome, c.reason, c.target_kind, c.snapshot->>'label' AS label,
           (SELECT count(*)::int FROM content_reports r WHERE r.case_id = c.id) AS reports, c.deadline_at::text, c.created_at::text,
           c.routed_to, c.pile_on, c.assignee_id, coalesce(a.full_name, a.username) AS assignee_name, c.source
    FROM moderation_cases c LEFT JOIN profiles a ON a.id = c.assignee_id
    WHERE ${sql.join(where, sql` AND `)} AND c.merged_into IS NULL
    ORDER BY ${order} LIMIT 200`);
  return [...rows];
}

export async function consoleCounts() {
  const [row] = await db.execute<{ open: number; urgent: number; overdue: number; appeals: number; active: number; verification: number }>(sql`
    SELECT (SELECT count(*)::int FROM moderation_cases WHERE state IN ('open', 'in_review') AND merged_into IS NULL) AS open,
           (SELECT count(*)::int FROM moderation_cases WHERE state IN ('open', 'in_review') AND severity = 'urgent' AND merged_into IS NULL) AS urgent,
           (SELECT count(*)::int FROM moderation_cases WHERE state IN ('open', 'in_review') AND deadline_at < now() AND merged_into IS NULL) AS overdue,
           (SELECT count(*)::int FROM moderation_appeals WHERE state IN ('pending', 'in_review')) AS appeals,
           (SELECT count(*)::int FROM moderation_actions WHERE undone_at IS NULL AND reversed_at IS NULL AND lifted_at IS NULL
              AND action IN ('limit', 'suspension', 'ban', 'restrict', 'suspend_workspace', 'remove_workspace', 'hide_discover')
              AND (ends_at IS NULL OR ends_at > now())) AS active,
           (SELECT count(*)::int FROM workspaces WHERE kind = 'organization' AND verification_requested_at IS NOT NULL AND verified_at IS NULL AND deleted_at IS NULL) AS verification`);
  return row ?? { open: 0, urgent: 0, overdue: 0, appeals: 0, active: 0, verification: 0 };
}

export async function caseIdByNumber(number: number) {
  const [row] = await db.select({ id: moderationCases.id }).from(moderationCases).where(eq(moderationCases.number, number)).limit(1);
  return row?.id ?? null;
}

/** Everything the case view shows (17.4). */
export async function readCase(caseId: string) {
  const [c] = await db.execute<QueueRow & {
    target_id: string; target_seq: number | null; subject_id: string | null; workspace_id: string | null; org_id: string | null; snapshot: Record<string, unknown> | null;
    details: string | null; claimed_at: string | null; legal_hold: boolean; decided_at: string | null; decided_by: string | null; decided_by_name: string | null; merged_into: string | null; auto_hidden_at: string | null;
    workspace_title: string | null; workspace_slug: string | null; workspace_kind: string | null;
  }>(sql`
    SELECT c.id, c.number::int AS number, c.severity, c.state, c.outcome, c.reason, c.target_kind, c.target_id, c.target_seq::int AS target_seq, c.subject_id,
           c.workspace_id, c.org_id, c.snapshot, c.details, c.snapshot->>'label' AS label, c.deadline_at::text, c.created_at::text, c.routed_to, c.pile_on,
           c.assignee_id, coalesce(a.full_name, a.username) AS assignee_name, c.claimed_at::text, c.legal_hold, c.source, c.decided_at::text, c.decided_by,
           coalesce(d.full_name, d.username) AS decided_by_name, c.merged_into, c.auto_hidden_at::text,
           (SELECT count(*)::int FROM content_reports r WHERE r.case_id = c.id) AS reports, w.title AS workspace_title, w.slug AS workspace_slug, w.kind AS workspace_kind
    FROM moderation_cases c LEFT JOIN profiles a ON a.id = c.assignee_id LEFT JOIN profiles d ON d.id = c.decided_by LEFT JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.id = ${caseId}`);
  if (!c) return null;

  const reports = await db.execute<{ id: string; reason: ReportReason; details: string | null; created_at: string; reporter_id: string; reporter_name: string | null; actioned: number; decided: number }>(sql`
    SELECT r.id, r.reason, r.details, r.created_at::text, r.reporter_id, coalesce(p.full_name, p.username) AS reporter_name,
           (SELECT count(*)::int FROM content_reports o WHERE o.reporter_id = r.reporter_id AND o.status = 'actioned') AS actioned,
           (SELECT count(*)::int FROM content_reports o WHERE o.reporter_id = r.reporter_id AND o.status IN ('actioned', 'dismissed')) AS decided
    FROM content_reports r LEFT JOIN profiles p ON p.id = r.reporter_id WHERE r.case_id = ${caseId} ORDER BY r.created_at`);
  const events = await db.execute<{ kind: string; created_at: string; actor_name: string | null; data: Record<string, unknown> }>(sql`
    SELECT e.kind, e.created_at::text, coalesce(p.full_name, p.username) AS actor_name, e.data
    FROM moderation_events e LEFT JOIN profiles p ON p.id = e.actor_id WHERE e.case_id = ${caseId} ORDER BY e.created_at`);
  const actions = await db.execute<{ id: string; action: string; rule: number | null; message: string | null; ends_at: string | null; appeal_until: string | null; strike: boolean; notified_at: string | null; undone_at: string | null; reversed_at: string | null; lifted_at: string | null; created_at: string }>(sql`
    SELECT id, action, rule, message, ends_at::text, appeal_until::text, strike, notified_at::text, undone_at::text, reversed_at::text, lifted_at::text, created_at::text
    FROM moderation_actions WHERE case_id = ${caseId} ORDER BY created_at`);
  const person = c.subject_id ? await readPersonSummary(c.subject_id) : null;
  const otherCases = c.subject_id ? await db.execute<{ id: string; number: number; reason: ReportReason; target_kind: ReportTargetKind; deadline_at: string | null }>(sql`
    SELECT id, number::int AS number, reason, target_kind, deadline_at::text FROM moderation_cases
    WHERE subject_id = ${c.subject_id} AND id <> ${caseId} AND state IN ('open', 'in_review') AND merged_into IS NULL ORDER BY deadline_at LIMIT 10`) : [];
  const live = await resolveReportTarget(c.target_kind, c.target_id, c.target_seq, null).catch(() => null);
  const liveState = !live ? "deleted" : JSON.stringify(stripMeta(live.snapshot)) === JSON.stringify(stripMeta(c.snapshot ?? {})) ? "unchanged" : "edited";
  const strikes = c.subject_id ? await activeStrikes(db, c.subject_id) : 0;
  return {
    ...c, reports: [...reports], events: [...events], actions: [...actions], person, otherCases: [...otherCases],
    live: live ? live.snapshot : null, liveState: liveState as "deleted" | "unchanged" | "edited", strikes, suggested: suggestedStep(strikes),
  };
}
const stripMeta = (snapshot: Record<string, unknown>) => {
  const { label: _label, href: _href, privateConversation: _private, ...rest } = snapshot;
  return rest;
};

export async function readPersonSummary(userId: string) {
  const [p] = await db.execute<{ id: string; name: string | null; username: string | null; avatar: string | null; email: string | null; created_at: string; restriction: string | null; until: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username, p.avatar_url AS avatar, p.email, p.created_at::text,
           app_private.moderation_restriction(p.id) AS restriction,
           (SELECT max(ends_at)::text FROM moderation_actions a WHERE a.subject_id = p.id AND a.action IN ('limit', 'suspension') AND a.ends_at > now()
              AND a.undone_at IS NULL AND a.reversed_at IS NULL AND a.lifted_at IS NULL) AS until
    FROM profiles p WHERE p.id = ${userId}`);
  return p ? { ...p, strikes: await activeStrikes(db, userId) } : null;
}

/** Claim, release or take over (17.4). A claim older than 2 hours without activity is released by the deadlines job. */
export async function setClaim(caseId: string, staffId: string, mode: "claim" | "release" | "take_over") {
  const now = new Date();
  const updated = await db.update(moderationCases).set(mode === "release"
    ? { assigneeId: null, claimedAt: null, state: "open", updatedAt: now }
    : { assigneeId: staffId, claimedAt: now, state: "in_review", updatedAt: now })
    .where(and(eq(moderationCases.id, caseId), sql`${moderationCases.state} IN ('open', 'in_review')`,
      mode === "claim" ? sql`${moderationCases.assigneeId} IS NULL` : mode === "release" ? eq(moderationCases.assigneeId, staffId) : sql`true`))
    .returning({ id: moderationCases.id });
  if (!updated.length) return false;
  await logModerationEvent(db, { caseId, actorId: staffId, kind: mode === "claim" ? "claimed" : mode === "release" ? "released" : "taken_over" });
  return true;
}

export async function addNote(caseId: string, staffId: string, body: string) {
  await logModerationEvent(db, { caseId, actorId: staffId, kind: "note", data: { body: body.slice(0, 4000) } });
}

export async function setLegalHold(caseId: string, staffId: string, hold: boolean) {
  await db.update(moderationCases).set({ legalHold: hold, updatedAt: new Date() }).where(eq(moderationCases.id, caseId));
  await logModerationEvent(db, { caseId, actorId: staffId, kind: hold ? "legal_hold" : "legal_hold_removed" });
}

export async function changeSeverity(caseId: string, staffId: string, severity: Severity, reason: string) {
  const [c] = await db.select({ createdAt: moderationCases.createdAt, severity: moderationCases.severity, routedTo: moderationCases.routedTo }).from(moderationCases).where(eq(moderationCases.id, caseId)).limit(1);
  if (!c) return false;
  await db.update(moderationCases).set({ severity, deadlineAt: deadlinesFor(severity, c.createdAt, c.routedTo === "org").deadlineAt, updatedAt: new Date() }).where(eq(moderationCases.id, caseId));
  await logModerationEvent(db, { caseId, actorId: staffId, kind: "severity_changed", data: { from: c.severity, to: severity, reason: reason.slice(0, 500) } });
  return true;
}

/** Folds a duplicate case into another open one: its reports move, it closes as duplicate. */
export async function mergeCase(fromId: string, intoId: string, staffId: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const moved = await tx.update(moderationCases).set({ state: "closed", outcome: "duplicate", mergedInto: intoId, decidedBy: staffId, decidedAt: now, updatedAt: now })
      .where(and(eq(moderationCases.id, fromId), sql`${moderationCases.state} IN ('open', 'in_review')`, sql`${moderationCases.id} <> ${intoId}`)).returning({ id: moderationCases.id });
    if (!moved.length) return false;
    await tx.execute(sql`UPDATE content_reports SET case_id = ${intoId} WHERE case_id = ${fromId}`);
    await logModerationEvent(tx, { caseId: fromId, actorId: staffId, kind: "merged", data: { into: intoId } });
    await logModerationEvent(tx, { caseId: intoId, actorId: staffId, kind: "merged_in", data: { from: fromId } });
    return true;
  });
}

/** A case opened by staff from an email, a legal request or their own finding (17.12). */
export async function openManualCase(staffId: string, input: { kind: ReportTargetKind; targetId: string; seq?: number | null; reason: ReportReason; severity?: Severity; source: "email" | "staff" | "legal"; details?: string; emailRef?: string; legalHold?: boolean }) {
  const target = await resolveReportTarget(input.kind, input.targetId, input.seq ?? null, null);
  if (!target) return null;
  const severity = input.severity ?? REASON_RULES[input.reason].severity;
  const { deadlineAt } = deadlinesFor(severity, new Date(), false);
  const [existing] = await db.execute<{ id: string; number: number }>(sql`
    SELECT id, number::int AS number FROM moderation_cases WHERE target_kind = ${input.kind} AND target_id = ${input.targetId}
      AND coalesce(target_seq, 0) = ${target.seq ?? 0} AND state IN ('open', 'in_review') LIMIT 1`);
  if (existing) return existing;
  const [created] = await db.insert(moderationCases).values({
    targetKind: input.kind, targetId: input.targetId, targetSeq: target.seq, workspaceId: target.workspaceId, orgId: target.orgId, subjectId: target.subjectId,
    severity, reason: input.reason, source: input.source, routedTo: "staff", deadlineAt, legalHold: Boolean(input.legalHold),
    details: [input.details?.trim(), input.emailRef?.trim() ? `Email: ${input.emailRef.trim()}` : null].filter(Boolean).join("\n") || null,
    snapshot: { ...target.snapshot, label: target.label, href: target.href, privateConversation: target.privateConversation },
  }).returning({ id: moderationCases.id, number: moderationCases.number });
  await logModerationEvent(db, { caseId: created!.id, actorId: staffId, kind: "opened", data: { source: input.source } });
  return { id: created!.id, number: Number(created!.number) };
}

/** Active tab (17.7): everything in force now. */
export async function readActive() {
  const rows = await db.execute<{ id: string; action: string; target_kind: string; target_id: string | null; subject_id: string | null; created_at: string; ends_at: string | null;
    case_number: number | null; what: string | null; appeal_state: string | null }>(sql`
    SELECT a.id, a.action, a.target_kind, a.target_id, a.subject_id, a.created_at::text, a.ends_at::text, c.number::int AS case_number,
           CASE WHEN a.target_kind = 'account' THEN coalesce(p.full_name, '@' || p.username) ELSE w.title END AS what, ap.state AS appeal_state
    FROM moderation_actions a LEFT JOIN moderation_cases c ON c.id = a.case_id LEFT JOIN profiles p ON p.id = a.subject_id
      LEFT JOIN workspaces w ON w.id = a.target_id AND a.target_kind = 'project' LEFT JOIN moderation_appeals ap ON ap.case_id = a.case_id
    WHERE a.undone_at IS NULL AND a.reversed_at IS NULL AND a.lifted_at IS NULL
      AND a.action IN ('limit', 'suspension', 'ban', 'restrict', 'suspend_workspace', 'remove_workspace', 'hide_discover')
      AND (a.ends_at IS NULL OR a.ends_at > now())
    ORDER BY a.created_at DESC LIMIT 300`);
  // Org suspensions made before cases existed still show, so nothing in force is invisible.
  const legacy = await db.select({ id: workspaces.id, title: workspaces.title, at: workspaces.suspendedAt, reason: workspaces.suspendReason }).from(workspaces)
    .where(and(sql`${workspaces.suspendedAt} IS NOT NULL`, sql`${workspaces.deletedAt} IS NULL`,
      sql`NOT EXISTS (SELECT 1 FROM moderation_actions a WHERE a.target_id = ${workspaces.id} AND a.action = 'suspend_workspace' AND a.lifted_at IS NULL AND a.reversed_at IS NULL AND a.undone_at IS NULL)`));
  return { rows: [...rows], legacy: legacy.map((l) => ({ ...l, at: l.at?.toISOString() ?? null })) };
}

/** People tab (17.8): search, then the person page. */
export async function searchPeople(q: string) {
  const term = q.trim().replace(/^@/, "");
  if (!term) return [];
  const rows = await db.execute<{ id: string; name: string | null; username: string | null; avatar: string | null; restriction: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username, p.avatar_url AS avatar, app_private.moderation_restriction(p.id) AS restriction FROM profiles p
    WHERE p.deleted_at IS NULL AND (p.username ILIKE ${`${term}%`} OR p.full_name ILIKE ${`%${term}%`} OR lower(p.email) = lower(${term}))
    ORDER BY p.username LIMIT 30`);
  return [...rows];
}

export async function readPerson(handleOrId: string) {
  const key = handleOrId.replace(/^@|^%40/, "");
  const [p] = await db.execute<{ id: string }>(sql`SELECT id FROM profiles WHERE username = ${key} OR id::text = ${key} LIMIT 1`);
  if (!p) return null;
  const summary = await readPersonSummary(p.id);
  const actions = await db.execute<{ id: string; action: string; rule: number | null; created_at: string; ends_at: string | null; strike: boolean; strike_expires_at: string | null; lifted_at: string | null; reversed_at: string | null; undone_at: string | null; case_number: number | null }>(sql`
    SELECT a.id, a.action, a.rule, a.created_at::text, a.ends_at::text, a.strike, a.strike_expires_at::text, a.lifted_at::text, a.reversed_at::text, a.undone_at::text, c.number::int AS case_number
    FROM moderation_actions a LEFT JOIN moderation_cases c ON c.id = a.case_id WHERE a.subject_id = ${p.id} ORDER BY a.created_at DESC LIMIT 100`);
  const cases = await db.execute<{ id: string; number: number; reason: ReportReason; state: string; outcome: string | null; label: string | null; created_at: string }>(sql`
    SELECT id, number::int AS number, reason, state, outcome, snapshot->>'label' AS label, created_at::text FROM moderation_cases WHERE subject_id = ${p.id} ORDER BY created_at DESC LIMIT 50`);
  const appeals = await db.execute<{ number: number; state: string; created_at: string }>(sql`
    SELECT c.number::int AS number, a.state, a.created_at::text FROM moderation_appeals a JOIN moderation_cases c ON c.id = a.case_id WHERE a.subject_id = ${p.id} ORDER BY a.created_at DESC LIMIT 20`);
  const reported = await db.execute<{ reason: ReportReason; status: string; created_at: string; number: number | null }>(sql`
    SELECT r.reason, r.status, r.created_at::text, c.number::int AS number FROM content_reports r LEFT JOIN moderation_cases c ON c.id = r.case_id
    WHERE r.reporter_id = ${p.id} ORDER BY r.created_at DESC LIMIT 10`);
  const [accuracy] = await db.execute<{ total: number; actioned: number }>(sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'actioned')::int AS actioned FROM content_reports WHERE reporter_id = ${p.id}`);
  const owned = await db.execute<{ id: string; title: string; slug: string | null; kind: string }>(sql`
    SELECT id, title, slug, kind FROM workspaces WHERE owner_id = ${p.id} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`);
  return { ...summary!, actions: [...actions], cases: [...cases], appeals: [...appeals], reported: [...reported], accuracy: accuracy ?? { total: 0, actioned: 0 }, owned: [...owned] };
}

/** Audit log tab (17.11). */
export async function readAudit(f: { staff?: string; kind?: string; from?: string; to?: string; limit?: number } = {}) {
  const rows = await db.execute<{ id: string; created_at: string; staff: string | null; kind: string; case_number: number | null; data: Record<string, unknown> }>(sql`
    SELECT e.id, e.created_at::text, coalesce(p.full_name, p.username) AS staff, e.kind, c.number::int AS case_number, e.data
    FROM moderation_events e LEFT JOIN profiles p ON p.id = e.actor_id LEFT JOIN moderation_cases c ON c.id = e.case_id
    WHERE e.actor_id IS NOT NULL
      ${f.staff ? sql`AND e.actor_id = ${f.staff}` : sql``} ${f.kind ? sql`AND e.kind = ${f.kind}` : sql``}
      ${f.from ? sql`AND e.created_at >= ${f.from}::date` : sql``} ${f.to ? sql`AND e.created_at < ${f.to}::date + 1` : sql``}
    ORDER BY e.created_at DESC LIMIT ${f.limit ?? 300}`);
  return [...rows];
}

/** Verification tab (17.9). */
export async function readVerification() {
  const rows = await db.execute<{ id: string; title: string; slug: string | null; links: unknown; requested_at: string; owner_email: string | null }>(sql`
    SELECT w.id, w.title, w.slug, w.external_links AS links, w.verification_requested_at::text AS requested_at, p.email AS owner_email
    FROM workspaces w LEFT JOIN profiles p ON p.id = w.owner_id
    WHERE w.kind = 'organization' AND w.verification_requested_at IS NOT NULL AND w.verified_at IS NULL AND w.deleted_at IS NULL
    ORDER BY w.verification_requested_at`);
  return [...rows];
}
