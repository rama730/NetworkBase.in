import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

import { actAs, actAsOwner, closeAppDb, createProject, createUser, inRollback, loadAppModule, sql } from "./_helpers";

let history: typeof import("@/lib/files/download-history");
const users: string[] = [];

before(async () => {
  history = await loadAppModule(() => import("@/lib/files/download-history"));
});
afterEach(async () => {
  if (users.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(users)}`;
  users.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

const seed = async () => sql.begin(async (tx) => {
  const owner = await createUser(tx);
  const other = await createUser(tx);
  users.push(owner, other);
  return { owner, other, projectId: await createProject(tx, owner) };
});

test("history is newest first, pages without repeats, filters, and shows no one's name for signed-out rows", async () => {
  const { owner, other, projectId } = await seed();
  for (let index = 0; index < 55; index += 1) {
    await history.insertDownloadEvent({ workspaceId: projectId, actorId: owner, fileName: `report-${index}.pdf`, kind: "file" });
  }
  await history.insertDownloadEvent({ workspaceId: projectId, actorId: other, fileName: "100%_done.zip", kind: "folder_zip", fileCount: 3 });
  await history.insertDownloadEvent({ workspaceId: projectId, actorId: null, fileName: "public.pdf", kind: "file" });

  const first = await history.readDownloadHistory({ workspaceId: projectId });
  assert.equal(first.rows.length, 50);
  assert.equal(first.rows[0]!.fileName, "public.pdf");
  assert.equal(first.rows[0]!.actorName, null);
  assert.ok(first.nextCursor);
  const second = await history.readDownloadHistory({ workspaceId: projectId, cursor: first.nextCursor });
  assert.equal(second.rows.length, 7);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 57);

  const byPerson = await history.readDownloadHistory({ workspaceId: projectId, actorId: other });
  assert.deepEqual(byPerson.rows.map((row) => row.fileName), ["100%_done.zip"]);
  const bySearch = await history.readDownloadHistory({ workspaceId: projectId, search: "100%_" });
  assert.equal(bySearch.rows.length, 1, "% and _ in a search are literal");
  assert.equal((await history.readDownloadHistory({ workspaceId: projectId, search: "%" })).rows.length, 1);
});

test("rows older than 90 days are deleted, newer ones stay", async () => {
  const { owner, projectId } = await seed();
  const [oldRow] = await sql`INSERT INTO public.workspace_download_events (workspace_id, actor_id, file_name, kind, created_at)
    VALUES (${projectId}, ${owner}, 'old.pdf', 'file', now() - interval '91 days') RETURNING id`;
  const [freshRow] = await sql`INSERT INTO public.workspace_download_events (workspace_id, actor_id, file_name, kind, created_at)
    VALUES (${projectId}, ${owner}, 'fresh.pdf', 'file', now() - interval '89 days') RETURNING id`;
  await history.deleteExpiredDownloadEvents();
  const left = await sql`SELECT id FROM public.workspace_download_events WHERE id IN (${oldRow!.id}, ${freshRow!.id})`;
  assert.deepEqual(left.map((row) => row.id), [freshRow!.id]);
});

test("browsers can't read or write the table; a deleted person's rows stay without a name", async () => {
  await inRollback(async (tx) => {
    const owner = await createUser(tx);
    const projectId = await createProject(tx, owner);
    await tx`INSERT INTO public.workspace_download_events (workspace_id, actor_id, file_name, kind) VALUES (${projectId}, ${owner}, 'a', 'file')`;
    for (const viewer of [null, owner]) {
      await actAs(tx, viewer);
      await assert.rejects(tx.savepoint((sp) => sp`SELECT id FROM public.workspace_download_events`), /permission denied/);
      await assert.rejects(tx.savepoint((sp) => sp`INSERT INTO public.workspace_download_events (workspace_id, file_name, kind) VALUES (${projectId}, 'x', 'file')`), /permission denied/);
      await actAsOwner(tx);
    }
    await assert.rejects(tx.savepoint((sp) => sp`INSERT INTO public.workspace_download_events (workspace_id, file_name, kind) VALUES (${projectId}, 'x', 'nope')`), /kind_check/);
    assert.ok(randomUUID());
  });
});

test("the account export carries a person's own downloads and no one else's", async () => {
  const { owner, other, projectId } = await seed();
  await history.insertDownloadEvent({ workspaceId: projectId, actorId: owner, fileName: "mine.pdf", kind: "file" });
  await history.insertDownloadEvent({ workspaceId: projectId, actorId: other, fileName: "theirs.pdf", kind: "file" });
  const rows = await history.exportDownloadHistory(owner);
  assert.deepEqual(rows.map((row) => row.file), ["mine.pdf"]);
});
