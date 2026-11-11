import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, createUser, inRollback, sql } from "./_helpers";

after(() => sql.end());

// workspaces is column-granted (every column but import_source), and so are tasks, task_subtasks and task_comments
// (every column but via and agent_name, Part B), so none of them is a table-level grant.
const BROWSER_READABLE = [ "workspace_follows",
  "task_comment_likes", "task_node_links", "workspace_workflow_columns", "workspace_updates",
  "workspace_update_comments", "user_notifications",
].sort();

// RLS-009: the server writes; browser roles read only what the UI reads.
test("anon and authenticated have no write privilege anywhere in public", async () => {
  const rows = await sql`
    SELECT DISTINCT grantee || ':' || table_name || ':' || privilege_type AS grant
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC') AND privilege_type NOT IN ('SELECT', 'MAINTAIN')`;
  assert.deepEqual(rows.map((r) => r.grant), []);
});

// connections, profiles, workspace_members and workspace_node_locks are absent: browsers get named columns only.
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

test("a connections-only profile still opens for a connection, and only for them", async () => {
  await inRollback(async (tx) => {
    const owner = await createUser(tx, { visibility: "connections" });
    const [friend, stranger] = [await createUser(tx), await createUser(tx)];
    await tx`INSERT INTO public.connections (requester_id, addressee_id, status, rejection_reason) VALUES (${owner}, ${friend}, 'accepted', 'kept private')`;
    await actAs(tx, friend);
    assert.equal((await tx`SELECT id FROM public.profiles WHERE id = ${owner}`).length, 1);
    assert.equal((await tx`SELECT status FROM public.connections`).length, 1, "their own connection still reads");
    await assert.rejects(tx.savepoint((sp) => sp`SELECT rejection_reason FROM public.connections`), /permission denied/);
    await actAsOwner(tx);
    await actAs(tx, stranger);
    assert.equal((await tx`SELECT id FROM public.profiles WHERE id = ${owner}`).length, 0);
    await actAsOwner(tx);
  });
});

test("a lock's holder and expiry stay readable, its tokens do not", async () => {
  await inRollback(async (tx) => {
    const owner = await createUser(tx);
    const [ws] = await tx`INSERT INTO public.workspaces (owner_id, title, slug, visibility, status) VALUES (${owner}, 'Locks', ${`locks-${owner.slice(0, 8)}`}, 'public', 'active') RETURNING id`;
    const [node] = await tx`INSERT INTO public.workspace_nodes (workspace_id, type, name) VALUES (${ws!.id}, 'file', 'a') RETURNING id`;
    await tx`INSERT INTO public.workspace_node_locks (node_id, workspace_id, locked_by, expires_at, session_id) VALUES (${node!.id}, ${ws!.id}, ${owner}, now() + interval '5 minutes', gen_random_uuid())`;
    await actAs(tx, owner);
    assert.equal((await tx`SELECT locked_by, expires_at FROM public.workspace_node_locks`).length, 1);
    for (const column of ["session_id", "lease_id", "fencing_token", "device_session_id"]) {
      await assert.rejects(tx.savepoint((sp) => sp.unsafe(`SELECT ${column} FROM public.workspace_node_locks`)), /permission denied/, column);
    }
    await actAsOwner(tx);
  });
});

test("notification preferences stay with the server", async () => {
  await inRollback(async (tx) => {
    for (const viewer of [null, await createUser(tx)]) {
      await actAs(tx, viewer);
      await assert.rejects(tx.savepoint((sp) => sp`SELECT notification_preferences FROM public.workspaces`), /permission denied/);
      await assert.rejects(tx.savepoint((sp) => sp`SELECT notification_preferences FROM public.workspace_members`), /permission denied/);
      await tx`SELECT id, workspace_id, user_id, role FROM public.workspace_members LIMIT 1`;
      await actAsOwner(tx);
    }
    const views = await tx`SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname <> 'onboarding_slo_daily'`;
    assert.deepEqual([...views], [], "the old project-name views are gone");
  });
});

// Exact columns, so a new grant on a private column fails here rather than in production.
const COLUMN_ALLOWLIST: Record<string, string[]> = {
  // profiles_select_visible reads these as the caller; nothing else in the browser reads connections.
  connections: ["addressee_id", "id", "requester_id", "status"],
  workspace_node_locks: ["acquired_at", "client_kind", "expires_at", "locked_by", "node_id", "workspace_id"],
  profiles: ["avatar_url", "created_at", "deleted_at", "full_name", "id", "updated_at", "username", "visibility"],
  workspace_members: ["id", "role", "user_id", "workspace_id"],
};

for (const [table, columns] of Object.entries(COLUMN_ALLOWLIST)) {
  test(`browsers read only the approved ${table} columns`, async () => {
    for (const role of ["anon", "authenticated"]) {
      const rows = await sql`
        SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = ${`public.${table}`}::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege(${role}, a.attrelid, a.attnum, 'SELECT') ORDER BY 1`;
      assert.deepEqual(rows.map((r) => r.attname), columns, role);
    }
  });
}

test("no private workspace column is browser-readable", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const column of [
      "notification_preferences", "join_code", "org_settings", "import_source", "suspend_reason",
      "sync_status", "github_last_commit_sha", "cover_image_key", "current_sequence_number", "status_set_by",
    ]) {
      const [row] = await sql`SELECT has_column_privilege(${role}, 'public.workspaces', ${column}, 'SELECT') AS can`;
      assert.equal(row!.can, false, `${role} ${column}`);
    }
  }
});

test("every public table has row level security on", async () => {
  const rows = await sql`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND NOT relrowsecurity`;
  assert.deepEqual(rows.map((r) => r.relname), []);
});

test("browsers see their own membership and follows, never anyone else's", async () => {
  await inRollback(async (tx) => {
    const [owner, other] = [await createUser(tx), await createUser(tx)];
    const [ws] = await tx`INSERT INTO public.workspaces (owner_id, title, slug, visibility, status) VALUES (${owner}, 'Open', ${`open-${owner.slice(0, 8)}`}, 'public', 'active') RETURNING id`;
    await tx`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (${ws!.id}, ${other}, 'member') ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO public.workspace_follows (workspace_id, user_id) VALUES (${ws!.id}, ${other})`;
    for (const [viewer, expected] of [[null, 0], [owner, 0], [other, 1]] as const) {
      await actAs(tx, viewer);
      assert.equal((await tx`SELECT id FROM public.workspace_members WHERE workspace_id = ${ws!.id} AND user_id = ${other}`).length, expected);
      assert.equal((await tx`SELECT user_id FROM public.workspace_follows WHERE workspace_id = ${ws!.id}`).length, expected);
      await actAsOwner(tx);
    }
  });
});

test("during the deletion grace only the owner can read a workspace", async () => {
  await inRollback(async (tx) => {
    const [owner, member] = [await createUser(tx), await createUser(tx)];
    const [ws] = await tx`INSERT INTO public.workspaces (owner_id, title, slug, visibility, status) VALUES (${owner}, 'Going', ${`going-${owner.slice(0, 8)}`}, 'public', 'active') RETURNING id`;
    await tx`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (${ws!.id}, ${member}, 'member') ON CONFLICT DO NOTHING`;
    const reads = async (viewer: string | null) => {
      await actAs(tx, viewer);
      const [row] = await tx`SELECT app_private.nb_workspace_can_read(${ws!.id}) AS can`;
      await actAsOwner(tx);
      return row!.can;
    };
    assert.equal(await reads(null), true);
    await tx`UPDATE public.workspaces SET deletion_scheduled_at = now() + interval '30 days' WHERE id = ${ws!.id}`;
    assert.equal(await reads(null), false, "the public");
    assert.equal(await reads(member), false, "a member");
    assert.equal(await reads(owner), true, "the owner");
  });
});
