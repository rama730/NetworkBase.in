import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, createUser, inRollback, sql } from "./_helpers";

after(() => sql.end());

// workspaces is column-granted (every column but import_source), so it is not a table-level grant.
const BROWSER_READABLE = [ "workspace_members", "workspace_follows", "connections", "tasks", "task_subtasks",
  "task_comments", "task_comment_likes", "task_node_links", "workspace_workflow_columns", "workspace_updates",
  "workspace_update_comments", "workspace_node_locks", "user_notifications",
].sort();

// RLS-009: the server writes; browser roles read only what the UI reads.
test("anon and authenticated have no write privilege anywhere in public", async () => {
  const rows = await sql`
    SELECT DISTINCT grantee || ':' || table_name || ':' || privilege_type AS grant
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') AND privilege_type <> 'SELECT'`;
  assert.deepEqual(rows.map((r) => r.grant), []);
});

// profiles is absent: browsers get named columns only (tests/db/profile-browser-columns.test.ts).
test("browser SELECT is limited to the tables the UI and policies read", async () => {
  for (const role of ["anon", "authenticated"]) {
    const expected = BROWSER_READABLE.filter((table) => role === "authenticated" || table !== "user_notifications");
    const rows = await sql`
      SELECT g.table_name FROM information_schema.role_table_grants g
      JOIN pg_class c ON c.relname = g.table_name AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      WHERE g.table_schema = 'public' AND g.grantee = ${role} AND g.privilege_type = 'SELECT' ORDER BY 1`;
    assert.deepEqual(rows.map((r) => r.table_name), expected, role);
  }
});

test("RLS-005/006/008/011: security state, username claims, audit events and reactions are server-only", async () => {
  const [row] = await sql`SELECT
    has_table_privilege('authenticated', 'public.profile_security_states', 'SELECT') AS security_read,
    has_table_privilege('authenticated', 'public.username_aliases', 'INSERT') AS alias_insert,
    has_table_privilege('authenticated', 'public.workspace_node_events', 'UPDATE') AS events_update,
    has_table_privilege('authenticated', 'public.task_comment_likes', 'INSERT') AS reaction_insert`;
  assert.deepEqual({ ...row }, { security_read: false, alias_insert: false, events_update: false, reaction_insert: false });
});

test("public functions are not executable by browser roles", async () => {
  const rows = await sql`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`;
  assert.deepEqual(rows.map((r) => r.proname), []);
});

test("browser roles read workspaces but never workspaces.import_source", async () => {
  for (const role of ["anon", "authenticated"]) {
    const [row] = await sql`SELECT
      has_column_privilege(${role}, 'public.workspaces', 'id', 'SELECT') AS id_read,
      has_column_privilege(${role}, 'public.workspaces', 'visibility', 'SELECT') AS visibility_read,
      has_column_privilege(${role}, 'public.workspaces', 'import_source', 'SELECT') AS import_source_read`;
    assert.deepEqual({ ...row }, { id_read: true, visibility_read: true, import_source_read: false }, role);
  }
});

// profiles_select_visible reads connections as the caller, so anon must keep SELECT there even though it sees no rows.
test("anon reads public profiles but neither notifications nor connection rows", async () => {
  await inRollback(async (tx) => {
    const a = await createUser(tx);
    const b = await createUser(tx);
    await tx`INSERT INTO public.connections (requester_id, addressee_id, status) VALUES (${a}, ${b}, 'accepted')`;
    await tx`INSERT INTO public.user_notifications (user_id, kind, title, dedupe_key) VALUES (${a}, 'task_assigned', 'x', 'grant-test')`;
    await actAs(tx, null);
    assert.equal((await tx`SELECT id FROM public.profiles WHERE id = ${a}`).length, 1);
    assert.equal((await tx`SELECT id FROM public.connections`).length, 0);
    await assert.rejects(tx.savepoint((sp) => sp`SELECT id FROM public.user_notifications`), /permission denied/);
    await actAsOwner(tx);
    await actAs(tx, a);
    assert.equal((await tx`SELECT id FROM public.user_notifications WHERE dedupe_key = 'grant-test'`).length, 1, "the owner still reads it");
    await actAsOwner(tx);
  });
});
