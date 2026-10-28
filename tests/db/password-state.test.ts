import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Real database. Whether an account has a password comes from the stored credential, not from the activity log:
// the log can be cleared by the person and is trimmed on a schedule, and an account must not then read as
// "no password" (that would let someone set one without knowing the old one).
moduleStubs.set("@/lib/supabase/server", { createClient: async () => { throw new Error("not used"); }, createAdminClient: async () => { throw new Error("not used"); } });
let state: typeof import("@/lib/auth/password-state");
const created: string[] = [];

before(async () => {
  // The disposable database stands in for Supabase Auth with a minimal users table; the real one has this column.
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text`;
  state = await loadAppModule(() => import("@/lib/auth/password-state"));
});
afterEach(async () => {
  if (created.length) {
    await sql`DELETE FROM public.profile_audit_events WHERE user_id IN ${sql(created)}`;
    await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  }
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function person(encryptedPassword: string | null) {
  const id = await sql.begin((tx) => createUser(tx, {}));
  created.push(id);
  await sql`UPDATE auth.users SET encrypted_password = ${encryptedPassword} WHERE id = ${id}`;
  return { id } as never;
}

test("a stored password counts, with no activity log at all", async () => {
  assert.equal(await state.accountHasPassword(await person("$2a$10$abcdefghijklmnopqrstuv")), true);
});

test("a 'password set' row in the log does not give an account without a password one", async () => {
  const user = await person("") as { id: string };
  await sql`INSERT INTO public.profile_audit_events (user_id, event_type, metadata) VALUES (${user.id}, 'password_set', '{}'::jsonb)`;
  assert.equal(await state.accountHasPassword(user as never), false);
});

test("clearing the log does not take a stored password away", async () => {
  const user = await person("$2a$10$abcdefghijklmnopqrstuv") as { id: string };
  await sql`INSERT INTO public.profile_audit_events (user_id, event_type, metadata) VALUES (${user.id}, 'password_set', '{}'::jsonb)`;
  await sql`DELETE FROM public.profile_audit_events WHERE user_id = ${user.id}`;
  assert.equal(await state.accountHasPassword(user as never), true);
});
