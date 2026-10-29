import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { queueEmails, wakeEmailWorker } from "@/lib/email/outbox";
import { logModerationEvent } from "@/lib/trust/cases";
import { consoleCounts, readHealth } from "@/lib/trust/console";
import { deliverDecisionNotices, noticeRestrictionEnded } from "@/lib/trust/decide";
import { dailySummaryEmail, endsTomorrowNotice, urgentStaffEmail, weeklyHealthEmail } from "@/lib/trust/messages";
import { notifySafety } from "@/lib/trust/notify";
import { caseLabel, KIND_NOUN, REPORT_REASON_LABEL, type ReportReason, type ReportTargetKind } from "@/lib/trust/rules";
import { listStaff } from "@/lib/trust/staff";
import type { TrustEmailData } from "@/lib/email/trust-templates";

// The trust and safety background jobs (docs/trust-and-safety-concept.md §15). Each is safe to run twice.

async function emailStaff(eventId: string, data: TrustEmailData) {
  const staff = await listStaff();
  await queueEmails(db, staff.map((s) => ({ kind: "trust_staff" as const, eventId, userId: s.id, data: data as unknown as Record<string, unknown> })));
  await wakeEmailWorker();
  return staff.length;
}

/** trust-urgent-alert: the first email, or the 30-minute reminder while nobody has claimed it. */
export async function alertUrgentCase(caseId: string, reminder: boolean) {
  const [c] = await db.execute<{ number: number; reason: ReportReason; target_kind: ReportTargetKind; claimed: boolean; open: boolean }>(sql`
    SELECT number::int AS number, reason, target_kind, assignee_id IS NOT NULL AS claimed, state IN ('open', 'in_review') AS open FROM moderation_cases WHERE id = ${caseId}`);
  if (!c || !c.open || (reminder && c.claimed)) return 0;
  return emailStaff(`urgent:${caseId}:${reminder ? "reminder" : "first"}`, urgentStaffEmail(c.number, REPORT_REASON_LABEL[c.reason], KIND_NOUN[c.target_kind], reminder));
}

/**
 * trust-deadlines (every 15 minutes): late notices, org hand-off at the org deadline, claim release after 2 hours
 * (15 minutes for urgent, F20), and restrictions paused while their appeal is 7 days overdue (11.3).
 */
export async function runTrustDeadlines() {
  await deliverDecisionNotices();
  const handed = await db.execute<{ id: string }>(sql`
    UPDATE moderation_cases SET routed_to = 'staff', updated_at = now()
    WHERE routed_to = 'org' AND state IN ('open', 'in_review') AND org_deadline_at < now() RETURNING id`);
  for (const c of handed) await logModerationEvent(db, { caseId: c.id, actorId: null, kind: "handed_to_staff" });
  const released = await db.execute<{ id: string }>(sql`
    UPDATE moderation_cases SET assignee_id = NULL, claimed_at = NULL, state = 'open', updated_at = now()
    WHERE state = 'in_review' AND claimed_at < now() - CASE WHEN severity = 'urgent' THEN interval '15 minutes' ELSE interval '2 hours' END RETURNING id`);
  for (const c of released) await logModerationEvent(db, { caseId: c.id, actorId: null, kind: "claim_released" });
  const paused = await db.execute<{ case_id: string }>(sql`
    UPDATE moderation_actions a SET paused_at = now() FROM moderation_appeals ap
    WHERE ap.case_id = a.case_id AND ap.state IN ('pending', 'in_review') AND ap.deadline_at < now() - interval '7 days'
      AND a.action IN ('limit', 'suspension') AND a.paused_at IS NULL AND a.lifted_at IS NULL AND a.reversed_at IS NULL AND a.undone_at IS NULL
    RETURNING a.case_id`);
  for (const c of paused) await logModerationEvent(db, { caseId: c.case_id, actorId: null, kind: "paused_for_appeal" });
  return { handed: handed.length, released: released.length, paused: paused.length };
}

/** trust-restrictions (hourly): M4 a day before a limit or suspension ends, M5 once it has. */
export async function runTrustRestrictions() {
  const soon = await db.execute<{ id: string; subject_id: string; action: "limit" | "suspension"; ends_at: string }>(sql`
    SELECT id, subject_id, action, ends_at::text FROM moderation_actions
    WHERE action IN ('limit', 'suspension') AND ends_at BETWEEN now() + interval '23 hours' AND now() + interval '25 hours'
      AND lifted_at IS NULL AND reversed_at IS NULL AND undone_at IS NULL AND paused_at IS NULL AND subject_id IS NOT NULL`);
  for (const a of soon) {
    const n = endsTomorrowNotice(a.action, new Date(a.ends_at));
    await notifySafety({ to: a.subject_id, title: n.title, body: n.body, dedupeKey: `ends-soon:${a.id}` });
    if (n.email) await queueEmails(db, [{ kind: "trust_person", eventId: `ends-soon:${a.id}`, userId: a.subject_id, data: n.email as unknown as Record<string, unknown> }]);
  }
  const ended = await db.execute<{ id: string; subject_id: string }>(sql`
    SELECT id, subject_id FROM moderation_actions
    WHERE action IN ('limit', 'suspension') AND ends_at BETWEEN now() - interval '3 hours' AND now()
      AND lifted_at IS NULL AND reversed_at IS NULL AND undone_at IS NULL AND subject_id IS NOT NULL`);
  for (const a of ended) await noticeRestrictionEnded(a.subject_id, a.id);
  if (soon.length) await wakeEmailWorker();
  return { soon: soon.length, ended: ended.length };
}

/** Email delivery health for the "Background checks" line (F24). */
async function jobHealth() {
  const [row] = await db.execute<{ failed: number; stuck: number }>(sql`
    SELECT count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '24 hours')::int AS failed,
           count(*) FILTER (WHERE status = 'pending' AND due_at < now() - interval '1 hour')::int AS stuck FROM email_outbox`);
  const failedJobs = [...(row?.failed ? [`${row.failed} emails failed`] : []), ...(row?.stuck ? [`${row.stuck} emails waiting over an hour`] : [])];
  return { jobsOk: failedJobs.length === 0, failedJobs };
}

const istHour = (now: Date) => Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
const istDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

/** trust-daily-summary (hourly; sends at 8 am IST, skipped when there's nothing to say). */
export async function runTrustDailySummary(now = new Date()) {
  if (istHour(now) !== 8) return 0;
  const counts = await consoleCounts();
  const health = await jobHealth();
  if (!counts.open && !counts.appeals && health.jobsOk) return 0;
  const overdue = await db.execute<{ number: number; reason: ReportReason; label: string | null }>(sql`
    SELECT number::int AS number, reason, snapshot->>'label' AS label FROM moderation_cases
    WHERE state IN ('open', 'in_review') AND deadline_at < now() AND merged_into IS NULL ORDER BY deadline_at LIMIT 10`);
  const rows = [...overdue].map((c) => ({ label: `${caseLabel(c.number)} overdue`, detail: `${REPORT_REASON_LABEL[c.reason]}${c.label ? ` · ${c.label}` : ""}` }));
  return emailStaff(`daily:${istDay(now)}`, dailySummaryEmail(rows, { ...counts, ...health }));
}

/** trust-weekly-health (Mondays 8 am IST). */
export async function runTrustWeeklyHealth(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Kolkata" }).format(now);
  if (weekday !== "Mon" || istHour(now) !== 8) return 0;
  const h = await readHealth(7);
  const lines = [
    `${h.newCases} new cases, ${h.decided} decided`,
    `Median time to decision: ${h.medianHours.urgent ?? "—"} h urgent, ${h.medianHours.high ?? "—"} h high, ${h.medianHours.normal ?? "—"} h normal`,
    `Appeals: ${h.appealRate ?? "—"}% of decisions appealed, ${h.reversalRate ?? "—"}% reversed`,
    `${h.repeatOffenders} people with 3+ active strikes · ${h.pileOns} pile-on flags`,
  ];
  return emailStaff(`weekly:${istDay(now)}`, weeklyHealthEmail(lines));
}

/**
 * trust-retention (daily): dismissed reports and their evidence after 90 days, actioned ones after 2 years, never
 * under Legal hold; removed docs' saved copies once the appeal window has closed.
 */
export async function runTrustRetention() {
  const reports = await db.execute(sql`
    UPDATE content_reports r SET snapshot = NULL, details = NULL FROM moderation_cases c
    WHERE c.id = r.case_id AND NOT c.legal_hold AND (r.snapshot IS NOT NULL OR r.details IS NOT NULL)
      AND ((r.status = 'dismissed' AND r.resolved_at < now() - interval '90 days') OR (r.status = 'actioned' AND r.resolved_at < now() - interval '2 years'))`);
  const cases = await db.execute(sql`
    UPDATE moderation_cases SET snapshot = jsonb_build_object('label', snapshot->'label'), details = NULL
    WHERE NOT legal_hold AND snapshot ? 'label' AND (SELECT count(*) FROM jsonb_object_keys(snapshot)) > 1
      AND ((outcome IN ('no_violation', 'duplicate') AND decided_at < now() - interval '90 days') OR (outcome = 'actioned' AND decided_at < now() - interval '2 years'))`);
  const copies = await db.execute(sql`
    UPDATE moderation_actions a SET restore = '{}'::jsonb FROM moderation_cases c
    WHERE c.id = a.case_id AND NOT c.legal_hold AND a.action = 'remove' AND a.restore ? 'row' AND a.appeal_until < now()
      AND NOT EXISTS (SELECT 1 FROM moderation_appeals ap WHERE ap.case_id = a.case_id AND ap.state IN ('pending', 'in_review'))`);
  return { reports: reports.count ?? 0, cases: cases.count ?? 0, copies: copies.count ?? 0 };
}
