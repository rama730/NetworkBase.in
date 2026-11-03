import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Who last saved a linked document's file (live-fix 22): its newest version's uploader, else the file's creator. */
export async function linkedFileEditor(nodeId: string): Promise<{ id: string | null; name: string | null }> {
  const [row] = await db.execute<{ id: string | null; name: string | null }>(sql`
    SELECT p.id, COALESCE(p.full_name, p.username) AS name
    FROM workspace_nodes n
    LEFT JOIN LATERAL (SELECT fv.uploaded_by FROM file_versions fv WHERE fv.node_id = n.id ORDER BY fv.version DESC LIMIT 1) v ON true
    LEFT JOIN profiles p ON p.id = COALESCE(v.uploaded_by, n.created_by)
    WHERE n.id = ${nodeId}::uuid`);
  return { id: row?.id ?? null, name: row?.name ?? null };
}
