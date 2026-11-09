import { describe, it } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";

import { checkTokenAccess, effectiveScopes, tokenRouteScope, TOKEN_SCOPES, TRUSTED_METHOD_HEADER, TRUSTED_TARGET_HEADER } from "../../src/lib/security/token-access";

describe("token scopes (report A3.6)", () => {
  it("maps scopes shown on tokens made before enforcement to what they could do", () => {
    const read = effectiveScopes("pat", ["repo:read"]);
    assert.deepEqual([...read].sort(), ["file:read", "task:read", "workspace:read"]);
    const write = effectiveScopes("pat", ["repo:write"]);
    for (const s of ["file:write", "file:final", "file:delete", "file:read"] as const) assert.ok(write.has(s), s);
    const task = effectiveScopes("pat", ["task:write"]);
    for (const s of ["task:read", "task:write", "task:complete"] as const) assert.ok(task.has(s), s);
    assert.ok(!task.has("file:write"));
  });

  it("gives a device token everything except asking other people", () => {
    const scopes = effectiveScopes("device", []);
    assert.equal(scopes.size, TOKEN_SCOPES.length - 1);
    assert.ok(!scopes.has("ask:others"));
  });

  it("treats a personal token saved without scopes as repo:read + repo:write", () => {
    const scopes = effectiveScopes("pat", null);
    assert.ok(scopes.has("file:write"));
    assert.ok(!scopes.has("task:write"));
  });

  it("keeps new scope names and ignores unknown ones", () => {
    assert.deepEqual([...effectiveScopes("pat", ["doc:write", "root:everything"])], ["doc:write"]);
  });
});

describe("token routes (report A3.7)", () => {
  it("allows the CLI's routes with the scope each needs", () => {
    assert.equal(tokenRouteScope("GET", "/api/v1/extension/workspace-tasks?projectId=x"), "task:read");
    assert.equal(tokenRouteScope("POST", "/api/v1/extension/fast-push"), "file:write");
    assert.equal(tokenRouteScope("PATCH", "/api/v1/extension/task-update"), "task:write");
    assert.equal(tokenRouteScope("GET", "/api/v1/extension/session"), null);
    assert.equal(tokenRouteScope("POST", "/api/v1/files/abc/lock-renew"), "file:write");
  });

  it("refuses account, security and token routes", () => {
    for (const path of ["/api/v1/account/delete", "/api/v1/cli/tokens", "/api/v1/sessions", "/api/v1/auth/change-password", "/api/v1/auth/mfa/recovery-codes", "/api/v1/privacy", "/api/v1/integrations/unlink"]) {
      assert.equal(tokenRouteScope("POST", path), "forbidden", path);
      assert.equal(tokenRouteScope("GET", path), "forbidden", path);
    }
  });

  it("refuses writes on read-only token routes", () => {
    assert.equal(tokenRouteScope("GET", "/api/v1/workspaces/w1/members"), "workspace:read");
    assert.equal(tokenRouteScope("POST", "/api/v1/workspaces/w1/members"), "forbidden");
  });

  it("denies when the trusted target is missing, and names the missing scope", () => {
    const all = effectiveScopes("device", []);
    assert.equal(checkTokenAccess({ method: null, path: null, scopes: all })?.errorCode, "FORBIDDEN");
    const readOnly = effectiveScopes("pat", ["repo:read"]);
    const denial = checkTokenAccess({ method: "POST", path: "/api/v1/extension/fast-push", scopes: readOnly });
    assert.equal(denial?.errorCode, "SCOPE_MISSING");
    assert.equal(denial?.scope, "file:write");
    assert.equal(checkTokenAccess({ method: "GET", path: "/api/v1/extension/workspace-tasks", scopes: readOnly }), null);
  });
});

it("reads method and path from the same headers the proxy sets", () => {
  const proxy = fs.readFileSync("src/proxy.ts", "utf8");
  assert.match(proxy, new RegExp(`REQUEST_TARGET_HEADER = "${TRUSTED_TARGET_HEADER}"`));
  assert.match(proxy, new RegExp(`REQUEST_METHOD_HEADER = "${TRUSTED_METHOD_HEADER}"`));
});
