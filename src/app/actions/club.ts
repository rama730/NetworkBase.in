"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { isRecruiting, readRecruiting, recruitingSchema } from "@/lib/organizations/club";
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
  if (w?.type !== "club" || !a.canRead) return null;
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
