import assert from "node:assert/strict";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

const BROWSER_READABLE = [
  "profiles", "projects", "project_members", "project_follows", "connections", "tasks", "task_subtasks",
  "task_comments", "task_comment_likes", "task_node_links", "project_workflow_columns", "project_updates",
  "project_update_comments", "project_node_locks", "user_notifications",
].sort();

// RLS-009: the server writes; browser roles read only what the UI reads.
test("anon and authenticated have no write privilege anywhere in public", async () => {
  const rows = await sql`
    SELECT DISTINCT grantee || ':' || table_name || ':' || privilege_type AS grant
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') AND privilege_type <> 'SELECT'`;
  assert.deepEqual(rows.map((r) => r.grant), []);
});

test("browser SELECT is limited to the tables the UI and policies read", async () => {
  for (const role of ["anon", "authenticated"]) {
    const rows = await sql`
      SELECT table_name FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = ${role} AND privilege_type = 'SELECT' ORDER BY 1`;
    assert.deepEqual(rows.map((r) => r.table_name), BROWSER_READABLE, role);
  }
});

test("RLS-005/006/008/011: security state, username claims, audit events and reactions are server-only", async () => {
  const [row] = await sql`SELECT
    has_table_privilege('authenticated', 'public.profile_security_states', 'SELECT') AS security_read,
    has_table_privilege('authenticated', 'public.username_aliases', 'INSERT') AS alias_insert,
    has_table_privilege('authenticated', 'public.project_node_events', 'UPDATE') AS events_update,
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
