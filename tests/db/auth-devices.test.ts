import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { NextResponse } from "next/server";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Sign-in pages (docs/superpowers/plans/2026-11-09-auth-pages-findings.md): the browsers a person signed in from
// (C17 "new sign-in" email, C18 "Trust this browser for 30 days") and the emailed codes' outbox kinds (A2, B11).

moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => { throw new Error("not used"); },
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/headers", { headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], get: () => undefined }) });

let devices: typeof import("../../src/lib/auth/devices");
let gate: typeof import("../../src/lib/auth/mfa-gate");
before(async () => {
  devices = await loadAppModule(() => import("../../src/lib/auth/devices"));
  gate = await loadAppModule(() => import("../../src/lib/auth/mfa-gate"));
});

const users: string[] = [];
async function person() {
  const id = await sql.begin((tx) => createUser(tx));
  users.push(id);
  return id;
}
after(async () => {
  for (const id of users) {
    await sql`DELETE FROM email_outbox WHERE user_id = ${id}`;
    await sql`DELETE FROM user_devices WHERE user_id = ${id}`;
    await sql`DELETE FROM auth.mfa_factors WHERE user_id = ${id}`;
  }
  await sql`DELETE FROM email_outbox WHERE to_email = 'codes@test.local'`;
  await sql.end();
  await closeAppDb();
});

const browser = () => devices.resolveDeviceId(null).deviceId;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

test("the first browser is quiet; a second browser is new and the account already had one", async () => {
  const id = await person();
  const laptop = browser();
  const phone = browser();
  assert.deepEqual(await devices.noteSignInDevice(id, laptop, UA).then(({ isNew, hadOthers }) => ({ isNew, hadOthers })), { isNew: true, hadOthers: false });
  assert.deepEqual(await devices.noteSignInDevice(id, laptop, UA).then(({ isNew }) => isNew), false);
  const second = await devices.noteSignInDevice(id, phone, UA);
  assert.equal(second.isNew, true);
  assert.equal(second.hadOthers, true);
  assert.match(second.label, / on /);
  const [row] = await sql`SELECT device_hash FROM user_devices WHERE user_id = ${id} LIMIT 1`;
  assert.notEqual(row!.device_hash, laptop, "only the hash is kept");
});

test("a new browser gets its id cookie and the person gets the 'new sign-in' email", async () => {
  const id = await person();
  await devices.noteSignInDevice(id, browser(), UA);
  const request = new Request("https://networkbase.test/api/v1/auth/session", { headers: { "user-agent": UA } });
  const response = NextResponse.json({});
  await devices.noteSignIn(request, response, id);
  assert.match(response.headers.get("set-cookie") ?? "", /nb-device=/);
  const mails = await sql`SELECT kind FROM email_outbox WHERE user_id = ${id}`;
  assert.deepEqual(mails.map((mail) => mail.kind), ["security_new_sign_in"]);
});

test("a trusted browser skips the code until trust stops; another account's browser never does", async () => {
  const id = await person();
  const other = await person();
  await sql`INSERT INTO auth.mfa_factors (id, user_id, status) VALUES (${randomUUID()}, ${id}, 'verified')`;
  const laptop = browser();
  assert.equal(await gate.isSecondFactorDue(id, "aal1", laptop), true);

  await devices.trustDevice(id, laptop, UA);
  assert.equal(await devices.isTrustedDevice(id, laptop), true);
  assert.equal(await gate.isSecondFactorDue(id, "aal1", laptop), false);
  assert.equal(await gate.isSecondFactorDue(id, "aal1", browser()), true, "an untrusted browser still asks");
  assert.equal(await devices.isTrustedDevice(other, laptop), false);

  const listed = await devices.listTrustedDevices(id, laptop);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.current, true);

  await devices.stopTrustingDevices(id, listed[0]!.id);
  assert.equal(await devices.isTrustedDevice(id, laptop), false);
  assert.equal(await gate.isSecondFactorDue(id, "aal1", laptop), true);
});

test("trust runs out after 30 days", async () => {
  const id = await person();
  const laptop = browser();
  await devices.trustDevice(id, laptop, UA);
  await sql`UPDATE user_devices SET trusted_until = now() - interval '1 minute' WHERE user_id = ${id}`;
  await devices.stopTrustingDevices(id, "0".repeat(64)); // clears this account's cached answers
  assert.equal(await devices.isTrustedDevice(id, laptop), false);
});

test("the outbox takes the codes sent to an address and the new-sign-in email", async () => {
  await sql`INSERT INTO email_outbox (kind, event_key, to_email, data) VALUES ('auth_reset_code', ${randomUUID()}, 'codes@test.local', '{"code":"123456"}'::jsonb)`;
  await sql`INSERT INTO email_outbox (kind, event_key, to_email, data) VALUES ('auth_sign_in_code', ${randomUUID()}, 'codes@test.local', '{"code":"654321"}'::jsonb)`;
  const rows = await sql`SELECT kind FROM email_outbox WHERE to_email = 'codes@test.local' ORDER BY kind`;
  assert.deepEqual(rows.map((row) => row.kind), ["auth_reset_code", "auth_sign_in_code"]);
});
