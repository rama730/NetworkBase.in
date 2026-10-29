import "server-only";

import { createHash } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { contentReports, moderationActions, moderationCases } from "@/lib/db/schema";
import { queueEmail, wakeEmailWorker } from "@/lib/email/outbox";
import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";
import { logModerationEvent } from "@/lib/trust/cases";
import { decisionNotice, endedNotice, reporterOutcomeNotice, shortDate } from "@/lib/trust/messages";
import { notifySafety } from "@/lib/trust/notify";
import {
  actionsFor, ADMIN_ONLY_ACTIONS, addsStrike, appealUntil as appealWindow, caseLabel, KIND_NOUN, PENDING_INVESTIGATION_DAYS,
  STRIKE_DAYS, type ModerationActionKind, type ReportReason, type ReportTargetKind,
} from "@/lib/trust/rules";
import type { StaffRole } from "@/lib/trust/staff";
import { setContentHidden } from "@/lib/trust/targets";

// Decisions (docs/trust-and-safety-concept.md §7, C7–C9): what staff and org moderators do to a case. Changes apply
// at once; notices and emails wait 10 seconds so Undo is real (C8). Every action keeps what it needs to reverse.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
export const UNDO_SECONDS = 10;

export type Decision = {
  outcome: "no_violation" | "actioned";
  /** One action on the thing itself (C7: only the ones that fit its kind). */
  content?: ModerationActionKind | null;
  /** The account step (T9): staff only. */
  account?: { action: "warning" | "limit" | "suspension" | "ban"; days?: number | null } | null;
  rule?: number | null;
  message?: string | null;
  note?: string | null;
};
export type Actor = { id: string; scope: "staff"; role: StaffRole } | { id: string; scope: "org"; orgId: string };
type Result = { ok: true } | { ok: false; error: string };

type CaseRow = {
  id: string; number: number; target_kind: ReportTargetKind; target_id: string; target_seq: number | null; subject_id: string | null;
  workspace_id: string | null; org_id: string | null; reason: ReportReason; state: string; routed_to: "org" | "staff"; assignee_id: string | null;
  auto_hidden_at: string | null; snapshot: Record<string, unknown> | null;
};

async function lockCase(tx: Executor, caseId: string) {
  const [row] = await tx.execute<CaseRow>(sql`
    SELECT id, number::int AS number, target_kind, target_id, target_seq::int AS target_seq, subject_id, workspace_id, org_id, reason, state, routed_to,
           assignee_id, auto_hidden_at::text, snapshot
    FROM moderation_cases WHERE id = ${caseId} FOR UPDATE`);
  return row ?? null;
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Active strikes before this decision (F2), for the suggested step and the email's "strike N" line. */
export async function activeStrikes(executor: Executor, subjectId: string) {
  const [row] = await executor.execute<{ n: number }>(sql`
    SELECT count(DISTINCT coalesce(case_id::text, id::text))::int AS n FROM moderation_actions
    WHERE subject_id = ${subjectId} AND strike AND strike_expires_at > now() AND undone_at IS NULL AND reversed_at IS NULL`);
  return row?.n ?? 0;
}

/** Applies one action and returns what reversing it needs. */
async function applyAction(tx: Tx, c: CaseRow, action: ModerationActionKind, message: string | null, days: number | null): Promise<{ restore: Record<string, unknown>; endsAt: Date | null }> {
  const now = new Date();
  const kind = c.target_kind;
  if (action === "hide" || action === "remove") {
    if (await setContentHidden(kind, c.target_id, c.target_seq, true, tx)) return { restore: { content: "soft" }, endsAt: null };
    if (kind === "doc") {
      const [doc] = await tx.execute<Record<string, unknown>>(sql`DELETE FROM workspace_documents WHERE id = ${c.target_id} RETURNING *`);
      return { restore: { content: "doc", row: doc ?? null }, endsAt: null };
    }
    if (kind === "chat_channel") {
      await tx.execute(sql`UPDATE chat_channels SET archived_at = coalesce(archived_at, now()) WHERE id = ${c.target_id}`);
      return { restore: { content: "channel" }, endsAt: null };
    }
    // Notes and posts without a soft delete: clear the text, keep the original for a reversal.
    const column = kind === "role" ? "description" : kind === "application" ? "message" : kind === "invitation" ? "note" : kind === "connection_request" ? "message" : null;
    const table = kind === "role" ? "workspace_open_roles" : kind === "application" ? "role_applications" : kind === "invitation" ? "workspace_invitations" : kind === "connection_request" ? "connections" : null;
    if (column && table) {
      const [before] = await tx.execute<{ value: string | null }>(sql`SELECT ${sql.raw(column)} AS value FROM ${sql.raw(table)} WHERE id = ${c.target_id}`);
      await tx.execute(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(column)} = NULL WHERE id = ${c.target_id}`);
      return { restore: { content: "text", table, column, value: before?.value ?? null }, endsAt: null };
    }
    return { restore: {}, endsAt: null };
  }
  if (action === "reset_profile") {
    const [before] = await tx.execute<{ avatar_url: string | null; headline: string | null; bio: string | null; full_name: string | null; username: string | null }>(sql`
      SELECT avatar_url, headline, bio, full_name, username FROM profiles WHERE id = ${c.target_id}`);
    await tx.execute(sql`UPDATE profiles SET avatar_url = NULL, headline = NULL, bio = NULL, full_name = username, updated_at = now() WHERE id = ${c.target_id}`);
    return { restore: { profile: before ?? null }, endsAt: null };
  }
  if (action === "hold_handle") {
    const [before] = await tx.execute<{ username: string | null }>(sql`SELECT username FROM profiles WHERE id = ${c.target_id}`);
    const held = `user_${c.target_id.replace(/-/g, "").slice(0, 12)}`;
    await tx.execute(sql`UPDATE profiles SET username = ${held}, updated_at = now() WHERE id = ${c.target_id}`);
    if (before?.username) await tx.execute(sql`INSERT INTO reserved_usernames (username, reason) VALUES (${before.username}, 'moderation') ON CONFLICT DO NOTHING`);
    return { restore: { username: before?.username ?? null }, endsAt: null };
  }
  if (["hide_discover", "restrict", "suspend_workspace", "remove_workspace", "remove_verified"].includes(action)) {
    const [w] = await tx.execute<Record<string, unknown>>(sql`
      SELECT discover_hidden_at, restricted_at, visibility, join_code_enabled, suspended_at, suspend_reason, deletion_scheduled_at, verified_at
      FROM workspaces WHERE id = ${c.target_id}`);
    const endsAt = action === "remove_workspace" ? new Date(now.getTime() + 30 * 86_400_000) : null;
    if (action === "hide_discover") await tx.execute(sql`UPDATE workspaces SET discover_hidden_at = now() WHERE id = ${c.target_id}`);
    if (action === "restrict") await tx.execute(sql`UPDATE workspaces SET restricted_at = now(), visibility = 'private', join_code_enabled = false WHERE id = ${c.target_id}`);
    if (action === "suspend_workspace") await tx.execute(sql`UPDATE workspaces SET suspended_at = now(), suspend_reason = ${message ?? "Suspended by NetworkBase"} WHERE id = ${c.target_id}`);
    // Removal uses the org deletion clock (lib/organizations/lifecycle): deletion_scheduled_at is when it was asked
    // for, and the purge runs 30 days later. An org's own workspaces go with it; join codes stop at once.
    let children: string[] = [];
    if (action === "remove_workspace") {
      await tx.execute(sql`UPDATE workspaces SET deletion_scheduled_at = now(), join_code_enabled = false WHERE id = ${c.target_id}`);
      const rows = await tx.execute<{ id: string }>(sql`
        UPDATE workspaces SET deletion_scheduled_at = now() WHERE parent_id = ${c.target_id} AND deleted_at IS NULL AND deletion_scheduled_at IS NULL RETURNING id`);
      children = [...rows].map((r) => r.id);
    }
    if (action === "remove_verified") await tx.execute(sql`UPDATE workspaces SET verified_at = NULL WHERE id = ${c.target_id}`);
    return { restore: { workspace: w ?? null, ...(children.length ? { children } : {}) }, endsAt };
  }
  // Account actions apply to the person responsible.
  const subject = c.subject_id!;
  if (action === "warning") return { restore: {}, endsAt: null };
  const length = action === "ban" ? null : (days ?? (action === "limit" ? 7 : PENDING_INVESTIGATION_DAYS));
  const endsAt = length ? new Date(now.getTime() + length * 86_400_000) : null;
  if (action === "suspension" || action === "ban") {
    await tx.execute(sql`SELECT app_private.moderation_sign_out_everywhere(${subject}::uuid)`);
    // Side effects (F13): invitations they sent are cancelled; IDE tokens stop working.
    await tx.execute(sql`UPDATE workspace_invitations SET status = 'cancelled', resolved_at = now() WHERE inviter_id = ${subject} AND status = 'pending'`);
    await tx.execute(sql`UPDATE extension_device_sessions SET revoked_at = now(), revocation_reason = 'moderation' WHERE user_id = ${subject} AND revoked_at IS NULL`);
  }
  if (action === "ban") {
    // A ban also withdraws their pending applications and frees their tasks (F13).
    await tx.execute(sql`UPDATE role_applications SET status = 'withdrawn', updated_at = now() WHERE applicant_id = ${subject} AND status = 'pending'`);
    await tx.execute(sql`UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ${subject}`);
    const [p] = await tx.execute<{ email: string | null; visibility: string | null }>(sql`SELECT email, visibility FROM profiles WHERE id = ${subject}`);
    const identities = await tx.execute<{ provider: string; provider_id: string }>(sql`SELECT provider, provider_id FROM app_private.nb_user_identities(${subject}::uuid)`);
    const hashes = [...(p?.email ? [{ hash: sha(`email:${p.email.toLowerCase()}`), kind: "email" }] : []), ...[...identities].map((i) => ({ hash: sha(`identity:${i.provider}:${i.provider_id}`), kind: "identity" }))];
    for (const h of hashes) await tx.execute(sql`INSERT INTO moderation_blocked_identities (hash, kind) VALUES (${h.hash}, ${h.kind}) ON CONFLICT DO NOTHING`);
    await tx.execute(sql`UPDATE profiles SET visibility = 'private' WHERE id = ${subject}`);
    return { restore: { visibility: p?.visibility ?? null, hashes: hashes.map((h) => h.hash) }, endsAt };
  }
  return { restore: {}, endsAt };
}

// The only table/column pairs applyAction clears, so a reversal never builds SQL from anything else.
const TEXT_COLUMNS: Record<string, string> = { workspace_open_roles: "description", role_applications: "message", workspace_invitations: "note", connections: "message" };

/** Reverses one action's effect (Undo, a Reversed appeal, or Lift). */
async function revertAction(tx: Tx, a: { action: ModerationActionKind; target_kind: string; target_id: string | null; target_seq: number | null; subject_id: string | null; restore: Record<string, unknown> | null; id: string }) {
  const r = a.restore ?? {};
  if ((a.action === "hide" || a.action === "remove") && a.target_id) {
    if (r.content === "soft") await setContentHidden(a.target_kind as ReportTargetKind, a.target_id, a.target_seq, false, tx);
    if (r.content === "channel") await tx.execute(sql`UPDATE chat_channels SET archived_at = NULL WHERE id = ${a.target_id}`);
    if (r.content === "text" && typeof r.table === "string" && typeof r.column === "string" && TEXT_COLUMNS[r.table] === r.column) {
      await tx.execute(sql`UPDATE ${sql.raw(r.table)} SET ${sql.raw(r.column)} = ${(r.value as string | null) ?? null} WHERE id = ${a.target_id}`);
    }
    if (r.content === "doc" && r.row && typeof r.row === "object") {
      const d = r.row as Record<string, unknown>;
      await tx.execute(sql`INSERT INTO workspace_documents (id, workspace_id, published_version_id, settings, created_at, updated_at, linked_node_id, filename, slug)
        VALUES (${d.id as string}, ${d.workspace_id as string}, ${(d.published_version_id as string) ?? null}, ${JSON.stringify(d.settings ?? {})}::jsonb, ${String(d.created_at)}::timestamptz, now(),
                ${(d.linked_node_id as string) ?? null}, ${d.filename as string}, ${d.slug as string}) ON CONFLICT (id) DO NOTHING`);
    }
  }
  if (a.action === "reset_profile" && a.target_id && r.profile && typeof r.profile === "object") {
    const p = r.profile as Record<string, string | null>;
    await tx.execute(sql`UPDATE profiles SET avatar_url = ${p.avatar_url}, headline = ${p.headline}, bio = ${p.bio}, full_name = ${p.full_name}, updated_at = now() WHERE id = ${a.target_id}`);
  }
  if (a.action === "hold_handle" && a.target_id && typeof r.username === "string") {
    await tx.execute(sql`DELETE FROM reserved_usernames WHERE username = ${r.username} AND reason = 'moderation'`);
    await tx.execute(sql`UPDATE profiles SET username = ${r.username}, updated_at = now() WHERE id = ${a.target_id}
      AND NOT EXISTS (SELECT 1 FROM profiles o WHERE o.username = ${r.username} AND o.id <> ${a.target_id})`);
  }
  if (r.workspace && typeof r.workspace === "object" && a.target_id) {
    const w = r.workspace as Record<string, unknown>;
    const ts = (v: unknown) => (v == null ? null : String(v));
    if (a.action === "hide_discover") await tx.execute(sql`UPDATE workspaces SET discover_hidden_at = ${ts(w.discover_hidden_at)}::timestamptz WHERE id = ${a.target_id}`);
    if (a.action === "restrict") await tx.execute(sql`UPDATE workspaces SET restricted_at = ${ts(w.restricted_at)}::timestamptz, visibility = ${String(w.visibility ?? "private")}, join_code_enabled = ${Boolean(w.join_code_enabled)} WHERE id = ${a.target_id}`);
    if (a.action === "suspend_workspace") await tx.execute(sql`UPDATE workspaces SET suspended_at = ${ts(w.suspended_at)}::timestamptz, suspend_reason = ${(w.suspend_reason as string | null) ?? null} WHERE id = ${a.target_id}`);
    if (a.action === "remove_workspace") {
      await tx.execute(sql`UPDATE workspaces SET deletion_scheduled_at = ${ts(w.deletion_scheduled_at)}::timestamptz, join_code_enabled = ${Boolean(w.join_code_enabled)} WHERE id = ${a.target_id}`);
      const children = Array.isArray(r.children) ? (r.children as string[]) : [];
      if (children.length) await tx.execute(sql`UPDATE workspaces SET deletion_scheduled_at = NULL WHERE id IN (${sql.join(children.map((id) => sql`${id}`), sql`, `)})`);
    }
    if (a.action === "remove_verified") await tx.execute(sql`UPDATE workspaces SET verified_at = ${ts(w.verified_at)}::timestamptz WHERE id = ${a.target_id}`);
  }
  if (a.action === "ban" && a.subject_id) {
    const hashes = Array.isArray(r.hashes) ? (r.hashes as string[]) : [];
    if (hashes.length) await tx.execute(sql`DELETE FROM moderation_blocked_identities WHERE hash IN (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})`);
    if (typeof r.visibility === "string") await tx.execute(sql`UPDATE profiles SET visibility = ${r.visibility} WHERE id = ${a.subject_id}`);
  }
}

/** Decide a case (C7). Staff can do everything their role allows; org moderators only content and warnings in their org. */
export async function decideCase(caseId: string, actor: Actor, decision: Decision): Promise<Result> {
  const outcome = await db.transaction(async (tx): Promise<Result & { number?: number; repeatCheck?: { orgId: string; subjectId: string } }> => {
    const c = await lockCase(tx, caseId);
    if (!c) return { ok: false, error: "Case not found." };
    if (c.state !== "open" && c.state !== "in_review") return { ok: false, error: `${caseLabel(c.number)} was already decided.` };
    if (c.assignee_id && c.assignee_id !== actor.id) return { ok: false, error: "Someone else is reviewing this case. Take it over first." };
    if (actor.scope === "org" && (c.routed_to !== "org" || c.org_id !== actor.orgId)) return { ok: false, error: "This case is with NetworkBase now." };
    const now = new Date();

    if (decision.outcome === "no_violation") {
      if (c.auto_hidden_at) await setContentHidden(c.target_kind, c.target_id, c.target_seq, false, tx);
      await tx.update(moderationCases).set({ state: "decided", outcome: "no_violation", decidedBy: actor.id, decidedAt: now, updatedAt: now }).where(eq(moderationCases.id, c.id));
      await tx.update(contentReports).set({ status: "dismissed", resolvedBy: actor.id, resolvedAt: now }).where(and(eq(contentReports.caseId, c.id), eq(contentReports.status, "open")));
      await logModerationEvent(tx, { caseId: c.id, actorId: actor.id, kind: "decided", data: { outcome: "no_violation", scope: actor.scope } });
      if (decision.note?.trim()) await logModerationEvent(tx, { caseId: c.id, actorId: actor.id, kind: "note", data: { body: decision.note.trim().slice(0, 4000) } });
      return { ok: true, number: c.number };
    }

    const content = decision.content ?? null;
    const account = decision.account ?? null;
    if (!content && !account) return { ok: false, error: "Pick at least one action." };
    if (!decision.rule) return { ok: false, error: "Pick the rule that was broken." };
    if (content && !actionsFor(c.target_kind).includes(content)) return { ok: false, error: "That action doesn't fit this kind of thing." };
    if (account && !c.subject_id) return { ok: false, error: "There's no account to act on." };
    if (actor.scope === "org") {
      if (account && account.action !== "warning") return { ok: false, error: "Organizations can warn, hide or remove; account limits are NetworkBase's." };
      if (content && content !== "hide" && content !== "remove") return { ok: false, error: "Organizations can only hide or remove content." };
    } else if ((content && ADMIN_ONLY_ACTIONS.includes(content)) || (account && ADMIN_ONLY_ACTIONS.includes(account.action))) {
      if (actor.role !== "admin") return { ok: false, error: "Only admins can ban or remove a workspace." };
    }

    const strikesBefore = c.subject_id ? await activeStrikes(tx, c.subject_id) : 0;
    const notifyAfter = new Date(now.getTime() + UNDO_SECONDS * 1000);
    const strikeExpires = new Date(now.getTime() + STRIKE_DAYS * 86_400_000);
    const primary = account?.action ?? content!;
    const appealUntil = appealWindow(primary, c.reason, now);
    // One strike per decision (F2, F4): on the account step, else on the content action when it counts.
    const strikeOnAccount = actor.scope === "staff" && Boolean(account);
    const strikeOnContent = actor.scope === "staff" && !account && Boolean(content && addsStrike(content));
    const message = decision.message?.trim() || null;

    for (const [kind, isAccount] of [[content, false], [account?.action ?? null, true]] as const) {
      if (!kind) continue;
      const effect = await applyAction(tx, c, kind, message, isAccount ? account?.days ?? null : null);
      const strike = isAccount ? strikeOnAccount : strikeOnContent;
      await tx.insert(moderationActions).values({
        caseId: c.id, actorId: actor.id, actorScope: actor.scope, orgId: actor.scope === "org" ? actor.orgId : null, subjectId: c.subject_id,
        targetKind: isAccount ? "account" : c.target_kind, targetId: isAccount ? c.subject_id : c.target_id, targetSeq: isAccount ? null : c.target_seq,
        action: kind, rule: decision.rule, message, restore: effect.restore, strike, strikeExpiresAt: strike ? strikeExpires : null,
        endsAt: effect.endsAt, appealUntil, notifyAfter,
      });
    }
    await tx.update(moderationCases).set({ state: "decided", outcome: "actioned", decidedBy: actor.id, decidedAt: now, updatedAt: now }).where(eq(moderationCases.id, c.id));
    await tx.update(contentReports).set({ status: "actioned", resolvedBy: actor.id, resolvedAt: now }).where(and(eq(contentReports.caseId, c.id), eq(contentReports.status, "open")));
    await logModerationEvent(tx, { caseId: c.id, actorId: actor.id, kind: "decided", data: { outcome: "actioned", content, account, rule: decision.rule, scope: actor.scope, strikesBefore } });
    if (decision.note?.trim()) await logModerationEvent(tx, { caseId: c.id, actorId: actor.id, kind: "note", data: { body: decision.note.trim().slice(0, 4000) } });
    return { ok: true, number: c.number, repeatCheck: actor.scope === "org" && c.subject_id && (content === "remove" || content === "hide") ? { orgId: actor.orgId, subjectId: c.subject_id } : undefined };
  });
  if (!outcome.ok) return outcome;
  // Notices go once the Undo window passes; the deadlines job delivers anything this misses.
  await inngest.send({ name: "trust/decision.made", data: { caseId } }).catch((error) => {
    logger.warn("trust.decision_event_failed", { module: "trust", error: error instanceof Error ? error.message : String(error) });
  });
  if (outcome.repeatCheck) await openRepeatRemovalCase(outcome.repeatCheck.orgId, outcome.repeatCheck.subjectId);
  return { ok: true };
}

/** 3 org removals for one person within 30 days open a staff case (T19). */
async function openRepeatRemovalCase(orgId: string, subjectId: string) {
  const [row] = await db.execute<{ n: number; title: string }>(sql`
    SELECT count(*)::int AS n, (SELECT title FROM workspaces WHERE id = ${orgId}) AS title FROM moderation_actions
    WHERE actor_scope = 'org' AND org_id = ${orgId} AND subject_id = ${subjectId} AND action IN ('hide', 'remove')
      AND created_at > now() - interval '30 days' AND undone_at IS NULL AND reversed_at IS NULL`);
  if ((row?.n ?? 0) < 3) return;
  const now = new Date();
  await db.insert(moderationCases).values({
    targetKind: "person", targetId: subjectId, subjectId, orgId, severity: "high", reason: "other", source: "staff", routedTo: "staff",
    deadlineAt: new Date(now.getTime() + 24 * 3_600_000), details: `Repeated removals in ${row?.title ?? "an organization"}`,
    snapshot: { label: `Repeated removals in ${row?.title ?? "an organization"}` },
  }).onConflictDoNothing();
}

/** Undo within 10 seconds (C8): reverts every action of the decision and reopens the case for the same reviewer. */
export async function undoDecision(caseId: string, actorId: string): Promise<Result> {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    if (!c || c.state !== "decided") return { ok: false, error: "Nothing to undo." };
    const actions = await tx.execute<{ id: string; action: ModerationActionKind; target_kind: string; target_id: string | null; target_seq: number | null; subject_id: string | null; restore: Record<string, unknown> | null; notified_at: string | null }>(sql`
      SELECT id, action, target_kind, target_id, target_seq::int AS target_seq, subject_id, restore, notified_at::text FROM moderation_actions
      WHERE case_id = ${caseId} AND undone_at IS NULL AND reversed_at IS NULL FOR UPDATE`);
    if ([...actions].some((a) => a.notified_at)) return { ok: false, error: "The notices already went out. Reverse it from the case instead." };
    const [decided] = await tx.execute<{ fresh: boolean }>(sql`SELECT decided_at > now() - make_interval(secs => ${UNDO_SECONDS + 5}) AS fresh FROM moderation_cases WHERE id = ${caseId}`);
    if (!decided?.fresh) return { ok: false, error: "Undo is only possible for 10 seconds." };
    for (const a of actions) await revertAction(tx, a);
    if (actions.length) await tx.update(moderationActions).set({ undoneAt: new Date() }).where(inArray(moderationActions.id, [...actions].map((a) => a.id)));
    await tx.update(moderationCases).set({ state: "in_review", outcome: null, decidedBy: null, decidedAt: null, assigneeId: actorId, updatedAt: new Date() }).where(eq(moderationCases.id, caseId));
    await tx.update(contentReports).set({ status: "open", resolvedBy: null, resolvedAt: null }).where(eq(contentReports.caseId, caseId));
    await logModerationEvent(tx, { caseId, actorId, kind: "undone" });
    return { ok: true };
  });
}

/** Lift (Active tab) or reverse an action (appeals, mistakes). The person hears it from the caller's notice. */
export async function reverseAction(actionId: string, actorId: string, kind: "lifted" | "reversed", note: string): Promise<Result & { subjectId?: string | null; caseId?: string | null }> {
  return db.transaction(async (tx) => {
    const [a] = await tx.execute<{ id: string; case_id: string | null; action: ModerationActionKind; target_kind: string; target_id: string | null; target_seq: number | null; subject_id: string | null; restore: Record<string, unknown> | null }>(sql`
      SELECT id, case_id, action, target_kind, target_id, target_seq::int AS target_seq, subject_id, restore FROM moderation_actions
      WHERE id = ${actionId} AND undone_at IS NULL AND reversed_at IS NULL AND lifted_at IS NULL FOR UPDATE`);
    if (!a) return { ok: false, error: "That action is no longer in force." };
    await revertAction(tx, a);
    await tx.update(moderationActions).set(kind === "lifted" ? { liftedAt: new Date() } : { reversedAt: new Date(), reversedBy: actorId }).where(eq(moderationActions.id, a.id));
    await logModerationEvent(tx, { caseId: a.case_id, actorId, kind, data: { actionId: a.id, action: a.action, note: note.slice(0, 2000) } });
    return { ok: true, subjectId: a.subject_id, caseId: a.case_id };
  });
}

/** Sends the notices and emails whose Undo window has passed, plus each reporter's outcome. Safe to run twice. */
export async function deliverDecisionNotices(caseId?: string) {
  const pending = await db.execute<{ id: string; case_id: string | null; number: number | null; actor_scope: "staff" | "org"; subject_id: string | null; target_kind: ReportTargetKind;
    action: ModerationActionKind; rule: number | null; message: string | null; ends_at: string | null; appeal_until: string | null; label: string | null; created_at: string; workspace_title: string | null; tz: string | null }>(sql`
    SELECT a.id, a.case_id, c.number::int AS number, a.actor_scope, a.subject_id, coalesce(c.target_kind, a.target_kind) AS target_kind, a.action, a.rule, a.message,
           a.ends_at::text, a.appeal_until::text, c.snapshot->>'label' AS label, a.created_at::text, w.title AS workspace_title,
           (SELECT p.notification_preferences->'quietHours'->>'timeZone' FROM profiles p WHERE p.id = a.subject_id) AS tz
    FROM moderation_actions a LEFT JOIN moderation_cases c ON c.id = a.case_id LEFT JOIN workspaces w ON w.id = c.workspace_id
    WHERE a.notified_at IS NULL AND a.undone_at IS NULL AND a.notify_after <= now() ${caseId ? sql`AND a.case_id = ${caseId}` : sql``}
    ORDER BY a.created_at LIMIT 200`);
  for (const a of pending) {
    const claimed = await db.update(moderationActions).set({ notifiedAt: new Date() }).where(and(eq(moderationActions.id, a.id), isNull(moderationActions.notifiedAt), isNull(moderationActions.undoneAt))).returning({ id: moderationActions.id });
    if (!claimed.length) continue;
    const recipient = ["hide_discover", "restrict", "suspend_workspace", "remove_workspace", "remove_verified"].includes(a.action)
      ? (await db.execute<{ owner_id: string }>(sql`SELECT owner_id FROM workspaces WHERE id = (SELECT target_id FROM moderation_actions WHERE id = ${a.id})`))[0]?.owner_id ?? null
      : a.subject_id;
    if (!recipient) continue;
    const strikes = a.subject_id ? await activeStrikes(db, a.subject_id) : 0;
    const where = a.label ? `${a.label.charAt(0).toLowerCase()}${a.label.slice(1)} on ${shortDate(a.created_at, a.tz)}` : `your ${KIND_NOUN[a.target_kind] ?? "content"}`;
    const notice = decisionNotice({
      caseNumber: a.number ?? 0, action: a.action, targetKind: a.target_kind, where, rule: a.rule ?? 15, message: a.message ?? "",
      endsAt: a.ends_at ? new Date(a.ends_at) : null, appealUntil: a.appeal_until ? new Date(a.appeal_until) : null, strikesActive: strikes,
      workspaceTitle: a.workspace_title, timeZone: a.tz,
    }, a.actor_scope === "staff");
    await notifySafety({ to: recipient, title: notice.title, body: notice.body, href: "/settings#settings-account-standing", dedupeKey: `decision:${a.id}` });
    if (notice.email) await queueEmail(db, { kind: "trust_person", eventId: `decision:${a.id}`, userId: recipient, data: notice.email as unknown as Record<string, unknown> });
  }
  if (pending.length) await wakeEmailWorker();

  // Reporters hear the outcome once the Undo window has passed (T5).
  const decided = await db.execute<{ id: string; number: number; outcome: string; label: string | null }>(sql`
    SELECT c.id, c.number::int AS number, c.outcome, c.snapshot->>'label' AS label FROM moderation_cases c
    WHERE c.state = 'decided' AND c.outcome IN ('no_violation', 'actioned') AND c.decided_at <= now() - make_interval(secs => ${UNDO_SECONDS})
      AND NOT EXISTS (SELECT 1 FROM moderation_events e WHERE e.case_id = c.id AND e.kind = 'reporters_told')
      ${caseId ? sql`AND c.id = ${caseId}` : sql``}
    LIMIT 200`);
  for (const c of decided) {
    const reporters = await db.selectDistinct({ id: contentReports.reporterId }).from(contentReports).where(eq(contentReports.caseId, c.id));
    const notice = reporterOutcomeNotice(c.number, c.outcome === "actioned", c.label);
    for (const r of reporters) await notifySafety({ to: r.id, title: notice.title, body: notice.body, href: "/settings#settings-privacy-reports", dedupeKey: `outcome:${c.id}` });
    await logModerationEvent(db, { caseId: c.id, actorId: null, kind: "reporters_told", data: { reporters: reporters.length } });
  }
}

/** M5 when a restriction ends on time or is lifted. */
export async function noticeRestrictionEnded(subjectId: string, key: string) {
  const n = endedNotice();
  await notifySafety({ to: subjectId, title: n.title, body: n.body, dedupeKey: `ended:${key}` });
  if (n.email) await queueEmail(db, { kind: "trust_person", eventId: `ended:${key}`, userId: subjectId, data: n.email as unknown as Record<string, unknown> });
  await wakeEmailWorker();
}

