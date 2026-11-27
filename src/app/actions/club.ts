"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { DEFAULT_ASK, isRecruiting, readRecruiting, readRenewal, recruitingSchema, renewalSchema, renewalState, windowClosed, type RenewalState } from "@/lib/organizations/club";
import { askMembers } from "@/lib/organizations/club-server";
import { clubLike } from "@/lib/organizations/kits";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 36.2 (plan B7.1a, L1 calls 3–4, 7): a club's recruiting period. Anyone who can read the club sees whether it's
 * recruiting (About's banner); officers (the President and Coordinators) set it and see the drive's counts — numbers,
 * never a ranking. Nothing about visitors is collected (call 5).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const today = () => new Date().toISOString().slice(0, 10);

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; slug: string | null; title: string; code: string | null; code_on: boolean }>(sql`
    SELECT org_type AS type, org_settings AS settings, slug, title, join_code AS code, coalesce(join_code_enabled, false) AS code_on
    FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!clubLike(w?.type, w?.settings, "renewal") || !a.canRead) return null;
  return { userId, w, member: Boolean(userId) && (a.isOwner || a.isMember), officer: Boolean(userId) && (a.isOwner || a.memberRole === "admin") && !a.writeBlocked };
}

/** About's banner (everyone who can read the club): Recruiting now, its line, end date and first event. */
export async function readRecruitingAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx) return DENIED;
  const r = readRecruiting(ctx.w.settings);
  const on = isRecruiting(r, today());
  const [ev] = on && r?.firstEventId ? Array.from(await db.execute<{ title: string; due: string | null }>(sql`
    SELECT title, type_fields->>'start' AS due FROM tasks WHERE id = ${r.firstEventId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'event' AND deleted_at IS NULL AND stage <> 'cancelled'
      -- Security review: visitors see the first event only when it's a public one.
      ${ctx.member ? sql`` : sql`AND type_fields->>'who' = 'public'`}`)) : [];
  return { success: true as const, officer: ctx.officer, recruiting: on, settings: ctx.officer ? r : null, line: on ? r!.line : null, to: on ? r!.to : null,
    firstEvent: ev ? { title: ev.title, at: ev.due } : null,
    // The poster (officers): the club's name, its line, the short join link and code — no QR code (call 4).
    poster: ctx.officer ? { title: ctx.w.title, slug: ctx.w.slug ?? orgId, code: ctx.w.code_on ? ctx.w.code : null } : null };
}

/** Officers set (or clear) the recruiting period. */
export async function saveRecruitingAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer) return DENIED;
  if (input === null) {
    await db.execute(sql`UPDATE workspaces SET org_settings = org_settings #- '{club,recruiting}' WHERE id = ${orgId}::uuid`);
    return { success: true };
  }
  const parsed = recruitingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Recruiting needs a start and an end date after it." };
  const r = parsed.data;
  if (r.firstEventId) {
    const [ev] = Array.from(await db.execute<{ id: string }>(sql`SELECT id FROM tasks WHERE id = ${r.firstEventId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'event' AND deleted_at IS NULL`));
    if (!ev) return DENIED;
  }
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{club}', coalesce(org_settings->'club', '{}'::jsonb) || jsonb_build_object('recruiting', ${JSON.stringify(r)}::jsonb))
    WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** The drive's counts (officers, call 7): joined during the drive, and of them how many came to an event since. */
export async function readDriveCountsAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx?.officer) return DENIED;
  const r = readRecruiting(ctx.w.settings);
  if (!r) return { success: true as const, counts: null };
  const [c] = Array.from(await db.execute<{ joined: number; came: number }>(sql`
    WITH joined AS (SELECT user_id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'owner' AND joined_at::date BETWEEN ${r.from}::date AND ${r.to}::date)
    SELECT (SELECT count(*)::int FROM joined) AS joined,
      (SELECT count(DISTINCT v.user_id)::int FROM community_rsvps v JOIN joined j ON j.user_id = v.user_id WHERE v.workspace_id = ${orgId}::uuid AND v.checked_in_at IS NOT NULL) AS came`));
  return { success: true as const, counts: { joined: c?.joined ?? 0, came: c?.came ?? 0, from: r.from, to: r.to } };
}

/**
 * Season renewal (call 6): the member's own ask, or the officers' view of everyone's answers (officers only — answers
 * are never shown to other members).
 */
export async function readRenewalAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx?.member) return DENIED;
  const r = readRenewal(ctx.w.settings);
  if (!r?.on) return { success: true as const, on: false as const, officer: ctx.officer };
  const rows = Array.from(await db.execute<{ id: string; name: string; role: string; joined: string | null; answer: { season?: string; answer?: string } | null }>(sql`
    SELECT m.user_id AS id, coalesce(p.full_name, p.username, 'Member') AS name, m.role, m.joined_at::text AS joined, m.view_prefs->'club'->'renewal' AS answer
    FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.completed_at IS NULL ${ctx.officer ? sql`` : sql`AND m.user_id = ${ctx.userId}::uuid`} ORDER BY 2 LIMIT 2000`));
  const shaped = rows.map((x) => ({ id: x.id, name: x.name, officer: x.role === "owner" || x.role === "admin", state: renewalState(r, x.answer, x.joined) }));
  const mine = shaped.find((x) => x.id === ctx.userId) ?? null;
  return { success: true as const, on: true as const, officer: ctx.officer, season: r.season, ask: r.ask, days: r.days, closed: windowClosed(r, today()), mine: mine?.state ?? null,
    people: ctx.officer ? shaped : [] };
}

/** Officers start (or stop) Season renewal; starting asks every member once (call 6). */
export async function saveRenewalAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer) return DENIED;
  const parsed = renewalSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Give the Season’s start date and an answer window of 7 to 90 days." };
  const r = parsed.data;
  const before = readRenewal(ctx.w.settings);
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{club}', coalesce(org_settings->'club', '{}'::jsonb) || jsonb_build_object('renewal', ${JSON.stringify({ ...r, ask: r.ask || DEFAULT_ASK })}::jsonb))
    WHERE id = ${orgId}::uuid`);
  if (r.on && (!before?.on || before.season !== r.season)) await askMembers(orgId, ctx.w.slug ?? orgId, r.season, r.ask, ctx.userId, "ask");
  return { success: true };
}

/** A member answers Staying or Leaving. Leaving changes nothing on its own (layer 12). */
export async function answerRenewalAction(orgId: string, answer: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.member || (answer !== "staying" && answer !== "leaving")) return DENIED;
  const r = readRenewal(ctx.w.settings);
  if (!r?.on) return DENIED;
  await db.execute(sql`UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('club', coalesce(view_prefs->'club', '{}'::jsonb)
    || jsonb_build_object('renewal', jsonb_build_object('season', ${r.season}::text, 'answer', ${answer}::text, 'at', now())))
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND completed_at IS NULL`);
  return { success: true };
}

/**
 * End memberships not renewed (officers, once the window closed): everyone asked who didn't answer Staying, never an
 * officer (they hand over first) and never someone who joined this Season. Recorded as Season ended.
 */
export async function endNotRenewedAction(orgId: string): Promise<{ success: true; ended: number } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer) return DENIED;
  const r = readRenewal(ctx.w.settings);
  if (!r?.on) return DENIED;
  if (!windowClosed(r, today())) return { success: false, error: "Wait until the answer window has closed." };
  const { removeFromOrg } = await import("@/lib/organizations/members");
  const rows = Array.from(await db.execute<{ id: string; role: string; joined: string | null; answer: { season?: string; answer?: string } | null }>(sql`
    SELECT user_id AS id, role, joined_at::text AS joined, view_prefs->'club'->'renewal' AS answer FROM workspace_members
    WHERE workspace_id = ${orgId}::uuid AND completed_at IS NULL AND role NOT IN ('owner', 'admin') LIMIT 2000`));
  const ending = rows.filter((x) => (["leaving", "not_answered"] as RenewalState[]).includes(renewalState(r, x.answer, x.joined)));
  let ended = 0;
  for (const m of ending) {
    await db.transaction(async (tx) => {
      // Re-checked under the transaction: still a member, still not an officer.
      const [still] = Array.from(await tx.execute<{ role: string }>(sql`SELECT role FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${m.id}::uuid AND completed_at IS NULL FOR UPDATE`));
      if (!still || still.role === "owner" || still.role === "admin") return;
      await removeFromOrg(tx as never, orgId, m.id, ctx.userId!, { by: ctx.userId!, reason: "term_ended" });
      ended += 1;
    });
  }
  return { success: true, ended };
}
