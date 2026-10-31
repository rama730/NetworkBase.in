import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GoTrueClient } from "@supabase/auth-js";

import { factorListFromAuthServer, getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";

const AUTH_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  factors: [
    { id: "factor-1", factor_type: "totp", friendly_name: "Authenticator app", status: "verified", created_at: "2026-10-30T00:00:00Z" },
    { id: "factor-2", factor_type: "totp", status: "unverified", created_at: "2026-10-30T00:00:00Z" },
  ],
};

function serverStyleClient(status = 200) {
  const client = new GoTrueClient({
    url: "http://auth.test",
    persistSession: false,
    autoRefreshToken: false,
    fetch: (async () => new Response(JSON.stringify(status === 200 ? AUTH_USER : { message: "down" }), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch,
  });
  const getUser = client.getUser.bind(client);
  const realGetUser = () => getUser("access-token");
  // What src/lib/supabase/server.ts does: getUser answers from the token, and a token carries no factors.
  (client as unknown as { getUser: unknown }).getUser = async () => ({ data: { user: { ...AUTH_USER, factors: undefined } }, error: null });
  return { client, realGetUser };
}

test("the bug: on the server client, supabase's own listFactors finds nothing for an account that has an authenticator", async () => {
  const { client } = serverStyleClient();
  assert.deepEqual(await listSecurityMfaFactors({ auth: client }), []);
});

test("the factor list reads the Auth server, so a verified authenticator counts as on", async () => {
  const { client, realGetUser } = serverStyleClient();
  client.mfa.listFactors = factorListFromAuthServer(realGetUser);
  const factors = await listSecurityMfaFactors({ auth: client });
  assert.equal(factors.length, 2);
  assert.deepEqual(getVerifiedTotpFactors(factors).map((factor) => factor.id), ["factor-1"]);
  assert.deepEqual((await client.mfa.listFactors()).data?.totp.map((factor) => factor.id), ["factor-1"]);
});

test("a failed read is an error, never 'no authenticator', which would weaken every protected action", async () => {
  const { client, realGetUser } = serverStyleClient(500);
  client.mfa.listFactors = factorListFromAuthServer(realGetUser);
  await assert.rejects(listSecurityMfaFactors({ auth: client }));
});

test("the server client installs the real factor list", () => {
  const source = readFileSync("src/lib/supabase/server.ts", "utf8");
  assert.match(source, /client\.auth\.mfa\.listFactors = factorListFromAuthServer\(/);
});

test("the settings nav's current section gets the same highlight as the app's other nav rows", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const layout = readFileSync("src/components/settings/SettingsLayout.tsx", "utf8");
  assert.match(layout, /aria-current=\{active \? "location"/);
  assert.match(css, /\.nb-nav-link\[aria-current="location"\][^{]*\{ background:var\(--sidebar-accent\)/);
  assert.match(css, /\.nb-nav-link\[aria-current="location"\] > svg[^{]*\{ color:var\(--primary\)/);
});
