"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { wouldLoop, type ReportsTo } from "@/lib/organizations/directory";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 33.3 (plan B4.2a–b, K2): the company Directory every member sees — cards with title, teams, office, local
 * time and working hours, Away until, Reports to and Ask me about, and Message; never an email or phone (call 6).
 * Viewers see names and titles only, and only when allowed (call 1). The org chart is drawn from Reports to, which
 * admins set (loops refused, call 4). Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function company(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const auth = await getViewerAuthContext();
  const userId = auth.userId;
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, slug, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!w || w.type !== "company" || !(a.isOwner || a.isMember)) return null;
  const s = (w.settings ?? {}) as { directory?: { viewers?: boolean }; staffGrowth?: { reportsTo?: ReportsTo }; company?: { offices?: Array<{ name: string }> } };
  return { userId, slug: w.slug, admin: a.isOwner || a.memberRole === "admin", viewer: !a.isOwner && a.memberRole === "viewer",
    viewersAllowed: s.directory?.viewers === true, reportsTo: (s.staffGrowth?.reportsTo ?? {}) as ReportsTo, offices: (s.company?.offices ?? []).map((o) => o.name) };
}

export type DirectoryPerson = {
  id: string; name: string; username: string | null; avatarUrl: string | null; title: string | null;
  teams: string[]; office: string | null; zone: string | null; hours: { from: string; to: string } | null;
  joined: string | null; reportsTo: string | null; askMeAbout: string[]; awayFrom: string | null; awayUntil: string | null; awayNow: boolean;
};

/** The Directory (call 1): members see everyone's cards; Viewers, if allowed, names and titles only. No email or phone. */
export async function readDirectoryAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx || (ctx.viewer && !ctx.viewersAllowed)) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; name: string | null; username: string | null; avatar_url: string | null; title: string | null; joined: string | null; prefs: unknown; skills: unknown }>(sql`
    SELECT p.id, p.full_name AS name, p.username, p.avatar_url, m.title, m.joined_at::text AS joined, m.view_prefs->'directory' AS prefs, p.skills
    FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer'
    ORDER BY coalesce(p.full_name, p.username) LIMIT 2000`));
  if (ctx.viewer) return { success: true as const, me: ctx.userId, admin: false, limited: true, offices: [], people: rows.map((r) => ({ id: r.id, name: r.name ?? r.username ?? "Someone", title: r.title })) };
  const [teams, away] = await Promise.all([
    db.execute<{ user_id: string; title: string }>(sql`
      SELECT m.user_id, w.title FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND w.status <> 'archived' AND w.visibility <> 'private' ORDER BY w.title`),
    // Who's out (call 5): only "Away until"; never the reason.
    db.execute<{ user_id: string; from: string; until: string; now: boolean }>(sql`
      SELECT user_id, min(starts_at)::text AS from, max(ends_at)::text AS until, bool_or(starts_at <= now()) AS now FROM org_member_away
      WHERE org_id = ${orgId}::uuid AND ends_at > now() AND starts_at <= now() + interval '14 days' GROUP BY user_id`),
  ]);
  const teamsOf = new Map<string, string[]>();
  for (const t of teams) teamsOf.set(t.user_id, [...(teamsOf.get(t.user_id) ?? []), t.title]);
  const awayOf = new Map(Array.from(away).map((a) => [a.user_id, a]));
  const ids = new Set(rows.map((r) => r.id));
  const people: DirectoryPerson[] = rows.map((r) => {
    const p = (r.prefs ?? {}) as { zone?: string; hours?: { from: string; to: string }; office?: string };
    const a = awayOf.get(r.id);
    const manager = ctx.reportsTo[r.id];
    return { id: r.id, name: r.name ?? r.username ?? "Someone", username: r.username, avatarUrl: r.avatar_url, title: r.title,
      teams: teamsOf.get(r.id) ?? [], office: p.office ?? null, zone: p.zone ?? null, hours: p.hours ?? null, joined: r.joined,
      reportsTo: manager && ids.has(manager) ? manager : null, askMeAbout: Array.isArray(r.skills) ? (r.skills as string[]).slice(0, 5) : [],
      awayFrom: a ? a.from.slice(0, 10) : null, awayUntil: a ? a.until.slice(0, 10) : null, awayNow: Boolean(a?.now) };
  });
  return { success: true as const, me: ctx.userId, admin: ctx.admin, limited: false, offices: ctx.offices, people, viewersAllowed: ctx.viewersAllowed,
    // Admins (edges): people whose manager left show "Reports to: no one" ⚠.
    managerLeft: ctx.admin ? Object.entries(ctx.reportsTo).filter(([p, m]) => ids.has(p) && !ids.has(m)).map(([p]) => p) : [] };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const mineSchema = z.object({ zone: z.string().max(60).nullable(), hours: z.object({ from: hhmm, to: hhmm }).strict().nullable(), office: z.string().max(60).nullable() }).strict();

/** My card's fields (call 2): time zone, working hours and office, on my company membership. */
export async function saveMyDirectoryAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (!ctx || ctx.viewer) return DENIED;
  const parsed = mineSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Use times like 09:00 and 17:30." };
  const d = parsed.data;
  if (d.zone) { try { new Intl.DateTimeFormat("en", { timeZone: d.zone }); } catch { return { success: false, error: "Use a time zone like Europe/London." }; } }
  if (d.hours && d.hours.from >= d.hours.to) return { success: false, error: "Working hours end after they start." };
  if (d.office && !ctx.offices.includes(d.office)) return { success: false, error: "Pick one of the company’s offices." };
  // ponytail: kept in the membership's per-person settings (view_prefs.directory); a column if it's ever queried across companies.
  await db.execute(sql`UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('directory', ${JSON.stringify(d)}::jsonb)
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`);
  return { success: true };
}

/** Reports to (call 4; admins): the chart and growth visibility follow. Loops are refused; the people involved are told. */
export async function setReportsToAction(orgId: string, person: string, manager: string | null): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (!ctx?.admin || !isLooseUuid(person) || (manager !== null && !isLooseUuid(manager))) return DENIED;
  if (manager === person) return { success: false, error: "Someone can’t report to themselves." };
  const staff = new Map(Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer'`)).map((r) => [r.id, r.name]));
  if (!staff.has(person) || (manager && !staff.has(manager))) return { success: false, error: "Pick people in the company." };
  const before = await db.transaction(async (tx) => {
    const [w] = Array.from(await tx.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid FOR UPDATE`));
    const growth = ((w?.settings as { staffGrowth?: Record<string, unknown> } | null)?.staffGrowth ?? {}) as { reportsTo?: ReportsTo };
    const map = { ...(growth.reportsTo ?? {}) };
    if (wouldLoop(map, person, manager)) return { loop: true as const };
    const old = map[person] ?? null;
    if (manager) map[person] = manager; else delete map[person];
    await tx.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('staffGrowth', ${JSON.stringify({ ...growth, reportsTo: map })}::jsonb) WHERE id = ${orgId}::uuid`);
    return { loop: false as const, old };
  });
  if (before.loop) return { success: false, error: `${staff.get(person)} can’t report to someone who reports to ${staff.get(person)}.` };
  if (before.old === manager) return { success: true };
  const title = manager ? `${staff.get(person)} now reports to ${staff.get(manager)}` : `${staff.get(person)} reports to no one now`;
  for (const to of new Set([person, before.old, manager].filter((x): x is string => Boolean(x)))) {
    await createNotification({ recipientUserId: to, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "important", title,
      href: `/org/${encodeURIComponent(ctx.slug ?? orgId)}?tab=members`, entityRefs: { projectId: orgId, projectSlug: ctx.slug },
      dedupeKey: `reports-to:${orgId}:${person}:${manager ?? "none"}:${Date.now()}` }).catch(() => undefined);
  }
  return { success: true };
}

/** Settings → Directory (admins): whether Viewers see the directory (names and titles only). */
export async function saveDirectorySettingsAction(orgId: string, input: { viewers: boolean }): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (!ctx?.admin || typeof input?.viewers !== "boolean") return DENIED;
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('directory', jsonb_build_object('viewers', ${input.viewers}::boolean)) WHERE id = ${orgId}::uuid`);
  return { success: true };
}
