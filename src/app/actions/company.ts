"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 33.2 calls 5, 7 (plan B4.1c): a company's About adds Values and Offices (members-only unless switched to Show
 * to visitors), and Our teams — a card per team workspace with its About line, its manager and member count, for
 * people inside the company. Owners and admins edit Values and Offices.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
export type CompanyValue = { name: string; line: string };
export type CompanyOffice = { name: string; city: string; zone: string };
type CompanySettings = { values: CompanyValue[]; offices: CompanyOffice[]; publicValues: boolean; publicOffices: boolean };

async function company(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown }>(sql`SELECT org_type AS type, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!w || w.type !== "company" || !a.canRead) return null;
  const c = ((w.settings as { company?: Partial<CompanySettings> } | null)?.company ?? {}) as Partial<CompanySettings>;
  return { userId, admin: a.isOwner || a.memberRole === "admin", inside: a.isOwner || a.isMember,
    settings: { values: Array.isArray(c.values) ? c.values : [], offices: Array.isArray(c.offices) ? c.offices : [], publicValues: c.publicValues === true, publicOffices: c.publicOffices === true } };
}

/** Values, Offices and Our teams as this viewer may see them. */
export async function readCompanyAboutAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx) return DENIED;
  const s = ctx.settings;
  const teams = ctx.inside ? Array.from(await db.execute<{ id: string; title: string; slug: string | null; line: string | null; manager: string | null; members: number }>(sql`
    SELECT w.id, w.title, w.slug, w.description AS line, coalesce(p.full_name, p.username) AS manager,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS members
    FROM workspaces w LEFT JOIN profiles p ON p.id = w.owner_id
    WHERE w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND w.status <> 'archived'
      AND (${ctx.admin} OR w.visibility <> 'private' OR EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = w.id AND pm.user_id = ${ctx.userId ?? null}::uuid))
    ORDER BY w.title LIMIT 100`)).map((t) => ({ ...t, members: Number(t.members) })) : [];
  return { success: true as const, admin: ctx.admin, inside: ctx.inside,
    values: ctx.inside || s.publicValues ? s.values : [], offices: ctx.inside || s.publicOffices ? s.offices : [],
    publicValues: s.publicValues, publicOffices: s.publicOffices, teams };
}

const schema = z.object({
  values: z.array(z.object({ name: z.string().trim().min(1, "Name each value.").max(60), line: z.string().trim().max(200) }).strict()).max(8, "Up to 8 values."),
  offices: z.array(z.object({ name: z.string().trim().min(1, "Name each office.").max(60), city: z.string().trim().max(60), zone: z.string().trim().max(60) }).strict()).max(20, "Up to 20 offices."),
  publicValues: z.boolean(),
  publicOffices: z.boolean(),
}).strict();

/** Settings → Company: Values and Offices, and whether each shows to visitors. Owners and admins. */
export async function saveCompanyAboutAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (!ctx?.admin) return DENIED;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the values and offices." };
  const bad = parsed.data.offices.find((o) => o.zone && !(() => { try { new Intl.DateTimeFormat("en", { timeZone: o.zone }); return true; } catch { return false; } })());
  if (bad) return { success: false, error: "Use a time zone like Europe/London." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('company', ${JSON.stringify(parsed.data)}::jsonb), updated_at = now() WHERE id = ${orgId}::uuid`);
  return { success: true };
}
