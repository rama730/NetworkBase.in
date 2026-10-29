import { db } from "@/lib/db";
import { projectEventCounters, projectNodes, } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { recordNodeEvent } from "@/lib/files/internal-helpers";

/**
 * Merges a sandboxed task branch back into the main project tree.
 * Enforces the strict 11-step transaction detailed in the architectural report.
 */
export async function mergeSandboxTask(
  actorId: string,
  projectId: string,
  taskId: string,
  sessionId: string,
) {
  return await db.transaction(async (tx) => {
    // 0. Increment project sequence clock atomically
    const [counter] = await tx
      .insert(projectEventCounters)
      .values({ projectId, nextSequence: 1 })
      .onConflictDoUpdate({
        target: projectEventCounters.projectId,
        set: {
          nextSequence: sql`${projectEventCounters.nextSequence} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({
        newSequenceNumber: projectEventCounters.nextSequence,
      });

    if (!counter) {
      throw new Error(`Workspace ${projectId} not found`);
    }
    const seqNum = counter.newSequenceNumber;

    // Every staged binding must target this project's main tree. Bindings are
    // client-influenced, so they are checked here before any write (COR-057);
    // every later canonical join repeats the scope as a backstop.
    const [binding] = await tx.execute<{ invalid: number }>(sql`
      SELECT count(*)::int AS invalid
      FROM project_nodes staged
      LEFT JOIN project_nodes canonical
        ON canonical.id = staged.canonical_node_id
       AND canonical.project_id = ${projectId}::uuid
       AND canonical.task_id IS NULL
      WHERE staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid
        AND staged.canonical_node_id IS NOT NULL AND canonical.id IS NULL
    `);
    if ((binding?.invalid ?? 0) > 0) {
      throw new Error("ERR_INVALID_CANONICAL: staged files reference nodes outside this workspace’s main tree");
    }

    // Step 1: Lock target canonical nodes, parent folders, and target paths on the main branch
    await tx.execute(sql`
      SELECT id FROM project_nodes
      WHERE project_id = ${projectId}::uuid
        AND (
          (task_id IS NULL AND id IN (
            SELECT canonical_node_id FROM project_nodes 
            WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND canonical_node_id IS NOT NULL
          ))
          OR (
            task_id IS NULL AND deleted_at IS NULL
            AND (
              id IN (SELECT parent_id FROM project_nodes WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid)
              OR path IN (SELECT path FROM project_nodes WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid)
            )
          )
        ) FOR UPDATE
    `);

    const activeLease = await tx.execute<{ nodeId: string }>(sql`
      SELECT locks.node_id AS "nodeId"
      FROM project_node_locks locks
      WHERE locks.project_id = ${projectId}::uuid
        AND locks.expires_at > now()
        AND locks.node_id IN (
          SELECT canonical_node_id
          FROM project_nodes
          WHERE project_id = ${projectId}::uuid
            AND task_id = ${taskId}::uuid
            AND canonical_node_id IS NOT NULL
        )
      LIMIT 1
    `);
    if (Array.from(activeLease)[0]) {
      throw new Error("The task waits because a member is editing one of its files");
    }

    // Step 3: Preflight Path Collision checking
    const collisionRows = await tx.execute<{ id: string; path: string }>(sql`
      SELECT id, path FROM project_nodes pn
      WHERE pn.project_id = ${projectId}::uuid AND pn.task_id IS NULL AND pn.deleted_at IS NULL 
        AND pn.path IN (
            SELECT path FROM project_nodes 
            WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND sync_status <> 'deleted_tombstone'
              AND (canonical_node_id IS NULL OR path <> (SELECT path FROM project_nodes WHERE id = canonical_node_id))
        )
        AND pn.id NOT IN (
            SELECT COALESCE(canonical_node_id, '00000000-0000-0000-0000-000000000000'::uuid) 
            FROM project_nodes 
            WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid
        )
    `);

    if (Array.from(collisionRows).length > 0) {
      const collisionPaths = Array.from(collisionRows).map(r => r.path).join(', ');
      throw new Error(`ERR_FS_PATH_COLLISION: Collision detected on path(s): ${collisionPaths}`);
    }

    // Step 4: Promote Edits (clone version only if content changed)
    await tx.execute(sql`
      INSERT INTO file_versions (id, node_id, version, s3_key, size, mime_type, content_hash, uploaded_by, comment, uploaded_at, asset_id)
      SELECT gen_random_uuid(),
             staged.canonical_node_id,
             COALESCE(canonical.current_version, 0) + 1,
             fv.s3_key, fv.size, fv.mime_type, fv.content_hash, fv.uploaded_by, fv.comment, fv.uploaded_at, fv.asset_id
      FROM project_nodes staged
      JOIN file_versions fv ON fv.node_id = staged.id
      JOIN project_nodes canonical ON canonical.id = staged.canonical_node_id AND canonical.project_id = staged.project_id AND canonical.task_id IS NULL
      WHERE fv.id = (SELECT id FROM file_versions WHERE node_id = staged.id ORDER BY version DESC LIMIT 1)
        AND staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid AND staged.canonical_node_id IS NOT NULL
        AND (staged.s3_key IS DISTINCT FROM canonical.s3_key OR staged.git_blob_hash IS DISTINCT FROM canonical.git_blob_hash)
    `);

    // Folder renames are captured before Step 7 overwrites canonical paths (COR-058).
    const renamedFolders = Array.from(await tx.execute<{ oldPath: string; newPath: string }>(sql`
      SELECT canonical.path AS "oldPath", staged.path AS "newPath"
      FROM project_nodes staged
      JOIN project_nodes canonical ON canonical.id = staged.canonical_node_id AND canonical.project_id = staged.project_id AND canonical.task_id IS NULL
      WHERE staged.project_id = ${projectId}::uuid AND staged.task_id = ${taskId}::uuid
        AND staged.type = 'folder' AND staged.sync_status <> 'deleted_tombstone'
        AND staged.path <> canonical.path
    `));

    // Step 6: Apply Deletions (Soft-delete canonical node and descendants on main)
    await tx.execute(sql`
      UPDATE project_nodes 
      SET deleted_at = NOW(), deleted_by = ${actorId}::uuid
      WHERE id IN (
          SELECT canonical_node_id 
          FROM project_nodes 
          WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND sync_status = 'deleted_tombstone'
      ) OR id IN (
          SELECT pn.id
          FROM project_nodes pn
          JOIN project_nodes staged_tombstones ON staged_tombstones.project_id = pn.project_id
            AND staged_tombstones.task_id = ${taskId}::uuid 
            AND staged_tombstones.sync_status = 'deleted_tombstone' 
            AND staged_tombstones.type = 'folder'
          JOIN project_nodes canonical_folders ON canonical_folders.id = staged_tombstones.canonical_node_id AND canonical_folders.project_id = staged_tombstones.project_id AND canonical_folders.task_id IS NULL
          WHERE pn.project_id = ${projectId}::uuid 
            AND pn.task_id IS NULL 
            AND pn.deleted_at IS NULL
            AND starts_with(pn.path, canonical_folders.path || '/')
      )
    `);

    // Step 7: Update Canonical Node Metadata
    await tx.execute(sql`
      UPDATE project_nodes canonical
      SET parent_id = COALESCE(
            (SELECT canonical_node_id FROM project_nodes WHERE id = staged.parent_id AND project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid),
            staged.parent_id
          ),
          path = staged.path,
          name = staged.name,
          current_version = CASE 
            WHEN staged.type = 'file' AND (staged.s3_key IS DISTINCT FROM canonical.s3_key OR staged.git_blob_hash IS DISTINCT FROM canonical.git_blob_hash) 
            THEN canonical.current_version + 1 
            ELSE canonical.current_version 
          END,
          s3_key = staged.s3_key,
          asset_id = staged.asset_id,
          size = staged.size,
          git_blob_hash = staged.git_blob_hash,
          sync_status = 'merged',
          updated_at = NOW()
      FROM project_nodes staged
      WHERE canonical.id = staged.canonical_node_id
        AND canonical.project_id = ${projectId}::uuid
        AND canonical.task_id IS NULL
        AND staged.project_id = ${projectId}::uuid 
        AND staged.task_id = ${taskId}::uuid 
        AND staged.canonical_node_id IS NOT NULL
        AND staged.sync_status <> 'deleted_tombstone'
    `);

    // Step 8: Move descendants of renamed folders. Each node takes its deepest
    // renamed ancestor; nodes Step 7 already placed are left alone.
    if (renamedFolders.length > 0) {
      await tx.execute(sql`
        UPDATE project_nodes pn
        SET path = moved.new_path || substr(pn.path, length(moved.old_path) + 1),
            updated_at = NOW()
        FROM (
          SELECT DISTINCT ON (descendant.id) descendant.id, rename."oldPath" AS old_path, rename."newPath" AS new_path
          FROM project_nodes descendant
          JOIN jsonb_to_recordset(${JSON.stringify(renamedFolders)}::jsonb) AS rename("oldPath" text, "newPath" text)
            ON starts_with(descendant.path, rename."oldPath" || '/')
          WHERE descendant.project_id = ${projectId}::uuid
            AND descendant.task_id IS NULL
            AND descendant.deleted_at IS NULL
            AND descendant.id NOT IN (
              SELECT canonical_node_id FROM project_nodes
              WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid AND canonical_node_id IS NOT NULL
            )
          ORDER BY descendant.id, length(rename."oldPath") DESC
        ) moved
        WHERE pn.id = moved.id
      `);
    }

    // Step 9: Promote new files and folders. A parent that is a staged copy of
    // an existing folder is replaced by that folder, so Step 10's cascade from
    // the staged copy cannot take promoted children with it (COR-060).
    await tx.execute(sql`
      UPDATE project_nodes promoted
      SET task_id = NULL,
          sync_status = 'merged',
          created_by = ${actorId}::uuid,
          updated_at = NOW(),
          parent_id = COALESCE(
            (SELECT parent.canonical_node_id FROM project_nodes parent
             WHERE parent.id = promoted.parent_id AND parent.task_id = ${taskId}::uuid AND parent.canonical_node_id IS NOT NULL),
            promoted.parent_id
          )
      WHERE promoted.project_id = ${projectId}::uuid
        AND promoted.task_id = ${taskId}::uuid
        AND promoted.canonical_node_id IS NULL
        AND promoted.sync_status <> 'deleted_tombstone'
    `);

    const [orphans] = await tx.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM project_nodes survivor
      WHERE survivor.project_id = ${projectId}::uuid
        AND survivor.task_id IS DISTINCT FROM ${taskId}::uuid
        AND survivor.parent_id IN (SELECT id FROM project_nodes WHERE project_id = ${projectId}::uuid AND task_id = ${taskId}::uuid)
    `);
    if ((orphans?.count ?? 0) > 0) {
      throw new Error("ERR_MERGE_ORPHANS: promoted nodes still reference sandbox folders");
    }

    // Step 10: Cleanup remaining sandbox nodes. Editor leases are never
    // deleted by a merge; only their exact owner credentials may release them.
    await tx
        .delete(projectNodes)
        .where(
            and(
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.taskId, taskId)
            )
        );

    // Record overall merge event
    await recordNodeEvent(projectId, actorId, null, 'task_merge', { taskId, sessionId, seqNum }, tx);

    return { success: true, sequenceNumber: seqNum };
  });
}
