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

/**
 * What's new (report 33.2 call 8, surfaces): the last 7 days' announcements and published handbook pages, up to 5, for
 * people inside. The live pinned announcement sits just above it on the Overview, so it isn't repeated here.
 * ponytail: announcements meant for some roles or teams show only to admins here; audience-aware listing if asked.
 */
export async function readWhatsNewAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx?.inside) return DENIED;
  const [posts, pages] = await Promise.all([
    db.execute<{ id: string; content: string; at: string }>(sql`
      SELECT id, content, created_at::text AS at FROM workspace_updates
      WHERE workspace_id = ${orgId}::uuid AND deleted_at IS NULL AND update_type = 'announcement' AND created_at > now() - interval '7 days'
        AND NOT (is_pinned AND (pinned_until IS NULL OR pinned_until > now()))
        AND (${ctx.admin} OR audience IS NULL OR audience = '{}'::jsonb)
      ORDER BY created_at DESC LIMIT 5`),
    db.execute<{ id: string; slug: string; filename: string; at: string; versions: number }>(sql`
      SELECT d.id, d.slug, d.filename, d.settings->'org'->>'publishedAt' AS at,
        (SELECT count(*)::int FROM workspace_document_versions v WHERE v.doc_id = d.id) AS versions
      FROM workspace_documents d
      WHERE d.workspace_id = ${orgId}::uuid AND d.settings->'org'->>'lifecycle' = 'published'
        AND (CASE WHEN d.settings->'org'->>'publishedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN (d.settings->'org'->>'publishedAt')::timestamptz END) > now() - interval '7 days'
      ORDER BY 3 DESC LIMIT 5`),
  ]);
  // Only pages this viewer can open: the same list Documents shows them (visibility and drafts already applied).
  const { listWorkspaceDocsAction } = await import("@/app/actions/workspace/doc");
  const listed = await listWorkspaceDocsAction(orgId);
  const visible = new Set(listed.success ? listed.docs.map((d) => d.id) : []);
  const items = [
    ...Array.from(posts).map((p) => ({ kind: "announcement" as const, id: p.id, text: p.content.replace(/[#*_>`]/g, "").trim().split("\n")[0]!.slice(0, 140), at: p.at, slug: null })),
    ...Array.from(pages).filter((p) => visible.has(p.id)).map((p) => ({ kind: Number(p.versions) > 1 ? "updated" as const : "new" as const, id: p.slug, text: p.filename.replace(/\.(md|mdx|markdown)$/i, ""), at: p.at, slug: p.slug })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
  return { success: true as const, items };
}

/** Needs review (report 33.2 views): handbook pages past Review by, grouped by owner — admins only. */
export async function readNeedsReviewAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx?.admin) return DENIED;
  const today = new Date().toISOString().slice(0, 10);
  const rows = Array.from(await db.execute<{ slug: string; filename: string; owner: string | null; review_by: string }>(sql`
    SELECT d.slug, d.filename, coalesce(p.full_name, p.username) AS owner, d.settings->'org'->>'reviewBy' AS review_by
    FROM workspace_documents d LEFT JOIN profiles p ON p.id::text = d.settings->'org'->>'owner'
    WHERE d.workspace_id = ${orgId}::uuid AND d.settings->'org'->>'reviewBy' <= ${today}
    ORDER BY 3 NULLS LAST, 4 LIMIT 100`));
  const byOwner = new Map<string, Array<{ slug: string; title: string; reviewBy: string }>>();
  for (const r of rows) {
    const k = r.owner ?? "No owner";
    byOwner.set(k, [...(byOwner.get(k) ?? []), { slug: r.slug, title: r.filename.replace(/\.(md|mdx|markdown)$/i, ""), reviewBy: r.review_by }]);
  }
  return { success: true as const, total: rows.length, owners: [...byOwner.entries()].map(([owner, pages]) => ({ owner, pages })) };
}

/**
 * From teams (report 33.2 call 7, B4.1e): pages a team marked Company-wide, readable by everyone in the company. A team's
 * other pages stay in the team. A page needs a published version; a leaders-only page never leaves its team.
 */
const companyWideWhere = (orgId: string) => sql`w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND d.settings->>'companyWide' = w.parent_id::text
  AND d.published_version_id IS NOT NULL AND coalesce(d.settings->>'visibilityOverride', 'inherit_workspace') <> 'leaders_only'`;

export async function readCompanyWidePagesAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx?.inside) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; filename: string; team: string; archived: boolean }>(sql`
    SELECT d.id, d.filename, w.title AS team, (w.status = 'archived') AS archived
    FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id WHERE ${companyWideWhere(orgId)} ORDER BY w.title, d.filename LIMIT 200`));
  return { success: true as const, pages: rows.map((r) => ({ id: r.id, title: r.filename.replace(/\.(md|mdx|markdown)$/i, ""), team: r.team, archived: Boolean(r.archived) })) };
}

export async function readCompanyWidePageAction(orgId: string, docId: string) {
  const ctx = await company(orgId);
  if (!ctx?.inside || !isLooseUuid(docId)) return DENIED;
  const [row] = Array.from(await db.execute<{ filename: string; team: string; archived: boolean; content: string }>(sql`
    SELECT d.filename, w.title AS team, (w.status = 'archived') AS archived, v.content
    FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id JOIN workspace_document_versions v ON v.id = d.published_version_id
    WHERE d.id = ${docId}::uuid AND ${companyWideWhere(orgId)}`));
  if (!row) return DENIED;
  return { success: true as const, title: row.filename.replace(/\.(md|mdx|markdown)$/i, ""), team: row.team, archived: Boolean(row.archived), content: row.content };
}
