import assert from "node:assert/strict";
import { test } from "node:test";

process.env.CSRF_TOKEN_SECRET ??= "test-csrf-secret-test-csrf-secret-0123456789";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateCsrf } = require("../../src/lib/security/csrf") as typeof import("../../src/lib/security/csrf");

const post = (headers: Record<string, string>) => new Request("https://app.test/api/v1/x", { method: "POST", headers: { host: "app.test", ...headers } });

// SEC-001: a Bearer label is not a CSRF exemption by itself.
test("an extension token without session cookies needs no CSRF token", () => {
  assert.equal(validateCsrf(post({ authorization: "Bearer nb_dev_abc123" })), null);
});

test("a Bearer header next to a session cookie still needs origin and token", async () => {
  for (const authorization of ["Bearer nb_dev_abc123", "Bearer anything", "Bearer "]) {
    const response = validateCsrf(post({ authorization, cookie: "sb-project-auth-token=abc" }));
    assert.equal(response?.status, 403, authorization);
  }
});

test("a bearer that is not an extension token gets no exemption", () => {
  assert.equal(validateCsrf(post({ authorization: "Bearer eyJhbGciOi.fake.jwt" }))?.status, 403);
  assert.equal(validateCsrf(post({ authorization: "Bearer " }))?.status, 403);
});

test("cookie requests are unchanged: missing token is rejected", () => {
  assert.equal(validateCsrf(post({ cookie: "sb-project-auth-token=abc", origin: "https://app.test" }))?.status, 403);
});
