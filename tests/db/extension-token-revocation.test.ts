import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

// Real database. An editor token authenticates as the whole user for a year, so the events that protect the
// account (a password change, sign out other devices, a scheduled deletion) must end every token of that user,
// and only that user's.
let revocation: typeof import("@/lib/security/extension-token-revocation");
const created: string[] = [];

before(async () => {
  revocation = await loadAppModule(() => import("@/lib/security/extension-token-revocation"));
});
afterEach(async () => {
  if (created.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function person() {
  const id = await sql.begin((tx) => createUser(tx, {}));
  created.push(id);
  return id;
}
async function token(userId: string, revoked = false) {
  const [row] = await sql`
    INSERT INTO public.extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, revoked_at)
    VALUES (${userId}, ${randomUUID()}, 'nb_dev_abcd', 'Test editor', '1.0.0', now() + interval '1 year', ${revoked ? new Date() : null})
    RETURNING id`;
  return row!.id as string;
}
const liveCount = async (userId: string) =>
  Number((await sql`SELECT count(*)::int AS n FROM public.extension_device_sessions WHERE user_id = ${userId} AND revoked_at IS NULL`)[0]!.n);

test("every live token of the user ends, and the count says how many", async () => {
  const user = await person();
  await token(user);
  await token(user);
  await token(user, true);
  assert.equal(await revocation.revokeAllExtensionSessionsForUser(user), 2);
  assert.equal(await liveCount(user), 0);
});

test("another user's tokens are left alone", async () => {
  const user = await person();
  const other = await person();
  await token(user);
  await token(other);
  await revocation.revokeAllExtensionSessionsForUser(user);
  assert.equal(await liveCount(other), 1);
});

test("a user with no tokens revokes none", async () => {
  assert.equal(await revocation.revokeAllExtensionSessionsForUser(await person()), 0);
});
