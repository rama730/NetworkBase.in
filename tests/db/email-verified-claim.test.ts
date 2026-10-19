import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

const claim = async (id: string) => (await sql`SELECT raw_app_meta_data->>'email_verified' AS v FROM auth.users WHERE id = ${id}`)[0]!.v;

// SEC-003: the verified-email claim follows email_confirmed_at and nothing a user can write.
test("the claim is set at insert and follows confirmation", async () => {
  const unconfirmed = randomUUID();
  const confirmed = randomUUID();
  try {
    await sql`INSERT INTO auth.users (id, email) VALUES (${unconfirmed}, 'u@test.local')`;
    await sql`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (${confirmed}, 'c@test.local', now())`;
    assert.equal(await claim(unconfirmed), "false");
    assert.equal(await claim(confirmed), "true");
    await sql`UPDATE auth.users SET email_confirmed_at = now() WHERE id = ${unconfirmed}`;
    assert.equal(await claim(unconfirmed), "true");
    await sql`UPDATE auth.users SET email_confirmed_at = NULL WHERE id = ${unconfirmed}`;
    assert.equal(await claim(unconfirmed), "false");
  } finally {
    await sql`DELETE FROM auth.users WHERE id = ANY(${[unconfirmed, confirmed]}::uuid[])`;
  }
});

test("neither user metadata nor a direct app metadata write can claim verification", async () => {
  const id = randomUUID();
  try {
    await sql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${id}, 'x@test.local', '{"email_verified": true}')`;
    assert.equal(await claim(id), "false");
    await sql`UPDATE auth.users SET raw_app_meta_data = '{"email_verified": true, "role": "member"}' WHERE id = ${id}`;
    assert.equal(await claim(id), "false");
    const [row] = await sql`SELECT raw_app_meta_data->>'role' AS role FROM auth.users WHERE id = ${id}`;
    assert.equal(row!.role, "member", "other app metadata is preserved");
  } finally {
    await sql`DELETE FROM auth.users WHERE id = ${id}`;
  }
});

test("the trigger function is not callable by browser roles", async () => {
  const [row] = await sql`SELECT has_function_privilege('authenticated', 'app_private.sync_email_verified_claim()', 'EXECUTE') AS a,
                                 has_function_privilege('anon', 'app_private.sync_email_verified_claim()', 'EXECUTE') AS b`;
  assert.deepEqual([row!.a, row!.b], [false, false]);
});
