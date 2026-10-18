import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isSameOriginRequest } = require("../../src/components/providers/SecurityRuntimeProvider") as typeof import("../../src/components/providers/SecurityRuntimeProvider");

// SEC-008: only a URL that resolves to our origin carries the internal CSRF headers.
test("protocol-relative and absolute foreign URLs are not same-origin", () => {
  const origin = "https://app.test";
  assert.equal(isSameOriginRequest("/api/v1/x", origin), true);
  assert.equal(isSameOriginRequest("https://app.test/api/v1/x", origin), true);
  for (const url of ["//evil.test/x", "/\\evil.test/x", "https://evil.test/x", "https://app.test.evil.test/x"]) {
    assert.equal(isSameOriginRequest(url, origin), false, url);
  }
});

// VALID-003: the rate bucket must not be chosen by the unauthenticated delivery header.
test("github webhook rate key ignores the delivery id", () => {
  const source = readFileSync("src/app/api/v1/webhooks/github/route.ts", "utf8");
  assert.doesNotMatch(source, /x-github-delivery/i);
  assert.match(source, /enforceRouteLimit\(\s*request,\s*"api:v1:webhooks:github"/);
});

// AUTH-009: the per-user row must exist before FOR UPDATE, which locks nothing on a missing row.
test("recovery codes create the security row before locking it", () => {
  const source = readFileSync("src/app/api/v1/auth/mfa/recovery-codes/route.ts", "utf8");
  const insert = source.indexOf(".insert(profileSecurityStates).values({ userId: user.id }).onConflictDoNothing()");
  const lock = source.search(/^\s+FOR UPDATE$/m);
  assert.ok(insert > 0 && lock > insert);
});
