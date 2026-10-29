import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import type { ModerationActionKind, ReportReason } from "@/lib/trust/rules";

// What a person sees about their own standing (docs/trust-and-safety-concept.md §8.4–8.6, C18): the banner, the
// limited sign-in screen and Settings → Account → Standing. Never names a reporter.

export type StandingAction = {
  id: string; case_number: number | null; action: ModerationActionKind; rule: number | null; label: string | null; reason: ReportReason | null;
  created_at: string; ends_at: string | null; appeal_until: string | null; strike: boolean; strike_expires_at: string | null;
  lifted_at: string | null; reversed_at: string | null; paused_at: string | null; appeal_state: string | null; appeal_deadline: string | null; workspace_title: string | null;
};

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Ban evasion (F15): a new account whose email or sign-in identity belongs to a banned one is banned too, when it
 * finishes setup. From then on the ordinary restriction check covers it.
 */
export async function banIfBlockedIdentity(userId: string) {
  const [p] = await db.execute<{ email: string | null }>(sql`SELECT email FROM profiles WHERE id = ${userId}`);
  const identities = await db.execute<{ provider: string; provider_id: string }>(sql`SELECT provider, provider_id FROM app_private.nb_user_identities(${userId}::uuid)`);
  const hashes = [...(p?.email ? [sha(`email:${p.email.toLowerCase()}`)] : []), ...[...identities].map((i) => sha(`identity:${i.provider}:${i.provider_id}`))];
  if (!hashes.length) return false;
  const [hit] = await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM moderation_blocked_identities WHERE hash IN (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})) AS ok`);
  if (!hit?.ok) return false;
  await db.execute(sql`INSERT INTO moderation_actions (subject_id, target_kind, target_id, action, rule, message, notified_at)
    VALUES (${userId}, 'account', ${userId}, 'ban', 15, 'This account is linked to an account we banned.', now())`);
  await db.execute(sql`SELECT app_private.moderation_sign_out_everywhere(${userId}::uuid)`);
  return true;
}

/** The one restriction in force on an account, for the gate and the banner. Cheap: one indexed query. */
export async function accountRestriction(userId: string): Promise<{ action: "limit" | "suspension" | "ban"; endsAt: string | null; caseNumber: number | null; rule: number | null; appealState: string | null; appealDeadline: string | null; appealUntil: string | null } | null> {
  const [row] = await db.execute<{ action: "limit" | "suspension" | "ban"; ends_at: string | null; case_number: number | null; rule: number | null; appeal_state: string | null; appeal_deadline: string | null; appeal_until: string | null }>(sql`
    SELECT a.action, a.ends_at::text, c.number::int AS case_number, a.rule, ap.state AS appeal_state, ap.deadline_at::text AS appeal_deadline, a.appeal_until::text
    FROM moderation_actions a LEFT JOIN moderation_cases c ON c.id = a.case_id LEFT JOIN moderation_appeals ap ON ap.case_id = a.case_id
    WHERE a.subject_id = ${userId} AND a.action IN ('limit', 'suspension', 'ban') AND a.lifted_at IS NULL AND a.undone_at IS NULL AND a.reversed_at IS NULL
      AND a.paused_at IS NULL AND (a.ends_at IS NULL OR a.ends_at > now())
    ORDER BY CASE a.action WHEN 'ban' THEN 3 WHEN 'suspension' THEN 2 ELSE 1 END DESC LIMIT 1`);
  return row ? { action: row.action, endsAt: row.ends_at, caseNumber: row.case_number, rule: row.rule, appealState: row.appeal_state, appealDeadline: row.appeal_deadline, appealUntil: row.appeal_until } : null;
}

/** Workspaces and orgs this person owns that are restricted, suspended or set for removal (banner, 8.4). */
export async function ownedWorkspaceActions(userId: string) {
  const rows = await db.execute<{ action: ModerationActionKind; title: string; ends_at: string | null; case_number: number | null; appeal_state: string | null }>(sql`
    SELECT a.action, w.title, a.ends_at::text, c.number::int AS case_number, ap.state AS appeal_state
    FROM moderation_actions a JOIN workspaces w ON w.id = a.target_id AND w.owner_id = ${userId} AND w.deleted_at IS NULL
      LEFT JOIN moderation_cases c ON c.id = a.case_id LEFT JOIN moderation_appeals ap ON ap.case_id = a.case_id
    WHERE a.action IN ('restrict', 'suspend_workspace', 'remove_workspace') AND a.lifted_at IS NULL AND a.undone_at IS NULL AND a.reversed_at IS NULL
    ORDER BY a.created_at DESC LIMIT 3`);
  return [...rows];
}

/** Settings → Account → Standing: active, strikes, appeals, 24 months of history. */
export async function readStanding(userId: string) {
  const actions = await db.execute<StandingAction>(sql`
    SELECT a.id, c.number::int AS case_number, a.action, a.rule, c.snapshot->>'label' AS label, c.reason, a.created_at::text, a.ends_at::text, a.appeal_until::text,
           a.strike, a.strike_expires_at::text, a.lifted_at::text, a.reversed_at::text, a.paused_at::text, ap.state AS appeal_state, ap.deadline_at::text AS appeal_deadline,
           w.title AS workspace_title
    FROM moderation_actions a LEFT JOIN moderation_cases c ON c.id = a.case_id LEFT JOIN moderation_appeals ap ON ap.case_id = a.case_id
      LEFT JOIN workspaces w ON w.id = c.workspace_id
    WHERE a.subject_id = ${userId} AND a.undone_at IS NULL AND a.notified_at IS NOT NULL AND a.created_at > now() - interval '24 months'
    ORDER BY a.created_at DESC`);
  const all = [...actions];
  const now = Date.now();
  const inForce = (a: StandingAction) => !a.lifted_at && !a.reversed_at && (!a.ends_at || new Date(a.ends_at).getTime() > now) && ["limit", "suspension", "ban", "restrict", "suspend_workspace", "remove_workspace"].includes(a.action);
  return {
    restriction: await accountRestriction(userId),
    active: all.filter(inForce),
    strikes: all.filter((a) => a.strike && !a.reversed_at && a.strike_expires_at && new Date(a.strike_expires_at).getTime() > now),
    history: all,
  };
}
