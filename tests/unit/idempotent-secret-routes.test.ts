import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// SEC-004, SEC-005: a route that returns session tokens or recovery codes must
// not store its response body in the shared idempotency cache.
const SECRET_ROUTES = ["src/app/api/v1/auth/signup/route.ts", "src/app/api/v1/auth/mfa/recovery-codes/route.ts"];

for (const path of SECRET_ROUTES) {
  test(`${path} does not cache its response body`, () => {
    const source = readFileSync(path, "utf8");
    const call = source.match(/withIdempotentRoute\(request,\s*\{[^}]*\}/);
    assert.ok(call, "uses withIdempotentRoute");
    assert.match(call[0], /replayBody:\s*false/);
  });
}
