import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { readRubrics, type Marking, type Rubric } from "@/lib/organizations/marks";
import { readSectionSettings } from "@/lib/organizations/sections";
import { reviewsCopySql } from "@/lib/organizations/sections-server";

// Report 30.8 (plan B1.5a): server-only marking steps, never callable from the browser.

/**
 * B1.5b (report 30.8 layer 10): the marks on these copies a staff member may see — every one for the Teacher, only
 * their section's for a TA when "TAs work only with their section" is on. Drafts included (`visible` says which).
 */
export async function marksForStaff(orgId: string, viewer: { userId: string; role: string }, copyIds: string[]) {
  if (copyIds.length === 0) return new Map<string, { total: number; outOf: number; visible: boolean }>();
  let gate = null;
  if (viewer.role !== "owner") {
    const [org] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid`));
    if (readSectionSettings(org?.settings).taOnlyOwn) gate = reviewsCopySql(viewer.userId);
  }
  const rows = Array.from(await db.execute<{ copy_id: string; total: string; out_of: string; visible: boolean }>(sql`
    SELECT a.copy_id, a.total::text, a.out_of::text, a.visible_at IS NOT NULL AS visible
    FROM assignment_marks a JOIN tasks c ON c.id = a.copy_id JOIN tasks m ON m.id = c.assignment_id
    WHERE a.workspace_id = ${orgId}::uuid AND a.copy_id IN (${sql.join(copyIds.map((id) => sql`${id}::uuid`), sql`, `)}) ${gate ? sql`AND ${gate}` : sql``}`));
  return new Map(rows.map((r) => [r.copy_id, { total: Number(r.total), outOf: Number(r.out_of), visible: r.visible }]));
}

/** Freezes the picked rubric onto an assignment's settings when it's saved (call 2); later edits never change it. */
export async function freezeMarking(orgId: string, choice: { mode: "none" } | { mode: "outof"; outOf: number } | { mode: "rubric"; rubricId: string }): Promise<Marking | { error: string }> {
  if (choice.mode === "none") return { mode: "none" };
  if (choice.mode === "outof") return Number.isFinite(choice.outOf) && choice.outOf > 0 && choice.outOf <= 100_000 ? { mode: "outof", outOf: choice.outOf } : { error: "Out of is a number above 0." };
  const [row] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid`));
  const rubric = readRubrics(row?.settings).find((r: Rubric) => r.id === choice.rubricId && !r.archived);
  return rubric ? { mode: "rubric", rubric } : { error: "Pick a rubric from this class." };
}
