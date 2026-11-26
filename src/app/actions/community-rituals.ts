"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { nextAt, repeatWords, ritualSchema, type Ritual } from "@/lib/organizations/rituals";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 34.5 (plan B5.4d, M4 calls 7–8): Sprints → Rituals. Organisers add Threads (Weekly wins…) and Ask me anything,
 * each with a repeat, a host who is a member, and a prompt; they post on schedule as Updates naming the host. Members
 * see what's coming. Kept in org_settings.community.rituals; saves lock the row so the hourly job's "posted" mark holds.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function community(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; tz: string | null }>(sql`SELECT org_type AS type, time_zone AS tz FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "community" || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, tz: w.tz || null, organiser: a.isOwner || a.memberRole === "admin" };
}

export async function readRitualsAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx) return DENIED;
  const [w] = Array.from(await db.execute<{ rituals: Ritual[] | null }>(sql`SELECT org_settings->'community'->'rituals' AS rituals FROM workspaces WHERE id = ${orgId}::uuid`));
  const rituals = Array.isArray(w?.rituals) ? w.rituals : [];
  const ids = [...new Set(rituals.map((r) => r.hostId))].filter((id) => isLooseUuid(id));
  const names = ids.length ? new Map(Array.from(await db.execute<{ id: string; name: string | null; username: string | null }>(sql`
    SELECT id, full_name AS name, username FROM profiles WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).map((p) => [p.id, p.name ?? p.username ?? "Someone"])) : new Map<string, string>();
  const now = new Date();
  return { success: true as const, canEdit: ctx.organiser, rituals: rituals.map((r) => ({ ...r, host: names.get(r.hostId) ?? "Former member", repeat: repeatWords(r), next: r.paused ? null : nextAt(r, now, ctx.tz) })) };
}

/** Add or change a ritual (organisers); the host must be a member. A changed schedule never re-posts what already went out. */
export async function saveRitualAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  const parsed = ritualSchema.safeParse(input);
  if (!ctx?.organiser) return DENIED;
  if (!parsed.success) return { success: false, error: "A ritual needs a name, a repeat, a time and a host." };
  const r = parsed.data;
  return db.transaction(async (tx) => {
    const [host] = Array.from(await tx.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${r.hostId}::uuid AND role IN ('member', 'admin', 'owner')`));
    if (!host) return { success: false as const, error: "The host has to be a member of the community." };
    const [w] = Array.from(await tx.execute<{ rituals: Ritual[] | null }>(sql`SELECT org_settings->'community'->'rituals' AS rituals FROM workspaces WHERE id = ${orgId}::uuid FOR UPDATE`));
    const list = Array.isArray(w?.rituals) ? w.rituals : [];
    const old = list.find((x) => x.id === r.id);
    if (!old && list.length >= 20) return { success: false as const, error: "A community can have up to 20 rituals." };
    // Security review: posts go out as this organiser, naming the host in the text; never as the host themselves.
    const next: Ritual = { ...r, lastPostedFor: old?.lastPostedFor ?? null, createdAt: old?.createdAt ?? new Date().toISOString(), savedBy: ctx.userId,
      resumedAt: old?.paused && !r.paused ? new Date().toISOString() : old?.resumedAt ?? null };
    const rituals = old ? list.map((x) => (x.id === r.id ? next : x)) : [...list, next];
    await tx.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb)
      || jsonb_build_object('rituals', ${JSON.stringify(rituals)}::jsonb)), updated_at = now() WHERE id = ${orgId}::uuid`);
    return { success: true as const };
  });
}

/** Remove a ritual (organisers). What it already posted stays in Updates. */
export async function removeRitualAction(orgId: string, ritualId: string): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.organiser || typeof ritualId !== "string") return DENIED;
  await db.transaction(async (tx) => {
    const [w] = Array.from(await tx.execute<{ rituals: Ritual[] | null }>(sql`SELECT org_settings->'community'->'rituals' AS rituals FROM workspaces WHERE id = ${orgId}::uuid FOR UPDATE`));
    const rituals = (Array.isArray(w?.rituals) ? w.rituals : []).filter((x) => x.id !== ritualId);
    await tx.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb)
      || jsonb_build_object('rituals', ${JSON.stringify(rituals)}::jsonb)), updated_at = now() WHERE id = ${orgId}::uuid`);
  });
  return { success: true };
}
