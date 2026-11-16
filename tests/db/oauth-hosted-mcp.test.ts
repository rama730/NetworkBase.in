import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// OAuth for the hosted MCP server (MCP authorization 2025-06-18, migration 0080): an editor registers, the person
// approves on the device page, and the code becomes the same workspace-bound agent token as `nb login --device --agent`.

let oauth: typeof import("../../src/lib/extension/oauth");
let devices: typeof import("../../src/lib/extension/device-codes");
before(async () => {
  oauth = await loadAppModule(() => import("../../src/lib/extension/oauth"));
  devices = await loadAppModule(() => import("../../src/lib/extension/device-codes"));
});
after(async () => {
  await sql.end();
  await closeAppDb();
});

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

test("an editor registers; only https, loopback http and app schemes come back to", async () => {
  assert.ok(oauth.validRedirectUri("http://127.0.0.1:33418/callback"));
  assert.ok(oauth.validRedirectUri("http://localhost:9000/oauth/callback"));
  assert.ok(oauth.validRedirectUri("https://editor.example.com/cb"));
  assert.ok(oauth.validRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback"));
  for (const bad of ["http://evil.example.com/cb", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://x.example.com/cb#frag", "not a url"]) {
    assert.equal(oauth.validRedirectUri(bad), false, bad);
  }
  const bad = await oauth.registerClient({ clientName: "Evil", redirectUris: ["http://evil.example.com/cb"] });
  assert.equal("error" in bad, true);
  const ok = await oauth.registerClient({ clientName: "Claude Code", redirectUris: ["http://127.0.0.1:33418/callback"] });
  assert.ok("clientId" in ok && ok.clientId);
});

test("authorize → approve → token: PKCE, the exact redirect, one use, an agent token for the chosen workspace", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const workspaceId = await sql.begin((tx) => createProject(tx, userId));
  const reg = await oauth.registerClient({ clientName: "Claude Code", redirectUris: ["http://127.0.0.1:33418/callback"] });
  assert.ok("clientId" in reg);
  const { verifier, challenge } = pkce();

  const wrongPlace = await oauth.startAuthorization({ clientId: reg.clientId, redirectUri: "http://127.0.0.1:33418/other", state: "s1", codeChallenge: challenge, codeChallengeMethod: "S256" });
  assert.equal("error" in wrongPlace && wrongPlace.redirectable, false, "an unregistered redirect never gets the person back");
  const plain = await oauth.startAuthorization({ clientId: reg.clientId, redirectUri: "http://127.0.0.1:33418/callback", state: "s1", codeChallenge: challenge, codeChallengeMethod: "plain" });
  assert.equal("error" in plain && plain.error, "invalid_request");

  const started = await oauth.startAuthorization({ clientId: reg.clientId, redirectUri: "http://127.0.0.1:33418/callback", state: "s1", codeChallenge: challenge, codeChallengeMethod: "S256" });
  assert.ok("userCode" in started);
  assert.ok(await devices.decideDeviceCode(userId, started.userCode, { decision: "approve", type: "agent", access: "small", workspace: workspaceId, expiryDays: 30 }));
  const back = await oauth.redirectAfterDecision(started.userCode);
  assert.ok(back);
  const url = new URL(back);
  assert.equal(`${url.origin}${url.pathname}`, "http://127.0.0.1:33418/callback");
  assert.equal(url.searchParams.get("state"), "s1");
  const code = url.searchParams.get("code")!;

  const wrongVerifier = await oauth.exchangeCode({ code, codeVerifier: pkce().verifier, redirectUri: "http://127.0.0.1:33418/callback", clientId: reg.clientId });
  assert.equal("error" in wrongVerifier && wrongVerifier.error, "invalid_grant");
  const token = await oauth.exchangeCode({ code, codeVerifier: verifier, redirectUri: "http://127.0.0.1:33418/callback", clientId: reg.clientId });
  assert.ok("accessToken" in token, JSON.stringify(token));
  assert.match(token.accessToken, /^nb_agt_/);
  const [session] = await sql`SELECT token_type, workspace_id, agent_name FROM extension_device_sessions WHERE token_hash = ${createHash("sha256").update(token.accessToken).digest("hex")}`;
  assert.deepEqual([session!.token_type, session!.workspace_id, session!.agent_name], ["agent", workspaceId, "Claude Code"]);
  const reuse = await oauth.exchangeCode({ code, codeVerifier: verifier, redirectUri: "http://127.0.0.1:33418/callback", clientId: reg.clientId });
  assert.equal("error" in reuse && reuse.error, "invalid_grant", "a code works once");
});

test("a denied request goes back with access_denied and no code", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const reg = await oauth.registerClient({ clientName: "Codex", redirectUris: ["http://localhost:9000/cb"] });
  assert.ok("clientId" in reg);
  const started = await oauth.startAuthorization({ clientId: reg.clientId, redirectUri: "http://localhost:9000/cb", state: "z", codeChallenge: pkce().challenge, codeChallengeMethod: "S256" });
  assert.ok("userCode" in started);
  assert.ok(await devices.decideDeviceCode(userId, started.userCode, { decision: "deny" }));
  const url = new URL((await oauth.redirectAfterDecision(started.userCode))!);
  assert.deepEqual([url.searchParams.get("error"), url.searchParams.get("state"), url.searchParams.get("code")], ["access_denied", "z", null]);
});

/** An approved OAuth sign-in for `expiryDays`, swapped for its tokens. */
async function signedIn(expiryDays: 7 | 30 | 90 = 30) {
  const userId = await sql.begin((tx) => createUser(tx));
  const workspaceId = await sql.begin((tx) => createProject(tx, userId));
  const reg = await oauth.registerClient({ clientName: "Cursor", redirectUris: ["http://127.0.0.1:4000/cb"] });
  assert.ok("clientId" in reg);
  const { verifier, challenge } = pkce();
  const started = await oauth.startAuthorization({ clientId: reg.clientId, redirectUri: "http://127.0.0.1:4000/cb", state: null, codeChallenge: challenge, codeChallengeMethod: "S256" });
  assert.ok("userCode" in started);
  assert.ok(await devices.decideDeviceCode(userId, started.userCode, { decision: "approve", type: "agent", access: "small", workspace: workspaceId, expiryDays }));
  const code = new URL((await oauth.redirectAfterDecision(started.userCode))!).searchParams.get("code")!;
  const token = await oauth.exchangeCode({ code, codeVerifier: verifier, redirectUri: "http://127.0.0.1:4000/cb", clientId: reg.clientId });
  assert.ok("accessToken" in token, JSON.stringify(token));
  return { clientId: reg.clientId, token };
}
const live = async (accessToken: string) => (await sql`SELECT 1 FROM extension_device_sessions WHERE token_hash = ${createHash("sha256").update(accessToken).digest("hex")} AND revoked_at IS NULL AND expires_at > now()`).length === 1;

test("F4: a refresh token renews the sign-in once; the next one comes with it, the old access token stops", async () => {
  const { clientId, token } = await signedIn(30);
  assert.match(token.refreshToken ?? "", /^nb_rft_/);
  const renewed = await oauth.refreshAccessToken({ refreshToken: token.refreshToken!, clientId });
  assert.ok("accessToken" in renewed, JSON.stringify(renewed));
  assert.notEqual(renewed.accessToken, token.accessToken);
  assert.notEqual(renewed.refreshToken, token.refreshToken);
  assert.equal(await live(token.accessToken), false, "the old access token stops working");
  assert.equal(await live(renewed.accessToken), true);
  assert.ok(renewed.expiresAt.getTime() - Date.now() > 29 * 86_400_000);
  const again = await oauth.refreshAccessToken({ refreshToken: renewed.refreshToken!, clientId });
  assert.ok("accessToken" in again, "the chain keeps going");
  const otherClient = await oauth.registerClient({ clientName: "Other", redirectUris: ["http://127.0.0.1:5000/cb"] });
  assert.ok("clientId" in otherClient);
  const stolen = await oauth.refreshAccessToken({ refreshToken: again.refreshToken!, clientId: otherClient.clientId });
  assert.equal("error" in stolen && stolen.error, "invalid_grant", "bound to the client it was issued to");
});

test("F4: an old refresh token used again revokes the whole family and the sign-in", async () => {
  const { clientId, token } = await signedIn(90);
  const renewed = await oauth.refreshAccessToken({ refreshToken: token.refreshToken!, clientId });
  assert.ok("accessToken" in renewed);
  const replay = await oauth.refreshAccessToken({ refreshToken: token.refreshToken!, clientId });
  assert.equal("error" in replay && replay.error, "invalid_grant");
  assert.equal(await live(renewed.accessToken), false, "the sign-in is revoked");
  const next = await oauth.refreshAccessToken({ refreshToken: renewed.refreshToken!, clientId });
  assert.equal("error" in next && next.error, "invalid_grant", "and its newest refresh token with it");
});

test("F4: revoking the sign-in stops renewal; a 7-day sign-in gets no refresh token; expired ones are refused", async () => {
  const { clientId, token } = await signedIn(30);
  await sql`UPDATE extension_device_sessions SET revoked_at = now() WHERE token_hash = ${createHash("sha256").update(token.accessToken).digest("hex")}`;
  const after = await oauth.refreshAccessToken({ refreshToken: token.refreshToken!, clientId });
  assert.equal("error" in after && after.error, "invalid_grant");
  const short = await signedIn(7);
  assert.equal(short.token.refreshToken, null, "the person chose a short sign-in");
  const old = await signedIn(30);
  await sql`UPDATE oauth_refresh_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = ${createHash("sha256").update(old.token.refreshToken!).digest("hex")}`;
  const expired = await oauth.refreshAccessToken({ refreshToken: old.token.refreshToken!, clientId: old.clientId });
  assert.equal("error" in expired && expired.error, "invalid_grant");
});
