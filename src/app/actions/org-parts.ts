"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { kitById, kitReady, PARTS, partsOn, readyKits, type PartId } from "@/lib/organizations/kits";
import { isLooseUuid } from "@/lib/validations/uuid";
import { getViewerAuthContext } from "@/lib/server/viewer-context";

/**
 * Report 37.2 (plan B8.4a, X1 call 5): Settings → Workflows for an Other organization. Owner and admins switch parts on
 * (one at a time, or all of a kit's at once with Add from a kit) and off; turning a part off hides it and keeps its data,
 * and turning it on again brings everything back. Only parts that work in an Other organization are offered.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function org(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "other" || !a.canRead || !(a.isOwner || a.memberRole === "admin") || a.writeBlocked) return null;
  return { userId, w };
}

/** "Has data" when off: whether turning it on again brings something back. */
async function hasData(orgId: string, p: PartId) {
  const q = p === "volunteers" ? sql`SELECT 1 FROM tasks WHERE workspace_id = ${orgId}::uuid AND type_fields->>'kind' = 'shift' LIMIT 1`
    : p === "programs" ? sql`SELECT 1 FROM workspaces WHERE parent_id = ${orgId}::uuid AND org_settings ? 'program' LIMIT 1`
    : p === "fixedTime" ? sql`SELECT 1 FROM workspaces WHERE id = ${orgId}::uuid AND org_settings ? 'fixedTime'` : null;
  return q ? Array.from(await db.execute(q)).length > 0 : false;
}

/** Settings → Workflows (owner and admins): every part that works here, on or off ("has data" when off), and the kits to add from. */
export async function readPartsAction(orgId: string) {
  const ctx = await org(orgId);
  if (!ctx) return DENIED;
  const on = partsOn(ctx.w.settings);
  const kit = (ctx.w.settings as { kit?: string } | null)?.kit ?? null;
  const parts = [];
  for (const p of Object.values(PARTS).filter((x) => x.ready)) parts.push({ ...p, on: on.includes(p.id), hasData: !on.includes(p.id) && (await hasData(orgId, p.id)) });
  return { success: true as const, kit, parts, kits: readyKits().filter((k) => k.parts.length).map((k) => ({ id: k.id, name: k.name, parts: k.parts.map((p) => PARTS[p].name) })) };
}

/** Switch a part on or off. On twice is refused (it's already on); off hides it and keeps its data. */
export async function setPartAction(orgId: string, part: string, on: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx || !(part in PARTS) || !PARTS[part as PartId].ready || typeof on !== "boolean") return DENIED;
  const now = partsOn(ctx.w.settings);
  if (on && now.includes(part as PartId)) return { success: false, error: "That part is already on." };
  const next = on ? [...now, part as PartId] : now.filter((p) => p !== part);
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{parts}', jsonb_build_object('on', ${JSON.stringify(next)}::jsonb)) WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** Add from a kit: switch on every part of a ready kit that isn't on yet. */
export async function addKitPartsAction(orgId: string, kitId: string): Promise<{ success: true; added: number } | Failure> {
  const ctx = await org(orgId);
  const kit = kitById(kitId);
  if (!ctx || !kit || !kitReady(kit)) return DENIED;
  const now = partsOn(ctx.w.settings);
  const add = kit.parts.filter((p) => !now.includes(p));
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{parts}', jsonb_build_object('on', ${JSON.stringify([...now, ...add])}::jsonb)) WHERE id = ${orgId}::uuid`);
  return { success: true, added: add.length };
}
