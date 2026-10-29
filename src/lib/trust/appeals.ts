import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { moderationActions, moderationAppeals } from "@/lib/db/schema";
import { queueEmail, wakeEmailWorker } from "@/lib/email/outbox";
import { logModerationEvent } from "@/lib/trust/cases";
import { reverseAction } from "@/lib/trust/decide";
import { appealDecidedNotice, appealReceivedNotice } from "@/lib/trust/messages";
import { notifySafety } from "@/lib/trust/notify";
import { APPEAL_DECIDE_HOURS, caseLabel, type ModerationActionKind } from "@/lib/trust/rules";
import { listStaff } from "@/lib/trust/staff";

// Appeals (docs/trust-and-safety-concept.md §10, T11, T21, T22): one per decision, decided within 72 hours by
// someone else where possible. Upheld keeps it; Reduced swaps in a lighter step (the strike stays); Reversed
// undoes everything and removes the strike.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
type ActionRow = { id: string; action: ModerationActionKind; ends_at: string | null; appeal_until: string | null; target_id: string | null; created_at: string };

async function caseForPerson(userId: string, number: number) {
  const [c] = await db.execute<{ id: string; number: number; subject_id: string | null; outcome: string | null; reason: string; appeal_state: string | null; appeal_until: string | null }>(sql`
    SELECT c.id, c.number::int AS number, c.subject_id, c.outcome, c.reason, ap.state AS appeal_state,
           (SELECT max(a.appeal_until)::text FROM moderation_actions a WHERE a.case_id = c.id AND a.undone_at IS NULL AND a.reversed_at IS NULL) AS appeal_until
    FROM moderation_cases c LEFT JOIN moderation_appeals ap ON ap.case_id = c.id WHERE c.number = ${number}`);
  return c && c.subject_id === userId ? c : null;
}

/** What the appeal form shows, or why it can't be sent. */
export async function appealContext(userId: string, number: number) {
  const c = await caseForPerson(userId, number);
  if (!c || c.outcome !== "actioned") return null;
  const actions = await db.execute<ActionRow & { rule: number | null; label: string | null }>(sql`
    SELECT a.id, a.action, a.ends_at::text, a.appeal_until::text, a.target_id, a.created_at::text, a.rule, mc.snapshot->>'label' AS label
    FROM moderation_actions a JOIN moderation_cases mc ON mc.id = a.case_id WHERE a.case_id = ${c.id} AND a.undone_at IS NULL ORDER BY a.created_at`);
  const status = c.appeal_state ? "sent" : !c.appeal_until ? "not_appealable" : new Date(c.appeal_until) < new Date() ? "closed" : "open";
  return { caseId: c.id, number: c.number, status: status as "open" | "sent" | "closed" | "not_appealable", appealState: c.appeal_state, appealUntil: c.appeal_until, actions: [...actions],
    workspaceAction: [...actions].some((a) => ["restrict", "suspend_workspace", "remove_workspace", "hide_discover", "remove_verified"].includes(a.action)) };
}

export async function fileAppeal(userId: string, number: number, body: string, fixed: boolean): Promise<Result<{ decideBy: Date }>> {
  const ctx = await appealContext(userId, number);
  if (!ctx) return { ok: false, error: "There's no decision to appeal." };
  if (ctx.status === "sent") return { ok: false, error: `You already appealed ${caseLabel(number)}.` };
  if (ctx.status === "not_appealable") return { ok: false, error: "This decision can't be appealed." };
  if (ctx.status === "closed") return { ok: false, error: "The appeal window has closed. Questions? Email support@networkbase.in." };
  const text = body.trim();
  if (!text || text.length > 1000) return { ok: false, error: "Tell us why, in up to 1,000 characters." };
  const decideBy = new Date(Date.now() + APPEAL_DECIDE_HOURS * 3_600_000);
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx.insert(moderationAppeals).values({ caseId: ctx.caseId, subjectId: userId, body: text, fixed: ctx.workspaceAction && fixed, deadlineAt: decideBy })
      .onConflictDoNothing().returning({ id: moderationAppeals.id });
    if (!rows.length) return false;
    // A workspace or org is never deleted while its appeal is open (10.4).
    await tx.execute(sql`UPDATE workspaces w SET deletion_scheduled_at = NULL FROM moderation_actions a
      WHERE a.case_id = ${ctx.caseId} AND a.action = 'remove_workspace' AND a.undone_at IS NULL AND a.reversed_at IS NULL
        AND (w.id = a.target_id OR w.id::text IN (SELECT jsonb_array_elements_text(coalesce(a.restore->'children', '[]'::jsonb))))`);
    await logModerationEvent(tx, { caseId: ctx.caseId, actorId: userId, kind: "appealed", data: { fixed } });
    return true;
  });
  if (!inserted) return { ok: false, error: `You already appealed ${caseLabel(number)}.` };
  const notice = appealReceivedNotice(number, decideBy);
  await notifySafety({ to: userId, title: notice.title, body: notice.body, dedupeKey: `appeal:${ctx.caseId}` });
  if (notice.email) { await queueEmail(db, { kind: "trust_person", eventId: `appeal:${ctx.caseId}`, userId, data: notice.email as unknown as Record<string, unknown> }); await wakeEmailWorker(); }
  return { ok: true, decideBy };
}

/**
 * Removal resumes after an appeal ends without reversing it: the original clock, but at least a day left (the purge
 * runs 30 days after deletion_scheduled_at).
 */
async function rescheduleRemoval(caseId: string) {
  await db.execute(sql`UPDATE workspaces w SET deletion_scheduled_at = greatest(a.created_at, now() - interval '29 days') FROM moderation_actions a
    WHERE a.case_id = ${caseId} AND a.action = 'remove_workspace' AND a.undone_at IS NULL AND a.reversed_at IS NULL AND a.lifted_at IS NULL
      AND (w.id = a.target_id OR w.id::text IN (SELECT jsonb_array_elements_text(coalesce(a.restore->'children', '[]'::jsonb))))`);
}

/** Withdraw, until a reviewer has picked it up (10.3). */
export async function withdrawAppeal(userId: string, number: number): Promise<Result> {
  const c = await caseForPerson(userId, number);
  if (!c) return { ok: false, error: "Appeal not found." };
  const rows = await db.update(moderationAppeals).set({ state: "withdrawn" })
    .where(and(eq(moderationAppeals.caseId, c.id), eq(moderationAppeals.state, "pending"), sql`${moderationAppeals.assigneeId} IS NULL`)).returning({ id: moderationAppeals.id });
  if (!rows.length) return { ok: false, error: "A reviewer is already looking at it." };
  await rescheduleRemoval(c.id);
  await logModerationEvent(db, { caseId: c.id, actorId: userId, kind: "appeal_withdrawn" });
  return { ok: true };
}

export type Reduction = { action: "limit" | "suspension" | "hide"; days?: number | null };

/** Upheld, Reduced or Reversed (10.5). Self-review only while there's one staff member, with a note (T22). */
export async function decideAppeal(caseId: string, staffId: string, outcome: "upheld" | "reduced" | "reversed", reply: string, note: string, reduceTo?: Reduction | null): Promise<Result> {
  const [row] = await db.execute<{ appeal_id: string; state: string; number: number; subject_id: string | null; decided_by: string | null }>(sql`
    SELECT ap.id AS appeal_id, ap.state, c.number::int AS number, ap.subject_id, c.decided_by FROM moderation_appeals ap JOIN moderation_cases c ON c.id = ap.case_id WHERE ap.case_id = ${caseId}`);
  if (!row || !["pending", "in_review"].includes(row.state)) return { ok: false, error: "This appeal was already decided." };
  if (!reply.trim()) return { ok: false, error: "Write the reply the person will read." };
  if (row.decided_by === staffId) {
    if ((await listStaff()).length > 1) return { ok: false, error: "You made this decision. Ask someone else on the team to review the appeal." };
    if (!note.trim()) return { ok: false, error: "You made this decision. Add a note explaining the second look." };
  }
  const actions = [...await db.execute<ActionRow & { strike: boolean; restore: { visibility?: string } | null }>(sql`
    SELECT id, action, ends_at::text, appeal_until::text, target_id, created_at::text, strike, restore FROM moderation_actions
    WHERE case_id = ${caseId} AND undone_at IS NULL AND reversed_at IS NULL ORDER BY created_at`)];

  if (outcome === "reversed") {
    for (const a of actions) await reverseAction(a.id, staffId, "reversed", "Appeal reversed");
    // A limit that already ended still drops its strike.
    await db.update(moderationActions).set({ reversedAt: new Date(), reversedBy: staffId })
      .where(and(eq(moderationActions.caseId, caseId), sql`${moderationActions.reversedAt} IS NULL`, sql`${moderationActions.undoneAt} IS NULL`));
  } else if (outcome === "reduced") {
    if (!reduceTo) return { ok: false, error: "Pick the lighter step." };
    const target = reduceTo.action === "hide" ? actions.find((a) => a.action === "remove") : actions.find((a) => ["ban", "suspension", "limit"].includes(a.action));
    if (!target) return { ok: false, error: "There's nothing to reduce to that." };
    // A suspension reduced to a limit puts the profile back in search.
    if (target.action === "suspension") {
      await db.execute(sql`UPDATE profiles SET visibility = coalesce(${target.restore?.visibility ?? null}, visibility) WHERE id = ${row.subject_id}
        AND coalesce(app_private.moderation_restriction(${row.subject_id}::uuid), 'none') <> 'ban'
        AND NOT EXISTS (SELECT 1 FROM moderation_actions o WHERE o.subject_id = ${row.subject_id} AND o.id <> ${target.id} AND o.action = 'suspension'
          AND o.undone_at IS NULL AND o.reversed_at IS NULL AND o.lifted_at IS NULL AND (o.ends_at IS NULL OR o.ends_at > now()))`);
    }
    if (target.action === "ban") {
      // Undo the ban's own effects; the lighter step replaces it in place, strike kept.
      await reverseAction(target.id, staffId, "reversed", "Reduced on appeal");
      await db.update(moderationActions).set({ reversedAt: null, reversedBy: null }).where(eq(moderationActions.id, target.id));
    }
    await db.execute(sql`UPDATE moderation_actions SET action = ${reduceTo.action},
      ends_at = ${reduceTo.action === "hide" ? null : reduceTo.days ?? 7}::int * interval '1 day' + created_at${target.action === "ban" ? sql`, restore = '{}'::jsonb` : sql``}
      WHERE id = ${target.id}`);
    await logModerationEvent(db, { caseId, actorId: staffId, kind: "reduced", data: { from: target.action, to: reduceTo.action, days: reduceTo.days ?? null } });
    await rescheduleRemoval(caseId);
  } else {
    await rescheduleRemoval(caseId);
  }
  // A paused restriction (overdue appeal) resumes unless reversed.
  if (outcome !== "reversed") await db.update(moderationActions).set({ pausedAt: null }).where(inArray(moderationActions.id, actions.map((a) => a.id)));
  await db.update(moderationAppeals).set({ state: outcome, reply: reply.trim().slice(0, 4000), decidedBy: staffId, decidedAt: new Date() }).where(eq(moderationAppeals.id, row.appeal_id));
  await logModerationEvent(db, { caseId, actorId: staffId, kind: "appeal_decided", data: { outcome, note: note.trim().slice(0, 4000) || undefined } });
  if (row.subject_id) {
    const notice = appealDecidedNotice(row.number, outcome, reply.trim());
    await notifySafety({ to: row.subject_id, title: notice.title, body: notice.body, dedupeKey: `appeal-decided:${caseId}` });
    if (notice.email) { await queueEmail(db, { kind: "trust_person", eventId: `appeal-decided:${caseId}`, userId: row.subject_id, data: notice.email as unknown as Record<string, unknown> }); await wakeEmailWorker(); }
  }
  // Org moderators hear when NetworkBase reverses their removal (10.6).
  if (outcome === "reversed") {
    const [org] = await db.execute<{ actor_id: string | null }>(sql`SELECT actor_id FROM moderation_actions WHERE case_id = ${caseId} AND actor_scope = 'org' LIMIT 1`);
    if (org?.actor_id) await notifySafety({ to: org.actor_id, title: `NetworkBase reversed a removal on appeal · ${caseLabel(row.number)}`, body: reply.trim().slice(0, 300), dedupeKey: `org-reversed:${caseId}` });
  }
  return { ok: true };
}

/** Appeals tab (17.6). */
export async function readAppeals(open = true) {
  const rows = await db.execute<{ case_id: string; number: number; person: string | null; actions: string | null; created_at: string; deadline_at: string; state: string; decided_by: string | null }>(sql`
    SELECT ap.case_id, c.number::int AS number, coalesce(p.full_name, '@' || p.username) AS person, ap.created_at::text, ap.deadline_at::text, ap.state, c.decided_by,
           (SELECT string_agg(a.action || coalesce(' ' || extract(day FROM a.ends_at - a.created_at)::int || 'd', ''), ', ') FROM moderation_actions a WHERE a.case_id = c.id AND a.undone_at IS NULL) AS actions
    FROM moderation_appeals ap JOIN moderation_cases c ON c.id = ap.case_id LEFT JOIN profiles p ON p.id = ap.subject_id
    WHERE ${open ? sql`ap.state IN ('pending', 'in_review')` : sql`ap.state NOT IN ('pending', 'in_review')`}
    ORDER BY ${open ? sql`ap.deadline_at` : sql`ap.decided_at DESC NULLS LAST`} LIMIT 200`);
  return [...rows];
}

export async function readAppeal(caseId: string) {
  const [a] = await db.execute<{ body: string; fixed: boolean; state: string; deadline_at: string; created_at: string; reply: string | null; assignee_id: string | null }>(sql`
    SELECT body, fixed, state, deadline_at::text, created_at::text, reply, assignee_id FROM moderation_appeals WHERE case_id = ${caseId}`);
  return a ?? null;
}

export async function claimAppeal(caseId: string, staffId: string) {
  const rows = await db.update(moderationAppeals).set({ assigneeId: staffId, state: "in_review" })
    .where(and(eq(moderationAppeals.caseId, caseId), inArray(moderationAppeals.state, ["pending", "in_review"]))).returning({ id: moderationAppeals.id });
  if (rows.length) await logModerationEvent(db, { caseId, actorId: staffId, kind: "appeal_claimed" });
  return rows.length > 0;
}
