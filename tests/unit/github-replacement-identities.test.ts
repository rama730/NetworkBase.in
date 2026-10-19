import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// AUTH-007: the request user is a JWT snapshot whose identities are always empty, so the
// replacement command must read the linked identities from Auth before deciding anything.
test("github account replacement reads identities from Auth, not the snapshot user", () => {
  const source = readFileSync("src/app/api/v1/github/account/replacement/route.ts", "utf8");
  assert.match(source, /loadGithubLinkedUser\(auth\.user\)/);
  assert.doesNotMatch(source, /auth\.user\.identities/);
  const afterLoad = source.slice(source.indexOf("loadGithubLinkedUser(auth.user)"));
  assert.ok(afterLoad.indexOf("user.identities") > 0, "identities are read from the loaded user");
});
