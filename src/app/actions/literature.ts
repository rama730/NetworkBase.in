"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { sourceKey } from "@/lib/workflows/literature";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.6 W5 (plan B1.8b): a thesis workspace's literature list. Insiders read it (thesis work is private); people
 * who can change the workspace add, edit and remove sources. Duplicates (same DOI or title) are skipped, not merged.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const LIMIT = 2000;

async function access(projectId: string, write: boolean) {
  const { userId } = await getViewerAuthContext();
  if (!userId || !isLooseUuid(projectId)) return null;
  const a = await getWorkspaceAccessById(projectId, userId);
  // Security review (B6.4a): a lab's own sources live on the organization and go through lab-library's rules only.
  if (a.project?.kind === "organization") return null;
  if (!(a.isOwner || a.isMember) || !a.canRead || (write && !a.canWrite)) return null;
  return { userId };
}

export type LiteratureRow = { id: string; title: string; authors: string | null; year: number | null; link: string | null; doi: string | null; keyIssues: string[]; summary: string | null; createdAt: string;
  /** B6.4c: the lab's source this row points at, and a systematic review's screening. */
  labSourceId: string | null; screening: Screening | null; excludeReason: string | null };
type Screening = "found" | "screened" | "included" | "excluded";

/** B6.4c: the research lab this workspace sits in, when the viewer is one of its active members (they may use its Library). */
async function labOf(projectId: string, userId: string) {
  const [l] = Array.from(await db.execute<{ id: string; systematic: boolean }>(sql`
    SELECT o.id, coalesce((w.workflow_settings->'literature'->>'systematic')::boolean, false) AS systematic
    FROM workspaces w JOIN workspaces o ON o.id = w.parent_id AND o.kind = 'organization' AND o.org_type = 'research' AND o.deleted_at IS NULL
    WHERE w.id = ${projectId}::uuid AND (o.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL))`));
  return l ?? null;
}

export async function readLiteratureAction(projectId: string) {
  try {
    const who = await access(projectId, false);
    if (!who) return DENIED;
    const rows = Array.from(await db.execute<{ id: string; title: string; authors: string | null; year: number | null; link: string | null; doi: string | null; key_issues: string[]; summary: string | null; created_at: string;
      lab_source_id: string | null; screening: Screening | null; exclude_reason: string | null }>(sql`
      SELECT id, title, authors, year, link, doi, to_jsonb(key_issues) AS key_issues, summary, created_at::text, lab_source_id, screening, exclude_reason
      FROM literature_sources WHERE workspace_id = ${projectId}::uuid ORDER BY created_at DESC LIMIT ${LIMIT}`));
    const lab = await labOf(projectId, who.userId);
    const [w] = Array.from(await db.execute<{ systematic: boolean }>(sql`SELECT coalesce((workflow_settings->'literature'->>'systematic')::boolean, false) AS systematic FROM workspaces WHERE id = ${projectId}::uuid`));
    return { success: true as const, lab: lab ? { orgId: lab.id } : null, systematic: Boolean(w?.systematic),
      rows: rows.map((r): LiteratureRow => ({ id: r.id, title: r.title, authors: r.authors, year: r.year, link: r.link, doi: r.doi, keyIssues: r.key_issues ?? [], summary: r.summary, createdAt: r.created_at,
        labSourceId: r.lab_source_id, screening: r.screening, excludeReason: r.exclude_reason })) };
  } catch (error) {
    logger.warn("literature.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the literature." };
  }
}

const sourceInput = z.object({
  title: z.string().trim().min(1, "Every source needs a title.").max(500),
  authors: z.string().trim().max(1000).nullable().optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  link: z.string().trim().max(1000).regex(/^https?:\/\//, "Links start with https://.").nullable().optional().or(z.literal("")),
  doi: z.string().trim().max(200).nullable().optional(),
  keyIssues: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  summary: z.string().trim().max(5000).nullable().optional(),
});

/** Add one or many sources (a BibTeX paste gives many); ones already in the list are skipped and counted. */
export async function addSourcesAction(projectId: string, input: unknown[]): Promise<{ success: true; added: number; skipped: number } | Failure> {
  const who = await access(projectId, true);
  if (!who) return DENIED;
  const parsed = z.array(sourceInput).max(500).safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the sources." };
  const existing = Array.from(await db.execute<{ title: string; doi: string | null }>(sql`SELECT title, doi FROM literature_sources WHERE workspace_id = ${projectId}::uuid`));
  if (existing.length + parsed.data.length > LIMIT) return { success: false, error: `A literature list holds up to ${LIMIT} sources.` };
  const seen = new Set(existing.map(sourceKey));
  // B6.4c: with a systematic review on, new sources start at Found.
  const [w] = Array.from(await db.execute<{ systematic: boolean }>(sql`SELECT coalesce((workflow_settings->'literature'->>'systematic')::boolean, false) AS systematic FROM workspaces WHERE id = ${projectId}::uuid`));
  let added = 0;
  for (const s of parsed.data) {
    const key = sourceKey({ title: s.title, doi: s.doi ?? null });
    if (seen.has(key)) continue;
    seen.add(key);
    await db.execute(sql`
      INSERT INTO literature_sources (workspace_id, title, authors, year, link, doi, key_issues, summary, added_by, screening)
      VALUES (${projectId}::uuid, ${s.title}, ${s.authors || null}, ${s.year ?? null}, ${s.link || null}, ${s.doi || null}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.keyIssues ?? [])}::jsonb)), ${s.summary || null}, ${who.userId}::uuid,
        ${w?.systematic ? "found" : null})`);
    added += 1;
  }
  return { success: true, added, skipped: parsed.data.length - added };
}

export async function updateSourceAction(projectId: string, id: string, input: unknown): Promise<{ success: true } | Failure> {
  if (!(await access(projectId, true)) || !isLooseUuid(id)) return DENIED;
  const parsed = sourceInput.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the source." };
  const s = parsed.data;
  const rows = Array.from(await db.execute(sql`
    UPDATE literature_sources SET title = ${s.title}, authors = ${s.authors || null}, year = ${s.year ?? null}, link = ${s.link || null}, doi = ${s.doi || null},
      key_issues = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.keyIssues ?? [])}::jsonb)), summary = ${s.summary || null}
    WHERE id = ${id}::uuid AND workspace_id = ${projectId}::uuid RETURNING id`));
  return rows.length ? { success: true } : DENIED;
}

export async function deleteSourceAction(projectId: string, id: string): Promise<{ success: true } | Failure> {
  if (!(await access(projectId, true)) || !isLooseUuid(id)) return DENIED;
  await db.execute(sql`DELETE FROM literature_sources WHERE id = ${id}::uuid AND workspace_id = ${projectId}::uuid`);
  return { success: true };
}

/**
 * B6.4c (report 35.4 call 1): link a thesis row to the lab's Library — the lab's source with the same DOI or title, or a
 * new one made from the row. No copies: the row points at the lab's record. Writers here who are active in the lab.
 */
export async function linkToLabLibraryAction(projectId: string, ids: string[]): Promise<{ success: true; linked: number } | Failure> {
  const who = await access(projectId, true);
  if (!who || !Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => isLooseUuid(id))) return DENIED;
  const lab = await labOf(projectId, who.userId);
  if (!lab) return { success: false, error: "Only people in the lab add to its Library." };
  const linked = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-library:${lab.id}`}))`);
    const labRows = Array.from(await tx.execute<{ id: string; title: string; doi: string | null }>(sql`SELECT id, title, doi FROM literature_sources WHERE workspace_id = ${lab.id}::uuid`));
    const byKey = new Map<string, string>();
    for (const r of labRows) { byKey.set(sourceKey({ title: r.title, doi: null }), r.id); if (r.doi) byKey.set(sourceKey(r), r.id); }
    const mine = Array.from(await tx.execute<{ id: string; title: string; authors: string | null; year: number | null; link: string | null; doi: string | null }>(sql`
      SELECT id, title, authors, year, link, doi FROM literature_sources WHERE workspace_id = ${projectId}::uuid AND lab_source_id IS NULL AND id = ANY(${`{${ids.join(",")}}`}::uuid[]) FOR UPDATE`));
    if (labRows.length + mine.length > 5000) return -1;
    let n = 0;
    for (const r of mine) {
      let target = (r.doi ? byKey.get(sourceKey(r)) : undefined) ?? byKey.get(sourceKey({ title: r.title, doi: null }));
      if (!target) {
        const [made] = Array.from(await tx.execute<{ id: string }>(sql`
          INSERT INTO literature_sources (workspace_id, title, authors, year, link, doi, added_by) VALUES (${lab.id}::uuid, ${r.title}, ${r.authors}, ${r.year}, ${r.link}, ${r.doi}, ${who.userId}::uuid) RETURNING id`));
        target = made!.id;
        byKey.set(sourceKey({ title: r.title, doi: null }), target);
        if (r.doi) byKey.set(sourceKey(r), target);
      }
      await tx.execute(sql`UPDATE literature_sources SET lab_source_id = ${target}::uuid WHERE id = ${r.id}::uuid`);
      n += 1;
    }
    return n;
  });
  if (linked < 0) return { success: false, error: "The library holds up to 5,000 sources." };
  return { success: true, linked };
}

/** B6.4c (call 5): a systematic review in this workspace — on puts every unscreened row at Found. */
export async function setSystematicReviewAction(projectId: string, on: boolean): Promise<{ success: true } | Failure> {
  if (typeof on !== "boolean" || !(await access(projectId, true))) return DENIED;
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE workspaces SET workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{literature}', coalesce(workflow_settings->'literature', '{}'::jsonb) || jsonb_build_object('systematic', ${on}::boolean)) WHERE id = ${projectId}::uuid`);
    if (on) await tx.execute(sql`UPDATE literature_sources SET screening = 'found' WHERE workspace_id = ${projectId}::uuid AND screening IS NULL`);
  });
  return { success: true };
}

const screenSchema = z.object({ state: z.enum(["found", "screened", "included", "excluded"]), reason: z.string().trim().max(300) }).strict();

/** B6.4c: move a source through screening; Excluded needs a reason. */
export async function setScreeningAction(projectId: string, id: string, input: unknown): Promise<{ success: true } | Failure> {
  const parsed = screenSchema.safeParse(input);
  if (!parsed.success || !isLooseUuid(id) || !(await access(projectId, true))) return DENIED;
  const { state, reason } = parsed.data;
  if (state === "excluded" && !reason) return { success: false, error: "Say why it’s excluded." };
  const rows = Array.from(await db.execute(sql`UPDATE literature_sources SET screening = ${state}, exclude_reason = ${state === "excluded" ? reason : null}
    WHERE id = ${id}::uuid AND workspace_id = ${projectId}::uuid RETURNING id`));
  return rows.length ? { success: true } : DENIED;
}
