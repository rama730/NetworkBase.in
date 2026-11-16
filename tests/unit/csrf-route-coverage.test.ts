import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const API_V1_ROOT = path.resolve(process.cwd(), "src/app/api/v1");
const EXEMPT_MUTATING_ROUTES = new Set([
  path.resolve(API_V1_ROOT, "webhooks/github/route.ts"),
  path.resolve(API_V1_ROOT, "webhooks/resend/route.ts"),
  path.resolve(API_V1_ROOT, "extension/auth-code/route.ts"),
  path.resolve(API_V1_ROOT, "email/org-mute/route.ts"),
  // The device sign-in (RFC 8628) runs before there is any session: no cookie is read, nothing ambient to forge.
  path.resolve(API_V1_ROOT, "device/code/route.ts"),
  path.resolve(API_V1_ROOT, "device/token/route.ts"),
]);

function collectRouteFiles(root: string, files: string[] = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath);
    }
  }
  return files;
}

test("mutating API v1 routes require CSRF validation unless explicitly exempted", () => {
  const routeFiles = collectRouteFiles(API_V1_ROOT);

  for (const filePath of routeFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const hasMutatingHandler = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(source);
    if (!hasMutatingHandler || EXEMPT_MUTATING_ROUTES.has(filePath)) {
      if (filePath.endsWith("extension/auth-code/route.ts")) {
        assert.match(source, /csrfProtection = "one-time-code-and-state"/);
        assert.match(source, /timingSafeEqual/);
      }
      if (filePath.endsWith("webhooks/resend/route.ts")) {
        // Provider callbacks have no browser session/CSRF token. Their raw
        // payload must pass signature verification before any persistence.
        assert.match(source, /verifyResendEvent\(Buffer\.concat\(chunks\)/);
        assert.ok(source.indexOf("verified = verifyResendEvent") < source.indexOf("await recordResendEvent"));
        assert.match(fs.readFileSync(path.resolve("src/lib/email/contracts.ts"), "utf8"), /new Webhook\(secret\)\.verify\(raw, headers\)/);
      }
      if (filePath.includes(`${path.sep}device${path.sep}`)) {
        assert.doesNotMatch(source, /requireAuthenticatedUser|cookies\(/, "device sign-in routes read no session");
      }
      if (filePath.endsWith("email/org-mute/route.ts")) {
        // One-click unsubscribe (RFC 8058) posts from the mail provider with no session: the signed
        // token is the only credential and is checked before anything changes.
        assert.match(source, /readOrgMuteToken\(/);
        assert.ok(source.indexOf("readOrgMuteToken(") < source.indexOf("await muteOrgEmails("));
        assert.match(fs.readFileSync(path.resolve("src/lib/email/org-templates.ts"), "utf8"), /timingSafeEqual/);
      }
      continue;
    }

    // The change set routes share one wrapper that validates CSRF for every write (src/app/api/v1/change-sets/_route.ts).
    const checked = source.includes("changeSetRoute(") ? fs.readFileSync(path.resolve(API_V1_ROOT, "change-sets/_route.ts"), "utf8") : source;
    assert.match(
      checked,
      /validateCsrf\(|csrf:\s*true/,
      `${path.relative(process.cwd(), filePath)} is missing validateCsrf()`,
    );
  }
});
