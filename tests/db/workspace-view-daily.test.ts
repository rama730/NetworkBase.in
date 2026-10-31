import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

let writer: typeof import("../../src/lib/workspaces/server/view-write");
before(async () => {
  writer = await loadAppModule(() => import("../../src/lib/workspaces/server/view-write"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const today = async () => (await sql`SELECT (now() AT TIME ZONE 'utc')::date::text AS day`)[0]!.day as string;

test("a counted view adds to the total and to today's row, split by who viewed", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner));
  try {
    const [before] = await sql`SELECT view_count, updated_at FROM workspaces WHERE id = ${id}`;
    assert.equal(await writer.writeWorkspaceView(id, true), true);
    assert.equal(await writer.writeWorkspaceView(id, false), true);
    assert.equal(await writer.writeWorkspaceView(id, false), true);

    const [after] = await sql`SELECT view_count, updated_at FROM workspaces WHERE id = ${id}`;
    assert.equal(Number(after!.view_count), Number(before!.view_count) + 3);
    assert.deepEqual(after!.updated_at, before!.updated_at, "a view is not an edit: Trending's freshness stays put");

    const rows = await sql`SELECT day::text, signed_in_views, anonymous_views FROM workspace_view_daily WHERE workspace_id = ${id}`;
    assert.deepEqual([...rows].map((row) => ({ ...row })), [{ day: await today(), signed_in_views: 1, anonymous_views: 2 }]);
  } finally {
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${id}`;
    await sql`DELETE FROM workspaces WHERE id = ${id}`;
  }
});

test("a deleted workspace counts nothing anywhere", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner));
  try {
    await sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${id}`;
    assert.equal(await writer.writeWorkspaceView(id, true), false);
    assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_view_daily WHERE workspace_id = ${id}`)[0]!.n, 0);
  } finally {
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${id}`;
    await sql`DELETE FROM workspaces WHERE id = ${id}`;
  }
});

test("daily rows go with their workspace", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner));
  await writer.writeWorkspaceView(id, true);
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${id}`;
  await sql`DELETE FROM workspaces WHERE id = ${id}`;
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_view_daily WHERE workspace_id = ${id}`)[0]!.n, 0);
});

test("browsers can't read daily totals; the server can write them", async () => {
  const [rights] = await sql`SELECT
    has_table_privilege('anon', 'public.workspace_view_daily', 'SELECT') AS anon_read,
    has_table_privilege('authenticated', 'public.workspace_view_daily', 'SELECT') AS user_read,
    has_table_privilege('nb_app', 'public.workspace_view_daily', 'INSERT') AS app_write,
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.workspace_view_daily'::regclass) AS rls`;
  assert.deepEqual({ ...rights }, { anon_read: false, user_read: false, app_write: true, rls: true });
});
