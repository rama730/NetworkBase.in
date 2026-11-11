import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closeAppDb, createUser, sql } from "./_helpers";

// Report A2, A5, A10 (migrations 0082–0084): where a sign-in came from and what the CLI asked for, the remembered
// choice per agent, and agents asking for more access. Browser roles never reach these tables.
after(async () => {
  await sql.end();
  await closeAppDb();
});

const columns = async (table: string) =>
  (await sql<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`).map((r) => r.column_name);

test("device codes keep the country and the access the CLI asked for", async () => {
  const cols = await columns("device_codes");
  for (const c of ["country", "requested_access", "requested_workspace"]) assert.ok(cols.includes(c), c);
  await assert.rejects(
    sql`INSERT INTO device_codes (device_code_hash, user_code, client_name, device_name, expires_at, requested_access) VALUES ('h', 'ZZZZ-ZZZZ', 'c', 'd', now(), 'everything')`,
    /device_codes_requested_access_check/,
  );
});

test("remembered choices and access requests exist with RLS on and no browser access", async () => {
  assert.deepEqual((await columns("agent_access_defaults")).sort(), ["access", "agent_name", "expiry_days", "extra_scopes", "updated_at", "user_id", "workspace_id"]);
  const req = await columns("agent_access_requests");
  for (const c of ["id", "session_id", "user_id", "scope", "method", "path", "reason", "status", "created_at", "decided_at", "expires_at", "used_at"]) assert.ok(req.includes(c), c);
  for (const table of ["agent_access_defaults", "agent_access_requests"]) {
    const [rls] = await sql`SELECT relrowsecurity FROM pg_class WHERE relname = ${table}`;
    assert.equal(rls!.relrowsecurity, true, `${table} RLS`);
    const [grant] = await sql`SELECT has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') AS ok`;
    assert.equal(grant!.ok, false, `${table} hidden from browsers`);
  }
});

test("an agent sign-in has exactly one of a workspace or all workspaces", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const insert = (workspace: string | null, all: boolean, type = "agent") =>
    sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, workspace_id, all_workspaces)
        VALUES (${userId}, ${`h${Math.random()}`}, 'nb_agt_x', 'd', '2', now(), ${type}, ${workspace}, ${all})`;
  await insert(null, true);
  await assert.rejects(insert(null, false), /extension_device_sessions_agent_workspace_check/, "an agent with neither");
  await assert.rejects(insert(null, true, "device"), /extension_device_sessions_all_workspaces_agent_only/, "only agents use all_workspaces");
});

test("an access request's status only takes the known answers", async () => {
  await assert.rejects(
    sql`INSERT INTO agent_access_requests (session_id, user_id, scope, method, path, status, expires_at) VALUES (gen_random_uuid(), gen_random_uuid(), 'task:complete', 'POST', '/x', 'maybe', now())`,
    /agent_access_requests_status_check/,
  );
});
