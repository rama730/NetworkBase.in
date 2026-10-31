import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * One counted view: the total and today's row move together or not at all. The trigger on the total announces the new
 * number to its readers. False when the workspace is gone.
 */
// ponytail: a direct write per counted view. Ceiling: roughly tens per second on one workspace. Upgrade: buffer it through lib/counters/redis-flush.
export async function writeWorkspaceView(workspaceId: string, signedIn: boolean): Promise<boolean> {
  const rows = await db.execute(sql`
    WITH counted AS (
      UPDATE workspaces SET view_count = view_count + 1
      WHERE id = ${workspaceId}::uuid AND deleted_at IS NULL
      RETURNING id
    )
    INSERT INTO workspace_view_daily AS daily (workspace_id, day, signed_in_views, anonymous_views)
    SELECT id, (now() AT TIME ZONE 'utc')::date, ${signedIn ? 1 : 0}, ${signedIn ? 0 : 1} FROM counted
    ON CONFLICT (workspace_id, day) DO UPDATE SET
      signed_in_views = daily.signed_in_views + EXCLUDED.signed_in_views,
      anonymous_views = daily.anonymous_views + EXCLUDED.anonymous_views
    RETURNING workspace_id
  `);
  return Array.from(rows).length > 0;
}
