import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

// An editor token signs in as the whole person, so routes that change the account itself must turn it away.
const BROWSER_ONLY = [
  "src/app/api/v1/account/delete/route.ts",
  "src/app/api/v1/auth/change-password/route.ts",
  "src/app/api/v1/integrations/unlink/route.ts",
  "src/app/api/v1/legal/acceptance/route.ts",
];

for (const path of BROWSER_ONLY) {
  test(`${path} refuses editor tokens`, () => {
    assert.match(read(path), /if \(auth\.extensionSessionId\) return (jsonError|fail)\(/);
  });
}

test("the step-up route is limited per person, not only per network", () => {
  assert.match(read("src/app/api/v1/auth/security-step-up/route.ts"), /enforceRouteLimit\(request, "api:v1:auth:security-step-up:user", \d+, \d+, "default", user\.id\)/);
});

test("commit-identity actions are rate limited", () => {
  const source = read("src/app/actions/github-sync.ts");
  assert.ok((source.match(/consumeRateLimit\(/g) ?? []).length >= 2);
});

// What a stolen editor token must not outlive: the three events that protect the account.
for (const path of ["src/app/api/v1/auth/change-password/route.ts", "src/app/api/v1/sessions/route.ts", "src/app/api/v1/account/delete/route.ts"]) {
  test(`${path} ends the person's editor tokens`, () => {
    assert.match(read(path), /revokeAllExtensionSessionsForUser\(/);
  });
}

// An account with an authenticator must prove it for the actions that cannot be undone: a password alone is not enough.
for (const path of ["src/app/api/v1/account/delete/route.ts", "src/app/api/v1/github/account/replacement/route.ts"]) {
  test(`${path} uses the step-up that requires the authenticator when there is one`, () => {
    const source = read(path);
    assert.match(source, /resolveDestructiveStepUp\(/);
    assert.doesNotMatch(source, /resolveSecurityStepUp\(/);
  });
}

test("the Google link follow-up is gated on a real link, not on the address alone", () => {
  const source = read("src/app/auth/callback/route.ts");
  assert.match(source, /const googleLinked = provider === 'google'[\s\S]*previousUser\?\.id === data\.user\.id[\s\S]*identity\.provider === 'google'/);
  assert.match(source, /if \(googleLinked\)/);
});
