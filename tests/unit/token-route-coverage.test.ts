import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { tokenRouteScope } from "../../src/lib/security/token-access";

/**
 * Every API route that signs people in must be classified on purpose (report A3.7): either listed in
 * TOKEN_ROUTES (src/lib/security/token-access.ts) or here as browser-only. A new route fails this test
 * until someone decides whether CLI and agent tokens may call it.
 */
const BROWSER_ONLY = new Set([
  "account/delete",
  "account/deletion-preflight",
  "account/export",
  "account/export-status",
  "account/reserved-usernames",
  "appearance",
  "auth/change-password",
  "auth/mfa/factors/[id]",
  "auth/mfa/recovery-codes",
  "auth/password-safety",
  "auth/security-step-up",
  "auth/trusted-browser",
  "chat/attachments/[assetId]",
  "chat/attachments/presign",
  "cleanup-orphan",
  "cli/tokens",
  "github/account/replacement",
  "github/import/abort",
  "github/import/batch-file-intent",
  "github/import/finalize-file",
  "github/import/finalize-manifest",
  "github/import/init",
  "github/import/status",
  "integrations",
  "integrations/unlink",
  "legal/acceptance",
  "link-preview",
  "privacy",
  "privacy/blocks",
  "privacy/blocks/[userId]",
  "profiles/[id]/workspace-invite-options",
  "profiles/[id]/workspace-invites",
  "security",
  "sessions",
  "skills/proposals",
  "skills/resolve",
  "workspaces/[id]/tasks/[taskId]/merge",
]);

const ROOT = path.join(process.cwd(), "src/app/api/v1");
const SIGNS_IN = /requireAuthenticatedUser|_file-lease-route|from ["']@\/app\/api\/v1\/extension\//;

it("classifies every signed-in API route for CLI and agent tokens", () => {
  const unclassified: string[] = [];
  const conflicting: string[] = [];
  for (const file of fs.readdirSync(ROOT, { recursive: true, encoding: "utf8" })) {
    if (path.basename(file) !== "route.ts") continue;
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (!SIGNS_IN.test(source)) continue;
    const rel = path.dirname(file).split(path.sep).join("/");
    const samplePath = `/api/v1/${rel.replace(/\[[^\]]+\]/g, "x")}`;
    const methods = [...source.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD)\b|export \{\s*(GET|POST|PUT|PATCH|DELETE)\s*\}/g)].map((m) => m[1] ?? m[2] ?? "GET");
    const tokenAllowed = methods.some((method) => tokenRouteScope(method, samplePath) !== "forbidden");
    if (tokenAllowed && BROWSER_ONLY.has(rel)) conflicting.push(rel);
    if (!tokenAllowed && !BROWSER_ONLY.has(rel)) unclassified.push(rel);
  }
  assert.deepEqual(conflicting, [], "listed both as token route and browser-only");
  assert.deepEqual(unclassified, [], "decide in src/lib/security/token-access.ts or BROWSER_ONLY here");
});

it("the proxy runs on every API path, so the trusted method/path headers can't come from the client", () => {
  const proxy = fs.readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
  assert.match(proxy, /matcher: \[\s*(\/\/[^\n]*\n\s*)*"\/api\/:path\*"/, 'src/proxy.ts matcher must list "/api/:path*" first');
});
