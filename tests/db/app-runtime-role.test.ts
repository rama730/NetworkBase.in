import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { inRollback, sql, type Tx } from "./_helpers";

// Production connects as nb_app instead of postgres (migration 0268, docs/ops/runtime-database-role.md).
// Run the whole suite as that role with NB_TEST_APP_ROLE=nb_app.
after(() => sql.end());

const AUTH_FUNCTIONS = [
  "app_private.nb_user_has_password(uuid)",
  "app_private.nb_user_has_verified_mfa(uuid)",
  "app_private.nb_user_identities(uuid)",
  "app_private.nb_user_sessions(uuid)",
  "app_private.nb_session_set_device(uuid,text,inet)",
  "app_private.nb_session_delete(uuid,uuid)",
  "app_private.nb_storage_objects(text,text[],text[])",
];

test("nb_app is a plain role: no superuser, no BYPASSRLS, no DDL, no direct auth or storage access", async () => {
  const [role] = await sql`SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'nb_app'`;
  assert.deepEqual({ ...role }, { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
  const [access] = await sql`SELECT
    has_schema_privilege('nb_app', 'public', 'CREATE') AS create_in_public,
    has_table_privilege('nb_app', 'auth.users', 'SELECT') AS auth_users,
    has_table_privilege('nb_app', 'auth.sessions', 'SELECT') AS auth_sessions,
    has_table_privilege('nb_app', 'storage.objects', 'SELECT') AS storage_objects`;
  assert.deepEqual({ ...access }, { create_in_public: false, auth_users: false, auth_sessions: false, storage_objects: false });
});

test("every public table has the nb_app policy and grants; a new table gets them too", async () => {
  const missing = await sql<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND (NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'nb_app_all')
        OR NOT has_table_privilege('nb_app', c.oid, 'SELECT')
        OR NOT has_table_privilege('nb_app', c.oid, 'DELETE'))`;
  assert.deepEqual(missing.map((row) => row.relname), []);
  await inRollback(async (tx) => {
    await tx`CREATE TABLE public.zz_nb_app_probe (id int PRIMARY KEY)`;
    await tx`ALTER TABLE public.zz_nb_app_probe ENABLE ROW LEVEL SECURITY`;
    await tx`SET LOCAL ROLE nb_app`;
    await tx`INSERT INTO public.zz_nb_app_probe VALUES (1)`;
    assert.equal((await tx`SELECT id FROM public.zz_nb_app_probe`).length, 1);
  });
});

test("nb_app cannot truncate, alter or drop tables", async () => {
  await inRollback(async (tx) => {
    await tx`SET LOCAL ROLE nb_app`;
    for (const statement of ["TRUNCATE public.workspaces CASCADE", "ALTER TABLE public.workspaces ADD COLUMN zz int", "DROP TABLE public.workspaces"]) {
      await assert.rejects(tx.savepoint((sp) => sp.unsafe(statement)), /permission denied|must be owner/, statement);
    }
  });
});

async function authFixture(tx: Tx) {
  const userId = randomUUID(), sessionId = randomUUID();
  await tx`INSERT INTO auth.users (id, email, encrypted_password) VALUES (${userId}, ${`${userId}@test.dev`}, 'hash')`;
  await tx`INSERT INTO auth.mfa_factors (user_id, status) VALUES (${userId}, 'verified')`;
  await tx`INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES ('gh-1', ${userId}, '{"user_name":"mira"}', 'github')`;
  await tx`INSERT INTO auth.sessions (id, user_id, aal, user_agent) VALUES (${sessionId}, ${userId}, 'aal1', 'Unknown device')`;
  await tx`INSERT INTO storage.buckets (id, name) VALUES ('project-files', 'project-files') ON CONFLICT DO NOTHING`;
  await tx`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('project-files', ${`projects/${userId}/a.txt`}, '{"size":1}')`;
  return { userId, sessionId };
}

test("the auth and storage functions answer for nb_app, with only the columns the app reads", async () => {
  await inRollback(async (tx) => {
    const { userId, sessionId } = await authFixture(tx);
    await tx`SET LOCAL ROLE nb_app`;
    const [flags] = await tx`SELECT app_private.nb_user_has_password(${userId}) AS password, app_private.nb_user_has_verified_mfa(${userId}) AS mfa`;
    assert.deepEqual({ ...flags }, { password: true, mfa: true });
    const identities = await tx`SELECT provider, provider_id, identity_data FROM app_private.nb_user_identities(${userId})`;
    assert.deepEqual(identities.map((row) => [row.provider, row.provider_id, row.identity_data.user_name]), [["github", "gh-1", "mira"]]);
    await tx`SELECT app_private.nb_session_set_device(${sessionId}, 'Firefox on Mac', '10.0.0.1')`;
    const [session] = await tx`SELECT user_agent, host(ip) AS ip, aal FROM app_private.nb_user_sessions(${userId})`;
    assert.deepEqual({ ...session }, { user_agent: "Firefox on Mac", ip: "10.0.0.1", aal: "aal1" });
    const objects = await tx`SELECT name FROM app_private.nb_storage_objects('project-files', NULL, ARRAY[${`projects/${userId}/%`}])`;
    assert.equal(objects.length, 1);
    await tx`SELECT app_private.nb_session_delete(${sessionId}, ${randomUUID()})`;
    assert.equal((await tx`SELECT 1 FROM app_private.nb_user_sessions(${userId})`).length, 1, "another user's id deletes nothing");
    await tx`SELECT app_private.nb_session_delete(${sessionId}, ${userId})`;
    assert.equal((await tx`SELECT 1 FROM app_private.nb_user_sessions(${userId})`).length, 0);
  });
});

test("only nb_app may call the auth and storage functions", async () => {
  for (const fn of AUTH_FUNCTIONS) {
    const [row] = await sql`SELECT has_function_privilege('nb_app', ${fn}, 'EXECUTE') AS app, has_function_privilege('anon', ${fn}, 'EXECUTE') AS anon, has_function_privilege('authenticated', ${fn}, 'EXECUTE') AS authed`;
    assert.deepEqual({ ...row }, { app: true, anon: false, authed: false }, fn);
  }
});
