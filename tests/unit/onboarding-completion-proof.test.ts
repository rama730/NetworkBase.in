import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hasOnboardingClaims } from "../../src/lib/onboarding/state";

// AUTH-012: a user can write their own user_metadata, so it never proves completion.
test("only app_metadata proves onboarding completion", () => {
  assert.equal(hasOnboardingClaims({ app_metadata: { onboarding_complete: true } }), true);
  assert.equal(hasOnboardingClaims({ app_metadata: { onboarding_completed: true } }), false);
  const forged = { user_metadata: { username: "x", onboarding_completed: true, onboarding_status: "completed", onboarded: true } };
  assert.equal(hasOnboardingClaims(forged as never), false);
  assert.equal(hasOnboardingClaims({ app_metadata: { onboarding_complete: "true" } }), false);
});

test("no unsigned cookie decides completion", () => {
  for (const file of ["src/lib/onboarding/completion.ts", "src/lib/supabase/middleware.ts", "src/lib/onboarding/state.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /onboardingCompleteCookieName/, file);
  }
});

// AUTH-010: the claim is only written for a recorded completion and a confirmed email.
test("the claim self-heal needs the recorded status and a verified email", () => {
  const source = readFileSync("src/lib/onboarding/completion.ts", "utf8");
  const heal = source.slice(source.indexOf("function healClaim"), source.indexOf("export async function hasCompletedOnboarding"));
  assert.match(heal, /isEmailVerified\(user/);
  assert.match(source, /isCompletedOnboardingStatus\(profile\?\.onboardingStatus\)[\s\S]*healClaim\(user\)/);
});
