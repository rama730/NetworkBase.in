import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { moderationCases, workspaces } from "@/lib/db/schema";
import { logModerationEvent } from "@/lib/trust/cases";
import { activeStrikes } from "@/lib/trust/decide";
import { deadlinesFor, REASON_RULES, suggestedStep, type ReportReason, type ReportTargetKind, type Severity } from "@/lib/trust/rules";
import { resolveReportTarget } from "@/lib/trust/targets";

// The staff console's reads and small writes (docs/trust-and-safety-concept.md §17, C1–C14). Decisions live in
// decide.ts and the Inbox, leases and live cursor in inbox.ts; this file is one case, notes, Active, People, the log.

type CaseRow = {
  id: string; number: number; severity: Severity; state: string; outcome: string | null; reason: ReportReason; target_kind: ReportTargetKind;
  label: string | null; reports: number; deadline_at: string | null; created_at: string; routed_to: "org" | "staff"; pile_on: boolean;
  assignee_id: string | null; assignee_name: string | null; source: string;
};

export async function caseIdByNumber(number: number) {
  const [row] = await db.select({ id: moderationCases.id }).from(moderationCases).where(eq(moderationCases.number, number)).limit(1);
  return row?.id ?? null;
}

/** Everything the case view shows (17.4). */
export async function readCase(caseId: string) {
  const [c] = await db.execute<CaseRow & {
    target_id: string; target_seq: number | null; subject_id: string | null; workspace_id: string | null; org_id: string | null; snapshot: Record<string, unknown> | null;
    details: string | null; claimed_at: string | null; legal_hold: boolean; decided_at: string | null; decided_by: string | null; decided_by_name: string | null; merged_into: string | null; auto_hidden_at: string | null;
    workspace_title: string | null; workspace_slug: string | null; workspace_kind: string | null;
    version: number; leased: boolean; assigned_to: string | null; assigned_name: string | null; escalated_at: string | null;
  }>(sql`
    SELECT c.id, c.number::int AS number, c.severity, c.state, c.outcome, c.reason, c.target_kind, c.target_id, c.target_seq::int AS target_seq, c.subject_id,
           c.workspace_id, c.org_id, c.snapshot, c.details, c.snapshot->>'label' AS label, c.deadline_at::text, c.created_at::text, c.routed_to, c.pile_on,
           c.assignee_id, coalesce(a.full_name, a.username) AS assignee_name, c.claimed_at::text, c.legal_hold, c.source, c.decided_at::text, c.decided_by,
           coalesce(d.full_name, d.username) AS decided_by_name, c.merged_into, c.auto_hidden_at::text,
           (SELECT count(*)::int FROM content_reports r WHERE r.case_id = c.id) AS reports, w.title AS workspace_title, w.slug AS workspace_slug, w.kind AS workspace_kind,
           c.version, (c.assignee_id IS NOT NULL AND c.claimed_until > now() AND c.claim_seen_at > now() - interval '2 minutes') AS leased,
           c.assigned_to, coalesce(g.full_name, g.username) AS assigned_name, c.escalated_at::text
    FROM moderation_cases c LEFT JOIN profiles a ON a.id = c.assignee_id LEFT JOIN profiles d ON d.id = c.decided_by LEFT JOIN workspaces w ON w.id = c.workspace_id
      LEFT JOIN profiles g ON g.id = c.assigned_to
    WHERE c.id = ${caseId}`);
  if (!c) return null;

  const reports = await db.execute<{ id: string; reason: ReportReason; details: string | null; created_at: string; reporter_id: string; reporter_name: string | null; actioned: number; decided: number }>(sql`
    SELECT r.id, r.reason, r.details, r.created_at::text, r.reporter_id, coalesce(p.full_name, p.username) AS reporter_name,
           (SELECT count(*)::int FROM content_reports o WHERE o.reporter_id = r.reporter_id AND o.status = 'actioned') AS actioned,
           (SELECT count(*)::int FROM content_reports o WHERE o.reporter_id = r.reporter_id AND o.status IN ('actioned', 'dismissed')) AS decided
    FROM content_reports r LEFT JOIN profiles p ON p.id = r.reporter_id WHERE r.case_id = ${caseId} ORDER BY r.created_at`);
  const events = await db.execute<{ kind: string; created_at: string; actor_name: string | null; data: Record<string, unknown> }>(sql`
    SELECT e.kind, e.created_at::text, coalesce(p.full_name, p.username) AS actor_name, e.data
    FROM moderation_events e LEFT JOIN profiles p ON p.id = e.actor_id WHERE e.case_id = ${caseId} ORDER BY e.seq`);
  const actions = await db.execute<{ id: string; action: string; rule: number | null; message: string | null; ends_at: string | null; appeal_until: string | null; strike: boolean; notified_at: string | null; undone_at: string | null; reversed_at: string | null; lifted_at: string | null; created_at: string }>(sql`
    SELECT id, action, rule, message, ends_at::text, appeal_until::text, strike, notified_at::text, undone_at::text, reversed_at::text, lifted_at::text, created_at::text
    FROM moderation_actions WHERE case_id = ${caseId} ORDER BY created_at`);
  const person = c.subject_id ? await readPersonSummary(c.subject_id) : null;
  const otherCases = c.subject_id ? await db.execute<{ id: string; number: number; reason: ReportReason; target_kind: ReportTargetKind; deadline_at: string | null }>(sql`
    SELECT id, number::int AS number, reason, target_kind, deadline_at::text FROM moderation_cases
    WHERE subject_id = ${c.subject_id} AND id <> ${caseId} AND state IN ('open', 'in_review') AND merged_into IS NULL ORDER BY deadline_at LIMIT 10`) : [];
  // Reported before (S9): earlier decided cases on the same thing or the same person.
  const priorCases = await db.execute<{ id: string; number: number; reason: ReportReason; outcome: string | null; decided_at: string | null; same_target: boolean }>(sql`
    SELECT id, number::int AS number, reason, outcome, decided_at::text, (target_kind = ${c.target_kind} AND target_id = ${c.target_id}) AS same_target
    FROM moderation_cases WHERE id <> ${caseId} AND state IN ('decided', 'closed')
      AND ((target_kind = ${c.target_kind} AND target_id = ${c.target_id}) ${c.subject_id ? sql`OR subject_id = ${c.subject_id}` : sql``})
    ORDER BY decided_at DESC NULLS LAST LIMIT 8`);
  // Merge hints (R10): other open cases about the very same thing.
  const duplicates = await db.execute<{ id: string; number: number; reports: number }>(sql`
    SELECT id, number::int AS number, (SELECT count(*)::int FROM content_reports r WHERE r.case_id = m.id) AS reports FROM moderation_cases m
    WHERE id <> ${caseId} AND target_kind = ${c.target_kind} AND target_id = ${c.target_id} AND state IN ('open', 'in_review') AND merged_into IS NULL LIMIT 5`);
  const live = await resolveReportTarget(c.target_kind, c.target_id, c.target_seq, null).catch(() => null);
  const liveState = !live ? "deleted" : stable(stripMeta(live.snapshot)) === stable(stripMeta(c.snapshot ?? {})) ? "unchanged" : "edited";
  const strikes = c.subject_id ? await activeStrikes(db, c.subject_id) : 0;
  return {
    ...c, reports: [...reports], events: [...events], actions: [...actions], person, otherCases: [...otherCases],
    priorCases: [...priorCases], duplicates: [...duplicates], live: live ? live.snapshot : null, liveState: liveState as "deleted" | "unchanged" | "edited", strikes, suggested: suggestedStep(strikes),
  };
}
/** jsonb stores keys in its own order, so compare with sorted keys. */
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(value ?? null);
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
    case_number: number | null; what: string | null; appeal_state: string | null; workspace_kind: string | null }>(sql`
    SELECT a.id, a.action, a.target_kind, a.target_id, a.subject_id, a.created_at::text, a.ends_at::text, c.number::int AS case_number, w.kind AS workspace_kind,
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
/** The Audit log (17.11), 50 entries a page, newest first; `before` is the last seq shown (S7, G15). */
export async function readAudit(f: { kind?: string; from?: string; to?: string; staff?: string; before?: number } = {}) {
  const rows = await db.execute<{ id: string; seq: number; created_at: string; staff: string | null; kind: string; case_number: number | null; data: Record<string, unknown> }>(sql`
    SELECT e.id, e.seq::float8 AS seq, e.created_at::text, coalesce(p.full_name, p.username) AS staff, e.kind, c.number::int AS case_number, e.data
    FROM moderation_events e LEFT JOIN profiles p ON p.id = e.actor_id LEFT JOIN moderation_cases c ON c.id = e.case_id
    WHERE e.actor_id IS NOT NULL
      ${f.kind ? sql`AND e.kind = ${f.kind}` : sql``}
      ${f.from ? sql`AND e.created_at >= ${f.from}::date` : sql``} ${f.to ? sql`AND e.created_at < ${f.to}::date + 1` : sql``}
      ${f.staff ? sql`AND e.actor_id = ${f.staff}` : sql``} ${f.before ? sql`AND e.seq < ${f.before}` : sql``}
    ORDER BY e.seq DESC LIMIT 51`);
  const list = [...rows].map((r) => ({ ...r, seq: Number(r.seq) }));
  return { rows: list.slice(0, 50), before: list.length > 50 ? list[49]!.seq : null };
}

/** Verification tab (17.9). */
export async function readVerification(orgId?: string) {
  const rows = await db.execute<{ id: string; title: string; slug: string | null; links: unknown; requested_at: string; owner_email: string | null }>(sql`
    SELECT w.id, w.title, w.slug, w.external_links AS links, w.verification_requested_at::text AS requested_at, p.email AS owner_email
    FROM workspaces w LEFT JOIN profiles p ON p.id = w.owner_id
    WHERE w.kind = 'organization' AND w.verification_requested_at IS NOT NULL AND w.verified_at IS NULL AND w.deleted_at IS NULL
      ${orgId ? sql`AND w.id = ${orgId}` : sql``}
    ORDER BY w.verification_requested_at`);
  return [...rows];
}

/**
 * Members → Reports for an org's owners and admins (11.6): their open cases, never reporters' names, urgent cases,
 * DMs or anything about the viewer.
 */
export async function readOrgCases(orgId: string, viewerId: string) {
  const rows = await db.execute<{ id: string; number: number; reason: ReportReason; target_kind: ReportTargetKind; label: string | null; href: string | null; reports: number; org_deadline_at: string | null; created_at: string; details: string | null; content: string | null }>(sql`
    SELECT c.id, c.number::int AS number, c.reason, c.target_kind, c.snapshot->>'label' AS label, c.snapshot->>'href' AS href, c.org_deadline_at::text, c.created_at::text,
           (SELECT count(*)::int FROM content_reports r WHERE r.case_id = c.id) AS reports,
           (SELECT string_agg(r.details, ' · ') FROM content_reports r WHERE r.case_id = c.id AND r.details IS NOT NULL) AS details,
           coalesce(c.snapshot->>'content', c.snapshot->>'message', c.snapshot->>'description') AS content
    FROM moderation_cases c
    WHERE c.org_id = ${orgId} AND c.routed_to = 'org' AND c.state IN ('open', 'in_review') AND c.severity <> 'urgent'
      AND coalesce((c.snapshot->>'privateConversation')::boolean, false) = false AND c.subject_id IS DISTINCT FROM ${viewerId} AND c.merged_into IS NULL
    ORDER BY c.org_deadline_at NULLS LAST LIMIT 100`);
  return [...rows];
}

/** Health tab and the weekly email (17.10, 11.4). Missing numbers are null, shown as "—". */
export async function readHealth(days: number) {
  const since = sql`now() - make_interval(days => ${days})`;
  const [m] = await db.execute<{ new_cases: number; decided: number; urgent_h: number | null; high_h: number | null; normal_h: number | null; actioned: number; appealed: number;
    appeals_decided: number; reversed: number; pile_ons: number; repeat_offenders: number; stale_refused: number }>(sql`
    SELECT (SELECT count(*)::int FROM moderation_cases WHERE created_at > ${since}) AS new_cases,
           (SELECT count(*)::int FROM moderation_cases WHERE decided_at > ${since}) AS decided,
           ${median("urgent", since)} AS urgent_h, ${median("high", since)} AS high_h, ${median("normal", since)} AS normal_h,
           (SELECT count(*)::int FROM moderation_cases WHERE decided_at > ${since} AND outcome = 'actioned') AS actioned,
           (SELECT count(*)::int FROM moderation_appeals WHERE created_at > ${since}) AS appealed,
           (SELECT count(*)::int FROM moderation_appeals WHERE decided_at > ${since} AND state IN ('upheld', 'reduced', 'reversed')) AS appeals_decided,
           (SELECT count(*)::int FROM moderation_appeals WHERE decided_at > ${since} AND state = 'reversed') AS reversed,
           (SELECT count(*)::int FROM moderation_cases WHERE created_at > ${since} AND pile_on) AS pile_ons,
           (SELECT count(*)::int FROM moderation_events WHERE kind = 'stale_refused' AND created_at > ${since}) AS stale_refused,
           (SELECT count(*)::int FROM (SELECT subject_id FROM moderation_actions WHERE strike AND strike_expires_at > now() AND undone_at IS NULL AND reversed_at IS NULL
              GROUP BY subject_id HAVING count(DISTINCT case_id) >= 3) s) AS repeat_offenders`);
  const perDay = await db.execute<{ day: string; urgent: number; high: number; normal: number }>(sql`
    SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE severity = 'urgent')::int AS urgent, count(*) FILTER (WHERE severity = 'high')::int AS high, count(*) FILTER (WHERE severity = 'normal')::int AS normal
    FROM moderation_cases WHERE created_at > ${since} GROUP BY 1 ORDER BY 1`);
  const actions = await db.execute<{ action: string; n: number }>(sql`
    SELECT action, count(*)::int AS n FROM moderation_actions WHERE created_at > ${since} AND undone_at IS NULL GROUP BY action ORDER BY n DESC`);
  const reasons = await db.execute<{ reason: ReportReason; n: number }>(sql`
    SELECT reason, count(*)::int AS n FROM content_reports WHERE created_at > ${since} GROUP BY reason ORDER BY n DESC LIMIT 8`);
  const places = await db.execute<{ id: string; title: string; slug: string | null; kind: string; n: number }>(sql`
    SELECT w.id, w.title, w.slug, w.kind, count(*)::int AS n FROM content_reports r JOIN moderation_cases c ON c.id = r.case_id JOIN workspaces w ON w.id = c.workspace_id
    WHERE r.created_at > ${since} GROUP BY w.id ORDER BY n DESC LIMIT 8`);
  const reporters = await db.execute<{ id: string; name: string | null; username: string | null; decided: number; actioned: number }>(sql`
    SELECT p.id, p.full_name AS name, p.username, count(*)::int AS decided, count(*) FILTER (WHERE r.status = 'actioned')::int AS actioned
    FROM content_reports r JOIN profiles p ON p.id = r.reporter_id WHERE r.status IN ('actioned', 'dismissed') AND r.created_at > now() - interval '90 days'
    GROUP BY p.id HAVING count(*) >= 5 AND count(*) FILTER (WHERE r.status = 'actioned') * 10 < count(*) * 3 ORDER BY decided DESC LIMIT 10`);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    newCases: m?.new_cases ?? 0, decided: m?.decided ?? 0, pileOns: m?.pile_ons ?? 0, repeatOffenders: m?.repeat_offenders ?? 0, staleRefused: m?.stale_refused ?? 0,
    medianHours: { urgent: m?.urgent_h ?? null, high: m?.high_h ?? null, normal: m?.normal_h ?? null },
    appealRate: pct(m?.appealed ?? 0, m?.actioned ?? 0), reversalRate: pct(m?.reversed ?? 0, m?.appeals_decided ?? 0),
    perDay: [...perDay], actions: [...actions], reasons: [...reasons], places: [...places], reporters: [...reporters],
  };
}
function median(severity: Severity, since: ReturnType<typeof sql>) {
  return sql`(SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM decided_at - created_at)) / 3600)::numeric, 1)::float
    FROM moderation_cases WHERE severity = ${severity} AND decided_at > ${since})`;
}
