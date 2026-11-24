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
  if (!(a.isOwner || a.isMember) || !a.canRead || (write && !a.canWrite)) return null;
  return { userId };
}

export type LiteratureRow = { id: string; title: string; authors: string | null; year: number | null; link: string | null; doi: string | null; keyIssues: string[]; summary: string | null; createdAt: string };

export async function readLiteratureAction(projectId: string) {
  try {
    if (!(await access(projectId, false))) return DENIED;
    const rows = Array.from(await db.execute<{ id: string; title: string; authors: string | null; year: number | null; link: string | null; doi: string | null; key_issues: string[]; summary: string | null; created_at: string }>(sql`
      SELECT id, title, authors, year, link, doi, to_jsonb(key_issues) AS key_issues, summary, created_at::text FROM literature_sources WHERE workspace_id = ${projectId}::uuid ORDER BY created_at DESC LIMIT ${LIMIT}`));
    return { success: true as const, rows: rows.map((r): LiteratureRow => ({ id: r.id, title: r.title, authors: r.authors, year: r.year, link: r.link, doi: r.doi, keyIssues: r.key_issues ?? [], summary: r.summary, createdAt: r.created_at })) };
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
  let added = 0;
  for (const s of parsed.data) {
    const key = sourceKey({ title: s.title, doi: s.doi ?? null });
    if (seen.has(key)) continue;
    seen.add(key);
    await db.execute(sql`
      INSERT INTO literature_sources (workspace_id, title, authors, year, link, doi, key_issues, summary, added_by)
      VALUES (${projectId}::uuid, ${s.title}, ${s.authors || null}, ${s.year ?? null}, ${s.link || null}, ${s.doi || null}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.keyIssues ?? [])}::jsonb)), ${s.summary || null}, ${who.userId}::uuid)`);
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
