import "server-only";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { readLabSettings, readPosition } from "@/lib/organizations/lab";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

// Report 35.6 (plan B6.5b–c): who may see a person's progress, supervision, reviews and plan. Server only.

export async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; owner: string; slug: string | null; reports: Record<string, string> | null }>(sql`
    SELECT org_type AS type, org_settings AS settings, owner_id AS owner, slug, org_settings->'staffGrowth'->'reportsTo' AS reports
    FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, owner: w.owner, slug: w.slug ?? orgId, pi: a.isOwner, admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, blocked: Boolean(a.writeBlocked),
    settings: readLabSettings(w.settings), reports: w.reports ?? {} };
}
export type Ctx = NonNullable<Awaited<ReturnType<typeof lab>>>;

/**
 * A person's record and who supervises them. Security review: a supervisor or co-supervisor counts only while they're
 * still an active PI or Researcher here; otherwise the PI is the supervisor (layer 12) and the co-supervisor lapses.
 */
export async function personOf(ctx: Ctx, orgId: string, userId: string) {
  const named = ctx.reports[userId] ?? null;
  const [p] = Array.from(await db.execute<{ start: string; part_time: boolean; co: string | null; weeks: number; name: string | null; prefs: unknown; sup_active: boolean }>(sql`
    SELECT lp.start_date::text AS start, lp.part_time, lp.supervision_weeks AS weeks, coalesce(pr.full_name, pr.username) AS name, m.view_prefs AS prefs,
      CASE WHEN EXISTS (SELECT 1 FROM workspace_members c WHERE c.workspace_id = lp.org_id AND c.user_id = lp.co_supervisor_id AND c.role IN ('owner', 'admin') AND c.completed_at IS NULL)
        THEN lp.co_supervisor_id END AS co,
      EXISTS (SELECT 1 FROM workspace_members s WHERE s.workspace_id = lp.org_id AND s.user_id::text = ${named} AND s.role IN ('owner', 'admin') AND s.completed_at IS NULL) AS sup_active
    FROM lab_progress lp JOIN profiles pr ON pr.id = lp.user_id LEFT JOIN workspace_members m ON m.workspace_id = lp.org_id AND m.user_id = lp.user_id
    WHERE lp.org_id = ${orgId}::uuid AND lp.user_id = ${userId}::uuid`));
  if (!p) return null;
  const supervisor = named && p.sup_active ? named : ctx.owner;
  return { start: p.start, part_time: p.part_time, co: p.co, weeks: p.weeks, name: p.name, supervisor, position: readPosition(p.prefs).position };
}
export const supervises = (ctx: Ctx, person: { supervisor: string; co: string | null }) => ctx.userId === person.supervisor || ctx.userId === person.co;

/**
 * B6.5c: any active member of the research lab, Viewers included (committee members are often Viewers). Security review:
 * the same read rule as everywhere else, and `blocked` when the lab takes no changes.
 */
export async function labMember(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [m] = Array.from(await db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok FROM workspace_members m JOIN workspaces o ON o.id = m.workspace_id AND o.kind = 'organization' AND o.org_type = 'research' AND o.deleted_at IS NULL
    WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL`));
  return m && a.canRead ? { userId, blocked: Boolean(a.writeBlocked) } : null;
}
