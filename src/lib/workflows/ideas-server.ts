import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { launchedFromBuilt } from "@/lib/workflows/ideas";

/** Report 38.13 W6 and call 4 (A5.3): when what an idea became completes or launches, the idea becomes Launched. */
export async function launchIdeasBuiltAs(taskId: string) {
  try {
    const [built] = Array.from(await db.execute<{ item_type: string | null; status: string; stage: string | null; workspace_id: string }>(sql`
      SELECT item_type, status, stage, workspace_id FROM tasks WHERE id = ${taskId}::uuid AND deleted_at IS NULL`));
    if (!built || !launchedFromBuilt({ itemType: built.item_type, status: built.status, stage: built.stage })) return 0;
    const moved = Array.from(await db.execute<{ id: string }>(sql`
      UPDATE tasks SET stage = 'launched', status = 'done', completed_at = now(), updated_at = now()
      WHERE workspace_id = ${built.workspace_id}::uuid AND item_type = 'idea' AND stage = 'building' AND deleted_at IS NULL AND type_fields->>'builtAs' = ${taskId}
      RETURNING id`));
    return moved.length;
  } catch (error) {
    logger.error("ideas.launch_failed", { taskId, error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}
