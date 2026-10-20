import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Reader = Pick<typeof db, "execute">;

/** Called under the task + project write lock. File locks prevent approving an upload in flight. */
export async function taskReviewSnapshot(
  reader: Reader,
  taskId: string,
  lockFiles = false,
) {
  const taskNodes = sql`n.project_id = (SELECT project_id FROM tasks WHERE id = ${taskId})
    AND n.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM task_node_links l WHERE l.node_id = n.id AND l.task_id = ${taskId})
      OR n.task_id = ${taskId} OR n.path LIKE ${`/.system/tasks/${taskId}/%`}
    )`;
  if (lockFiles) {
    await reader.execute(sql`
      SELECT n.id FROM project_nodes n WHERE ${taskNodes}
      OR n.id IN (SELECT owned.canonical_node_id FROM project_nodes owned
        WHERE owned.canonical_node_id IS NOT NULL AND owned.id IN (
          SELECT n.id FROM project_nodes n WHERE ${taskNodes}
        ))
      ORDER BY n.id FOR UPDATE OF n
    `);
  }
  const rows = await reader.execute<{ snapshot: unknown }>(sql`
    SELECT jsonb_build_object(
      'title', t.title, 'description', t.description,
      'subtasks', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'completed', s.completed) ORDER BY s.id), '[]'::jsonb)
        FROM task_subtasks s WHERE s.task_id = t.id),
      'files', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'node', n.id, 'name', n.name, 'path', n.path,
        'annotation', l.annotation, 'tags', l.tags, 'canonicalNode', n.canonical_node_id,
        'canonicalUpdatedAt', c.updated_at, 'canonicalDeletedAt', c.deleted_at,
        'version', coalesce(c.current_version, n.current_version), 'updatedAt', n.updated_at,
        'hash', v.content_hash, 'uploadedAt', v.uploaded_at) ORDER BY n.id), '[]'::jsonb)
        FROM project_nodes n
        LEFT JOIN task_node_links l ON l.node_id = n.id AND l.task_id = t.id
        LEFT JOIN project_nodes c ON c.id = n.canonical_node_id
        LEFT JOIN file_versions v ON v.node_id = coalesce(c.id, n.id) AND v.version = coalesce(c.current_version, n.current_version)
        WHERE ${taskNodes})
    ) AS snapshot FROM tasks t WHERE t.id = ${taskId}
  `);
  const row = Array.from(rows)[0];
  if (!row) throw new Error("Task not found");
  return createHash("sha256")
    .update(JSON.stringify(row.snapshot))
    .digest("hex");
}
