import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { buildGithubAccountConnectionState } from "../../src/lib/github/connection-state";
import { clearGithubOAuthReturn, githubOAuthFailureCode, githubOAuthReturnFailure } from "../../src/lib/github/oauth-errors";
import { authFailureText } from "../../src/lib/github/repository-sync";

const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const original = loader._load;
loader._load = (request, ...args) => request === "server-only" ? {} : original(request, ...args);
const { loadGithubLinkedUser } = createRequire(import.meta.url)("../../src/lib/github/linked-user") as typeof import("../../src/lib/github/linked-user");
loader._load = original;

const snapshot = { id: "viewer", identities: [], app_metadata: { provider: "github", providers: ["github"] }, user_metadata: {} } as unknown as User;
test("JWT identity omission does not make a linked GitHub account appear unlinked", async () => {
  const user = await loadGithubLinkedUser(snapshot, async (userId) => {
    assert.equal(userId, "viewer");
    return [{ id: "identity-row", provider: "github", provider_id: "123", identity_data: { provider_id: "123", user_name: "linked-user" } }];
  });
  assert.deepEqual(buildGithubAccountConnectionState(user), { linked: true, githubId: 123, username: "linked-user", avatarUrl: null, fullName: null });
  assert.deepEqual(snapshot.identities, []);
});
test("a current empty identity list overrides stale metadata and earlier identities", async () => {
  const user = await loadGithubLinkedUser({ ...snapshot, identities: [{ provider: "github" }] as User["identities"] }, async () => []);
  assert.equal(buildGithubAccountConnectionState(user).linked, false);
});
test("identity lookup failure remains an error instead of pretending the account is unlinked", async () => {
  await assert.rejects(loadGithubLinkedUser(snapshot, async () => { throw new Error("DB detail"); }), /Couldn’t check your linked GitHub account/);
});
test("the screenshot's identity conflict fragment takes precedence over a misleading cancellation", () => {
  const url = new URL("https://app.test/projects/test?tab=files&filesView=github&githubAuth=cancelled#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked");
  const code = githubOAuthReturnFailure(url);
  assert.equal(code, "identity_already_exists");
  assert.match(authFailureText(code), /already linked/);
  assert.doesNotMatch(authFailureText(code), /cancelled/);
  clearGithubOAuthReturn(url);
  assert.equal(url.href, "https://app.test/projects/test?tab=files&filesView=github");
});
test("callback classification separates denial, conflict and actual cancellation", () => {
  for (const code of ["access_denied", "identity_already_exists", "cancelled"]) assert.equal(githubOAuthFailureCode(code), code);
  assert.equal(githubOAuthFailureCode("server_error"), "invalid");
  assert.equal(githubOAuthFailureCode(null), "invalid");
  assert.equal(githubOAuthReturnFailure(new URL("https://app.test/projects/test?githubIdentity=already_linked")), "identity_already_exists");
});
test("OAuth cleanup preserves workspace routing and ordinary non-OAuth anchors", () => {
  const url = new URL("https://app.test/projects/test?tab=files&filesView=github&githubAuth=invalid#L20");
  clearGithubOAuthReturn(url);
  assert.equal(url.hash, "#L20");
  assert.equal(url.searchParams.get("filesView"), "github");
  assert.equal(githubOAuthReturnFailure(url), null);
  const settings = new URL("https://app.test/settings?tab=integrations&githubIdentity=replaced&githubAuth=invalid");
  clearGithubOAuthReturn(settings);
  assert.equal(settings.searchParams.get("githubIdentity"), "replaced");
});
