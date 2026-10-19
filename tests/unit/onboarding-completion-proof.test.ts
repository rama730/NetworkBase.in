import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hasOnboardingClaims } from "../../src/lib/onboarding/state";

// AUTH-012: a user can write their own user_metadata, so it never proves completion.
test("only app_metadata proves onboarding completion", () => {
  assert.equal(hasOnboardingClaims({ app_metadata: { onboarding_complete: true } }), true);
  assert.equal(hasOnboardingClaims({ app_metadata: { onboarding_completed: true } }), true);
  const forged = { user_metadata: { username: "x", onboarding_completed: true, onboarding_status: "completed", onboarded: true } };
  assert.equal(hasOnboardingClaims(forged as never), false);
  assert.equal(hasOnboardingClaims({ app_metadata: { onboarding_complete: "true" } }), false);
});

test("no unsigned cookie decides completion", () => {
  for (const file of ["src/lib/onboarding/completion.ts", "src/lib/supabase/middleware.ts", "src/lib/onboarding/state.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /onboardingCompleteCookieName/, file);
  }
});

// AUTH-010: claim repair needs the recorded completion state and a confirmed email.
test("claim repair does not trust a username alone", () => {
  const source = readFileSync("src/app/actions/onboarding.ts", "utf8");
  const repair = source.slice(source.indexOf("export async function repairOnboardingClaims"), source.indexOf("export async function getUsernameSuggestions"));
  assert.match(repair, /onboarding_status/);
  assert.match(repair, /isCompletedOnboardingStatus\(profile\.onboarding_status/);
  assert.match(repair, /!isEmailVerified\(user/);
});
