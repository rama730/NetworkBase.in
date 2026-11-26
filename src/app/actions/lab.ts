"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { labSettingsSchema, positionSchema, readLabSettings, readPosition } from "@/lib/organizations/lab";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.2 (plan B6.1a, R1): a research lab's home, People by position and Settings → Lab. Positions are labels on
 * memberships (view_prefs.lab) set by the PI and Researchers; they never change permissions (call 2). Members (not
 * viewers) read People; visitors never do. Contact is Message and an office-hours line, no email or phone (call 7).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; owner: string; description: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, owner_id AS owner, description, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  // Review: an archived, suspended or deleting lab reads but takes no changes.
  return { userId, owner: w.owner, description: w.description, admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, settings: readLabSettings(w.settings) };
}

async function stillLead(orgId: string, userId: string | null) {
  if (!userId) return false;
  const [r] = Array.from(await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role IN ('owner', 'admin') AND completed_at IS NULL) AS ok`));
  return Boolean(r?.ok);
}

export type LabPerson = { id: string; name: string; username: string | null; avatarUrl: string | null; role: "pi" | "researcher" | "member";
  position: string | null; startYear: number | null; supervisor: string | null; interests: string[]; workspaces: Array<{ id: string; title: string; slug: string | null }> };

/** Members → People (members): everyone by position, with interests and the lab workspaces they're in. */
export async function readLabPeopleAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; name: string | null; username: string | null; avatar_url: string | null; role: string; prefs: unknown; interests: unknown; workspaces: unknown }>(sql`
    SELECT p.id, p.full_name AS name, p.username, p.avatar_url, CASE WHEN w.owner_id = m.user_id THEN 'owner' ELSE m.role END AS role, m.view_prefs AS prefs, p.interests,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'slug', c.slug) ORDER BY c.title), '[]'::jsonb) FROM workspaces c
        JOIN workspace_members cm ON cm.workspace_id = c.id AND cm.user_id = m.user_id WHERE c.parent_id = w.id AND c.deleted_at IS NULL AND c.status <> 'archived'
          -- Review: members see a person's open workspaces (or ones they're in); the PI and Researchers see all.
          AND (${ctx.admin} OR (c.visibility <> 'private' AND c.status <> 'draft')
            OR EXISTS (SELECT 1 FROM workspace_members v WHERE v.workspace_id = c.id AND v.user_id = ${ctx.userId}::uuid))) AS workspaces
    FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND p.deleted_at IS NULL
      AND (m.user_id = ${ctx.userId}::uuid OR NOT app_private.blocked_between(${ctx.userId}::uuid, m.user_id))
    ORDER BY coalesce(p.full_name, p.username) LIMIT 1000`));
  const [st] = Array.from(await db.execute<{ reports: Record<string, string> | null }>(sql`SELECT org_settings->'staffGrowth'->'reportsTo' AS reports FROM workspaces WHERE id = ${orgId}::uuid`));
  const people: LabPerson[] = rows.map((r) => ({ supervisor: st?.reports?.[r.id] ?? null,
    id: r.id, name: r.name ?? r.username ?? "Someone", username: r.username, avatarUrl: r.avatar_url,
    role: r.role === "owner" ? "pi" : r.role === "admin" ? "researcher" : "member", ...readPosition(r.prefs),
    interests: Array.isArray(r.interests) ? (r.interests as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 5) : [],
    workspaces: (Array.isArray(r.workspaces) ? r.workspaces as LabPerson["workspaces"] : []).slice(0, 6),
  }));
  return { success: true as const, admin: ctx.admin, me: ctx.userId, positions: ctx.settings.positions, people };
}

/** The PI and Researchers set a person's position and start year (call 2): a label only, merged into view_prefs. */
export async function setLabPositionAction(orgId: string, userId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = positionSchema.safeParse(input);
  if (!ctx?.admin || !isLooseUuid(userId) || !parsed.success) return DENIED;
  if (parsed.data.position && !ctx.settings.positions.some((p) => p.id === parsed.data.position)) return { success: false, error: "Pick one of the lab’s positions." };
  const done = await db.execute(sql`
    UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('lab', coalesce(view_prefs->'lab', '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb)
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role <> 'viewer' RETURNING user_id`);
  return Array.from(done).length ? { success: true } : DENIED;
}

/** The supervisor (the PI or a Researcher) for one person: Reports to under the hood, so Start here and the plans use it. */
export async function setLabSupervisorAction(orgId: string, userId: string, supervisorId: string | null): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx?.admin || !isLooseUuid(userId) || (supervisorId !== null && !isLooseUuid(supervisorId))) return DENIED;
  if (supervisorId === userId) return { success: false, error: "Pick someone else as the supervisor." };
  if (supervisorId && supervisorId !== ctx.owner && !(await stillLead(orgId, supervisorId))) return { success: false, error: "A supervisor is the PI or one of the lab’s Researchers." };
  const [inLab] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role <> 'viewer'`));
  if (!inLab) return DENIED;
  await db.execute(supervisorId
    ? sql`UPDATE workspaces SET org_settings = jsonb_set(jsonb_set(coalesce(org_settings, '{}'::jsonb), '{staffGrowth}', coalesce(org_settings->'staffGrowth', '{}'::jsonb)), '{staffGrowth,reportsTo}',
        coalesce(org_settings->'staffGrowth'->'reportsTo', '{}'::jsonb) || jsonb_build_object(${userId}::text, ${supervisorId}::text)) WHERE id = ${orgId}::uuid`
    : sql`UPDATE workspaces SET org_settings = org_settings #- ${`{staffGrowth,reportsTo,${userId}}`}::text[] WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** The lab home (call 1): welcome, Reach the PI with office hours, and People · Projects counts. */
export async function readLabHomeAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  // The chosen Researcher while they still are one (not completed), else the PI; nobody the viewer is in a block with.
  const contactId = (await stillLead(orgId, ctx.settings.contactId)) ? ctx.settings.contactId! : ctx.owner;
  const [c] = Array.from(await db.execute<{ name: string | null; username: string | null; people: number; projects: number; blocked: boolean }>(sql`
    SELECT (SELECT p.full_name FROM profiles p WHERE p.id = ${contactId}::uuid AND p.deleted_at IS NULL) AS name,
      (SELECT p.username FROM profiles p WHERE p.id = ${contactId}::uuid AND p.deleted_at IS NULL) AS username,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer') AS people,
      (SELECT count(*)::int FROM workspaces c WHERE c.parent_id = ${orgId}::uuid AND c.deleted_at IS NULL AND c.status <> 'archived') AS projects,
      app_private.blocked_between(${ctx.userId}::uuid, ${contactId}::uuid) AS blocked`));
  const showContact = c && !c.blocked && (c.name || c.username) && contactId !== ctx.userId;
  return { success: true as const, admin: ctx.admin, welcome: ctx.description, officeHours: ctx.settings.officeHours || null,
    contact: showContact ? { id: contactId, name: c.name ?? c.username ?? "the PI" } : null, people: c?.people ?? 0, projects: c?.projects ?? 0 };
}

/** Settings → Lab (PI and Researchers). */
export async function readLabSettingsAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx?.admin) return DENIED;
  const leads = Array.from(await db.execute<{ id: string; name: string | null; username: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role IN ('owner', 'admin') AND m.completed_at IS NULL ORDER BY coalesce(p.full_name, p.username) LIMIT 50`));
  const settings = leads.some((l) => l.id === ctx.settings.contactId) ? ctx.settings : { ...ctx.settings, contactId: null };
  return { success: true as const, settings, owner: ctx.owner, leads: leads.map((l) => ({ id: l.id, name: l.name ?? l.username ?? "Someone" })) };
}

export async function saveLabSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx?.admin) return DENIED;
  const parsed = labSettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the lab settings: up to 12 positions, each named." };
  const d = parsed.data;
  if (new Set(d.positions.map((p) => p.id)).size !== d.positions.length) return { success: false, error: "Check the lab settings: up to 12 positions, each named." };
  if (/@|\+?\d[\d\s-]{7,}/.test(d.officeHours)) return { success: false, error: "Office hours is a time and place, not an email or phone number." };
  if (d.contactId && d.contactId !== ctx.owner && !(await stillLead(orgId, d.contactId))) return { success: false, error: "Reach the PI goes to the PI or one of the lab’s Researchers." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('lab', ${JSON.stringify(d)}::jsonb), updated_at = now() WHERE id = ${orgId}::uuid`);
  return { success: true };
}
