import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Report 38.10 W2 (A3.1): a launch moves from Planning to Getting ready when its first step leaves To do. */
export async function launchStepStarted(stepTaskId: string) {
  try {
    await db.execute(sql`
      UPDATE workspace_documents d SET settings = d.settings || '{"launchStage":"getting_ready"}'::jsonb, updated_at = now()
      FROM tasks t WHERE t.id = ${stepTaskId}::uuid AND d.id = t.source_doc_id
        AND d.settings->>'section' = 'launches' AND coalesce(d.settings->>'launchStage', 'planning') = 'planning'`);
  } catch (error) {
    logger.error("launches.getting_ready_failed", { module: "tasks", stepTaskId, error: error instanceof Error ? error.message : String(error) });
  }
}
