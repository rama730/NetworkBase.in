import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Live-fix 22: a document's "Updated by" names a person, never "System".
after(async () => { await sql.end(); await closeAppDb(); });

test("live-fix 22: a linked document is updated by its newest version's uploader, else the file's creator", async () => {
  const { linkedFileEditor } = await loadAppModule(() => import("../../src/lib/workspaces/doc-linked-editor"));
  const [owner, editor] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  await sql`UPDATE profiles SET full_name = 'Ms. Rao' WHERE id = ${owner!}`;
  await sql`UPDATE profiles SET full_name = 'Asha Nair' WHERE id = ${editor!}`;
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  try {
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', 'Course syllabus.md', '/Course syllabus.md', ${owner!}) RETURNING id`;
    assert.deepEqual(await linkedFileEditor(node!.id), { id: owner!, name: "Ms. Rao" }, "no versions yet: the creator");
    await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by) VALUES (${node!.id}, 1, 'k1', 10, 'text/markdown', ${owner!}), (${node!.id}, 2, 'k2', 12, 'text/markdown', ${editor!})`;
    assert.deepEqual(await linkedFileEditor(node!.id), { id: editor!, name: "Asha Nair" });
  } finally {
    await sql`DELETE FROM workspaces WHERE id = ${ws}`;
  }
});
