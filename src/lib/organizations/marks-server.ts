import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { readRubrics, type Marking, type Rubric } from "@/lib/organizations/marks";

// Report 30.8 (plan B1.5a): server-only marking steps, never callable from the browser.

/** Freezes the picked rubric onto an assignment's settings when it's saved (call 2); later edits never change it. */
export async function freezeMarking(orgId: string, choice: { mode: "none" } | { mode: "outof"; outOf: number } | { mode: "rubric"; rubricId: string }): Promise<Marking | { error: string }> {
  if (choice.mode === "none") return { mode: "none" };
  if (choice.mode === "outof") return Number.isFinite(choice.outOf) && choice.outOf > 0 && choice.outOf <= 100_000 ? { mode: "outof", outOf: choice.outOf } : { error: "Out of is a number above 0." };
  const [row] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid`));
  const rubric = readRubrics(row?.settings).find((r: Rubric) => r.id === choice.rubricId && !r.archived);
  return rubric ? { mode: "rubric", rubric } : { error: "Pick a rubric from this class." };
}
