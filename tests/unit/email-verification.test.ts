import assert from "node:assert/strict";
import { test } from "node:test";

import { isEmailVerified } from "../../src/lib/auth/email-verification";

// SEC-003: only Auth-owned fields prove verification.
test("user metadata never proves verification", () => {
  assert.equal(isEmailVerified({ user_metadata: { email_verified: true, emailVerified: true, email_verified_at: "2026-01-01" } } as never), false);
  assert.equal(isEmailVerified({ email_verified: true } as never), false);
});

test("a confirmation timestamp or the server-owned app claim does", () => {
  assert.equal(isEmailVerified({ email_confirmed_at: "2026-01-01T00:00:00Z" }), true);
  assert.equal(isEmailVerified({ confirmed_at: "2026-01-01T00:00:00Z" }), true);
  assert.equal(isEmailVerified({ app_metadata: { email_verified: true } }), true);
  assert.equal(isEmailVerified({ app_metadata: { email_verified: "true" } }), false);
  assert.equal(isEmailVerified({ app_metadata: { email_verified: false } }), false);
  assert.equal(isEmailVerified(null), false);
});
