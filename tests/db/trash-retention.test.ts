import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Trash empties itself 30 days after an item was trashed. A folder over the 500-item permanent-delete limit
// goes in pieces: its biggest subfolders that fit first, the folder itself on a later run.
let purge: typeof import("../../src/lib/files/permanent-delete");
before(async () => {
  purge = await loadAppModule(() => import("../../src/lib/files/permanent-delete"));
});

const created: string[] = [];
after(async () => {
  for (const id of created) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function node(ws: string, by: string, path: string, type: "file" | "folder", parent: string | null, daysAgo: number | null) {
  const [row] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, parent_id, deleted_at, deleted_by)
    VALUES (${ws}, ${type}, ${path.split("/").pop()!}, ${path}, ${parent},
            ${daysAgo === null ? null : sql`now() - make_interval(days => ${daysAgo})`}, ${daysAgo === null ? null : by}) RETURNING id`;
  return row!.id as string;
}

async function finishMarked(ws: string) {
  const roots = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${ws} AND metadata->>'permanentDeleteRoot' = id::text`;
  for (const { id } of roots) await purge.finishPermanentDelete(ws, id);
  return roots.length;
}

test("Trash older than 30 days is permanently deleted, big folders in pieces; newer Trash and live files stay", async () => {
  const owner = await createUser(sql);
  const ws = await createProject(sql, owner);
  created.push(ws);

  const big = await node(ws, owner, "/big", "folder", null, 31);
  const subs: string[] = [];
  for (const s of ["s1", "s2", "s3"]) {
    const sub = await node(ws, owner, `/big/${s}`, "folder", big, 31);
    subs.push(sub);
    await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, parent_id, deleted_at, deleted_by)
      SELECT ${ws}, 'file', 'f' || i, ${`/big/${s}/f`} || i, ${sub}, now() - interval '31 days', ${owner} FROM generate_series(1, 200) i`;
  }
  const small = await node(ws, owner, "/small", "folder", null, 40);
  await node(ws, owner, "/small/a.txt", "file", small, 40);
  const recent = await node(ws, owner, "/recent.txt", "file", null, 5);
  const live = await node(ws, owner, "/live.txt", "file", null, null);

  // /big has 604 items, over the limit: its three subfolders (201 each) and /small go first.
  assert.equal(await purge.markExpiredTrash(), 4);
  const marked = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${ws} AND metadata->>'permanentDeleteRoot' = id::text`;
  assert.deepEqual(new Set(marked.map((r) => r.id)), new Set([...subs, small]));
  const [event] = await sql`SELECT actor_id, metadata FROM workspace_node_events WHERE node_id = ${small} AND type = 'permanent_delete_requested'`;
  assert.equal(event!.actor_id, null);
  assert.equal(event!.metadata.reason, "trash_retention");
  assert.equal(await purge.markExpiredTrash(), 0, "nothing new while those deletions are pending");

  assert.equal(await finishMarked(ws), 4);
  assert.equal(await purge.markExpiredTrash(), 1, "/big now fits");
  assert.equal(await finishMarked(ws), 1);

  const left = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${ws}`;
  assert.deepEqual(new Set(left.map((r) => r.id)), new Set([recent, live]));
});
