import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { contentReports, moderationCases, moderationEvents } from "@/lib/db/schema";
import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";
import { notifySafety } from "@/lib/trust/notify";
import {
  caseLabel, deadlinesFor, HIDEABLE_KINDS, HIDE_ON_FIRST_REPORT, HIDE_ON_TWO_REPORTS, higherSeverity, KIND_NOUN, REASON_RULES, reasonsFor,
  STAFF_ONLY_REASONS, SUPPORT_FIRST, type ReportReason, type ReportTargetKind, type Severity,
} from "@/lib/trust/rules";
import { canSoftHide, resolveReportTarget, setContentHidden, type ReportTarget } from "@/lib/trust/targets";

// Reports become cases (docs/trust-and-safety-concept.md §6): one open case per thing, the highest severity wins,
// org content goes to org moderators first with half the deadline (F5), and Urgent goes straight to staff.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const ORG_ROUTABLE: ReportTargetKind[] = ["update", "update_comment", "doc", "task", "task_comment", "file", "chat_message", "chat_channel"];

export async function logModerationEvent(executor: Executor, input: { caseId: string | null; actorId: string | null; kind: string; data?: Record<string, unknown> }) {
  await executor.insert(moderationEvents).values({ caseId: input.caseId, actorId: input.actorId, kind: input.kind, data: input.data ?? {} });
}

/** Whether the person responsible is the org's owner or an admin: then the org can't judge it (T6). */
async function isOrgLeader(executor: Executor, orgId: string, userId: string | null) {
  if (!userId) return false;
  const [row] = await executor.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ${orgId} AND w.owner_id = ${userId})
        OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${orgId} AND m.user_id = ${userId} AND m.role IN ('owner', 'admin')) AS ok`);
  return Boolean(row?.ok);
}

async function routeTo(executor: Executor, target: ReportTarget, severity: Severity, reason: ReportReason): Promise<{ routedTo: "org" | "staff"; orgId: string | null }> {
  if (!target.orgId || target.privateConversation || severity === "urgent" || STAFF_ONLY_REASONS.includes(reason) || !ORG_ROUTABLE.includes(target.kind)) return { routedTo: "staff", orgId: target.orgId };
  if (!(await isOrgLeader(executor, target.orgId, target.subjectId))) return { routedTo: "org", orgId: target.orgId };
  // B5.5d: about a chapter's organiser → filed on its community (its organisers judge it), unless they lead there too.
  const [ch] = await executor.execute<{ parent: string | null }>(sql`
    SELECT p.id AS parent FROM workspaces w JOIN workspaces p ON p.id::text = w.org_settings->>'chapterOf' AND p.deleted_at IS NULL WHERE w.id = ${target.orgId}`);
  return ch?.parent && !(await isOrgLeader(executor, ch.parent, target.subjectId)) ? { routedTo: "org", orgId: ch.parent } : { routedTo: "staff", orgId: target.orgId };
}

/** Two reporters count as independent when neither account is under 7 days old and they aren't connected (T10). */
async function independentReporters(executor: Executor, caseId: string) {
  const [row] = await executor.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT r.reporter_id FROM content_reports r JOIN profiles p ON p.id = r.reporter_id
      WHERE r.case_id = ${caseId} AND p.created_at < now() - interval '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM content_reports o JOIN connections k ON k.status = 'accepted'
            AND ((k.requester_id = r.reporter_id AND k.addressee_id = o.reporter_id) OR (k.addressee_id = r.reporter_id AND k.requester_id = o.reporter_id))
          WHERE o.case_id = ${caseId} AND o.reporter_id <> r.reporter_id)
    ) x`);
  return row?.n ?? 0;
}

/** 5+ reports within an hour, mostly from new or connected accounts (§6.7). */
async function looksLikePileOn(executor: Executor, caseId: string) {
  const [row] = await executor.execute<{ recent: number; suspect: number }>(sql`
    SELECT count(*)::int AS recent,
           count(*) FILTER (WHERE p.created_at > now() - interval '7 days' OR EXISTS (
             SELECT 1 FROM content_reports o JOIN connections k ON k.status = 'accepted'
               AND ((k.requester_id = r.reporter_id AND k.addressee_id = o.reporter_id) OR (k.addressee_id = r.reporter_id AND k.requester_id = o.reporter_id))
             WHERE o.case_id = r.case_id AND o.reporter_id <> r.reporter_id))::int AS suspect
    FROM content_reports r JOIN profiles p ON p.id = r.reporter_id
    WHERE r.case_id = ${caseId} AND r.created_at > now() - interval '1 hour'`);
  return (row?.recent ?? 0) >= 5 && (row?.suspect ?? 0) * 2 > (row?.recent ?? 0);
}

export type FileReportResult =
  | { ok: true; caseNumber: number; severity: Severity; deadlineHours: number }
  | { ok: false; error: string; caseNumber?: number };

/**
 * Files one report from a signed-in person. The caller has already rate-limited them; this checks the thing is
 * theirs to report, freezes the evidence, and opens or joins the case.
 */
export async function fileReport(reporterId: string, input: { kind: ReportTargetKind; targetId: string; seq?: number | null; reason: ReportReason; details?: string | null; alsoBlock?: boolean; joinCode?: string | null }): Promise<FileReportResult> {
  if (!reasonsFor(input.kind).includes(input.reason)) return { ok: false, error: "Pick one of the reasons shown." };
  // On the join page the code is what lets someone see an org they aren't in yet, so it counts as visibility.
  const [viaCode] = input.kind === "project" && input.joinCode ? await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = ${input.targetId} AND join_code = ${input.joinCode} AND join_code_enabled AND deleted_at IS NULL) AS ok`) : [];
  const target = await resolveReportTarget(input.kind, input.targetId, input.seq ?? null, viaCode?.ok ? null : reporterId);
  if (!target) return { ok: false, error: "That is no longer available." };
  if (target.subjectId === reporterId) return { ok: false, error: "You can’t report your own " + KIND_NOUN[input.kind] + ". You can edit or delete it." };

  const rule = REASON_RULES[input.reason];
  const seqKey = target.seq ?? 0;
  // Two first reports on the same thing at the same moment both try to open its case; the open-case index lets one
  // win, and the other runs once more and joins it.
  const attempt = () => db.transaction(async (tx): Promise<FileReportResult & { caseId?: string; hide?: boolean; selfHarmFirst?: boolean; urgent?: boolean }> => {
    // Already reported by you and still open.
    const [mine] = await tx.execute<{ number: number }>(sql`
      SELECT c.number::int AS number FROM content_reports r JOIN moderation_cases c ON c.id = r.case_id
      WHERE r.reporter_id = ${reporterId} AND r.target_kind = ${input.kind} AND r.target_id = ${input.targetId}
        AND coalesce(r.target_seq, 0) = ${seqKey} AND r.status = 'open'`);
    if (mine) return { ok: false, error: `You’ve already reported this. Case ${caseLabel(mine.number)} is in review.`, caseNumber: mine.number };
    // Reported again after "No rule broken": only with something new to say (§19.5).
    const [reviewed] = await tx.execute<{ number: number }>(sql`
      SELECT c.number::int AS number FROM content_reports r JOIN moderation_cases c ON c.id = r.case_id
      WHERE r.reporter_id = ${reporterId} AND r.target_kind = ${input.kind} AND r.target_id = ${input.targetId}
        AND coalesce(r.target_seq, 0) = ${seqKey} AND c.outcome = 'no_violation' ORDER BY c.decided_at DESC LIMIT 1`);
    if (reviewed && !input.details?.trim()) return { ok: false, error: `We already reviewed this (${caseLabel(reviewed.number)}). Add details if something is new.` };

    const now = new Date();
    const [open] = await tx.execute<{ id: string; number: number; severity: Severity; reason: ReportReason; routed_to: "org" | "staff"; created_at: string; auto_hidden_at: string | null }>(sql`
      SELECT id, number::int AS number, severity, reason, routed_to, created_at::text, auto_hidden_at::text FROM moderation_cases
      WHERE target_kind = ${input.kind} AND target_id = ${input.targetId} AND coalesce(target_seq, 0) = ${seqKey} AND state IN ('open', 'in_review')
      FOR UPDATE`);
    let caseId: string;
    let caseNumber: number;
    let severity: Severity;
    let selfHarmFirst = false;
    if (open) {
      severity = higherSeverity(open.severity, rule.severity);
      const routedTo = severity === "urgent" || STAFF_ONLY_REASONS.includes(input.reason) ? "staff" : open.routed_to;
      const { deadlineAt, orgDeadlineAt } = deadlinesFor(severity, new Date(open.created_at), routedTo === "org");
      await tx.update(moderationCases).set({
        severity, reason: severity === open.severity ? open.reason : input.reason, routedTo,
        deadlineAt: sql`LEAST(${moderationCases.deadlineAt}, ${deadlineAt.toISOString()}::timestamptz)`,
        orgDeadlineAt: routedTo === "org" ? orgDeadlineAt : null, updatedAt: now,
      }).where(eq(moderationCases.id, open.id));
      caseId = open.id;
      caseNumber = open.number;
      if (severity !== open.severity) await logModerationEvent(tx, { caseId, actorId: null, kind: "severity_raised", data: { from: open.severity, to: severity, reason: input.reason } });
    } else {
      severity = rule.severity;
      const { routedTo, orgId: caseOrgId } = await routeTo(tx, target, severity, input.reason);
      const { deadlineAt, orgDeadlineAt } = deadlinesFor(severity, now, routedTo === "org");
      const [created] = await tx.insert(moderationCases).values({
        targetKind: input.kind, targetId: input.targetId, targetSeq: target.seq, workspaceId: target.workspaceId, orgId: caseOrgId,
        subjectId: target.subjectId, severity, reason: input.reason, routedTo, deadlineAt, orgDeadlineAt,
        snapshot: { ...target.snapshot, label: target.label, href: target.href, privateConversation: target.privateConversation },
      }).returning({ id: moderationCases.id, number: moderationCases.number });
      caseId = created!.id;
      caseNumber = created!.number;
      selfHarmFirst = SUPPORT_FIRST.includes(input.reason);
      await logModerationEvent(tx, { caseId, actorId: null, kind: "opened", data: { severity, routedTo, reason: input.reason } });
    }

    await tx.insert(contentReports).values({
      reporterId, targetKind: input.kind, targetId: input.targetId, targetSeq: target.seq, projectId: target.workspaceId, reason: input.reason,
      details: input.details?.trim() || null, caseId, snapshot: target.snapshot, alsoBlocked: Boolean(input.alsoBlock),
    });
    await logModerationEvent(tx, { caseId, actorId: null, kind: "report_added", data: { reason: input.reason } });

    if (await looksLikePileOn(tx, caseId)) await tx.update(moderationCases).set({ pileOn: true }).where(eq(moderationCases.id, caseId));

    // Hidden while we review (F10, T10): the worst kinds on the first report; threats after two independent reporters.
    let hide = false;
    const hideable = HIDEABLE_KINDS.includes(input.kind) && canSoftHide(input.kind) && !open?.auto_hidden_at;
    if (hideable && HIDE_ON_FIRST_REPORT.includes(input.reason)) hide = true;
    else if (hideable && HIDE_ON_TWO_REPORTS.includes(input.reason) && (await independentReporters(tx, caseId)) >= 2) hide = true;
    if (hide) {
      await setContentHidden(input.kind, input.targetId, target.seq, true, tx);
      await tx.update(moderationCases).set({ autoHiddenAt: now }).where(eq(moderationCases.id, caseId));
      await logModerationEvent(tx, { caseId, actorId: null, kind: "auto_hidden", data: { reason: input.reason } });
    }
    return { ok: true, caseNumber, severity, deadlineHours: severity === "urgent" ? 1 : severity === "high" ? 24 : 72, caseId, hide, selfHarmFirst, urgent: severity === "urgent" };
  });
  const result = await attempt().catch((error: unknown) => {
    const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return attempt();
    throw error;
  });

  if (!result.ok) return result;
  const noun = KIND_NOUN[input.kind];
  if (result.hide && target.subjectId) {
    await notifySafety({ to: target.subjectId, title: `Your ${noun} is hidden while we review it`, body: `We’ll decide within 1 hour. ${caseLabel(result.caseNumber)}.`, dedupeKey: `hidden:${result.caseId}` });
  }
  // Self-harm is support first (F9): a gentle notice at once, no penalty.
  if (result.selfHarmFirst && target.subjectId) {
    await notifySafety({
      to: target.subjectId, title: "Someone who cares about you asked us to check in",
      body: "If you’re going through something hard, you can talk to someone now: Tele-MANAS 14416 or KIRAN 1800-599-0019 (free, any time).",
      href: "/acceptable-use#rule-11", dedupeKey: `support:${result.caseId}`,
    });
  }
  if (result.urgent && result.caseId) {
    await inngest.send({ name: "trust/urgent.reported", data: { caseId: result.caseId } }).catch((error) => {
      logger.error("trust.urgent_alert_send_failed", { module: "trust", error: error instanceof Error ? error.message : String(error) });
    });
  }
  return { ok: true, caseNumber: result.caseNumber, severity: result.severity, deadlineHours: result.deadlineHours };
}

/** Your reports (T5, C18): the last 90 days, without anything about the other person. */
export async function listMyReports(reporterId: string) {
  const rows = await db.execute<{ number: number; kind: ReportTargetKind; reason: ReportReason; created_at: string; state: string; outcome: string | null; label: string | null }>(sql`
    SELECT c.number::int AS number, r.target_kind AS kind, r.reason, r.created_at::text, c.state, c.outcome, c.snapshot->>'label' AS label
    FROM content_reports r JOIN moderation_cases c ON c.id = r.case_id
    WHERE r.reporter_id = ${reporterId} AND r.created_at > now() - interval '90 days'
    ORDER BY r.created_at DESC LIMIT 100`);
  return [...rows].map((r) => ({
    caseNumber: r.number, kind: r.kind, reason: r.reason, createdAt: r.created_at,
    status: r.state === "open" || r.state === "in_review" ? ("in_review" as const) : r.outcome === "no_violation" ? ("no_violation" as const) : ("actioned" as const),
  }));
}

/** Everything this person reported that is still in review: drives "Reported · in review" (C16). */
export async function openReportsOf(reporterId: string) {
  const rows = await db.execute<{ kind: ReportTargetKind; target_id: string; target_seq: number | null; number: number }>(sql`
    SELECT r.target_kind AS kind, r.target_id, r.target_seq::int AS target_seq, c.number::int AS number
    FROM content_reports r JOIN moderation_cases c ON c.id = r.case_id
    WHERE r.reporter_id = ${reporterId} AND r.status = 'open' AND c.state IN ('open', 'in_review')
    ORDER BY r.created_at DESC LIMIT 500`);
  return [...rows].map((r) => ({ kind: r.kind, targetId: r.target_id, seq: r.target_seq, caseNumber: r.number }));
}
