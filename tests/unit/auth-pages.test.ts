import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { mailAppFor } from "@/lib/auth/last-method";
import { buildSecurityEmail, isAuthCodeEmailKind, isSecurityEmailKind } from "@/lib/email/security-templates";

// Sign-in pages (docs/superpowers/plans/2026-11-09-auth-pages-findings.md), items A1–D20.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("D20: a mail app button only for services with a web inbox", () => {
  assert.equal(mailAppFor("me@gmail.com")?.label, "Open Gmail");
  assert.equal(mailAppFor("Me@Outlook.com")?.label, "Open Outlook");
  assert.equal(mailAppFor("me@school.edu"), null);
  assert.equal(mailAppFor("not-an-email"), null);
});

test("A2, B11: the code emails carry the code and the any-device link; C17 names the browser", () => {
  const person = { email: "a@b.test", name: "there" };
  const reset = buildSecurityEmail("auth_reset_code", { code: "123456", link: "https://networkbase.in/auth/confirm?token_hash=x&type=recovery" }, person);
  assert.match(reset.subject, /^123456 is your NetworkBase reset code$/);
  assert.match(reset.html, /token_hash=x/);
  assert.match(reset.text, /any device/);
  const signIn = buildSecurityEmail("auth_sign_in_code", { code: "654321" }, person);
  assert.match(signIn.subject, /654321/);
  const newSignIn = buildSecurityEmail("security_new_sign_in", { detail: "Safari on macOS" }, person);
  assert.match(newSignIn.html, /Safari on macOS/);
  assert.equal(isAuthCodeEmailKind("auth_reset_code"), true);
  assert.equal(isSecurityEmailKind("security_new_sign_in"), true);
  assert.equal(isSecurityEmailKind("auth_reset_code"), false, "codes go to the typed address, not through the profile path");
});

test("A1: the return step names Google, GitHub or the reset link", () => {
  const callback = read("src/app/auth/callback/route.ts");
  assert.match(callback, /`\$\{provider\}-failed`/);
  assert.match(callback, /'reset-link-expired'/);
  assert.doesNotMatch(callback, /'auth-code-error'/);
});

test("A2: reset codes and sign-in codes come from the app, the same answer whether or not the account exists", () => {
  const route = read("src/app/api/v1/auth/email-code/route.ts");
  assert.match(route, /generateLink\(\{ type: purpose === "reset" \? "recovery" : "magiclink"/);
  assert.equal((route.match(/return jsonSuccess\(\{ sent: true \}\)/g) ?? []).length, 3);
  assert.match(route, /auth-email-code:email:/);
  assert.match(route, /verifyTurnstileToken\(/);
  const confirm = read("src/app/auth/confirm/route.ts");
  assert.match(confirm, /verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
  const forgot = read("src/app/(site)/(auth)/forgot-password/page.tsx");
  assert.match(forgot, /type: 'recovery'/);
  assert.doesNotMatch(forgot, /resetPasswordForEmail/);
});

test("A3: a recovery code at sign-in is used once, then the lost authenticator is removed and an email says so", () => {
  const route = read("src/app/api/v1/auth/mfa/recover/route.ts");
  const redeem = route.indexOf("redeemRecoveryCode(");
  assert.ok(redeem > 0 && redeem < route.indexOf("deleteFactor("), "the code is checked before anything is removed");
  assert.match(route, /forgetMfaFactorCache\(user\.id\)/);
  assert.match(route, /queueSecurityEmail\(user\.id, "security_mfa_changed", \{ detail: "removed" \}\)/);
  assert.match(read("src/app/api/v1/auth/security-step-up/route.ts"), /redeemRecoveryCode\(user\.id, rawCode, verifiedTotpFactorIds\)/);
  assert.match(read("src/components/auth/LoginForm.tsx"), /Lost your device\?/);
});

test("A4, B16: an unconfirmed email gets the code box; three wrong passwords offer a code or a reset", () => {
  const login = read("src/components/auth/LoginForm.tsx");
  assert.match(login, /if \(\/email not confirmed\/i\.test\(result\.error\.message\)\) \{\s*setStep\('confirm-email'\)/);
  assert.match(login, /const WRONG_PASSWORD_HELP_AFTER = 3/);
  assert.match(login, /Email me a sign-in code instead/);
});

test("A5, A6, B8, B9: sign-up keeps its code step, helps on a used email, drops confirm password and the handle check", () => {
  const signup = read("src/components/auth/SignupForm.tsx");
  assert.match(signup, /sessionStorage\.setItem\(VERIFY_STEP_KEY, email\.trim\(\)\)/);
  assert.match(signup, /Sign in instead/);
  assert.match(signup, /Reset your password/);
  assert.doesNotMatch(signup, /confirmPassword|Confirm password/);
  assert.doesNotMatch(signup, /username-check/);
});

test("B10, D1: the buttons show 'Last used' and carry the agreement line; a new account records it", () => {
  const shell = read("src/components/auth/AuthShell.tsx");
  assert.match(shell, /lastUsed === provider/);
  assert.match(shell, /By continuing with Google or GitHub, you confirm you’re 18 or older/);
  const callback = read("src/app/auth/callback/route.ts");
  assert.match(callback, /recordCurrentLegalAcceptance\(\{ userId: data\.user\.id, request, context: 'oauth_signup', ageConfirmed: true \}\)/);
  assert.match(callback, /!previousUserData\.user && isLegalAcceptance && !acceptanceState\?\.latest/);
  assert.match(read("src/app/api/v1/auth/google-one-tap/route.ts"), /if \(acceptance && !acceptance\.latest\)/);
});

test("C18: a trusted browser skips the code in both gates; staff never; signing out everywhere ends trust", () => {
  assert.match(read("src/lib/supabase/middleware.ts"), /isSecondFactorDue\(user\.id, userAal, request\.cookies\.get\('nb-device'\)\?\.value\)/);
  assert.match(read("src/lib/supabase/server.ts"), /withSecondFactorGate\(resolution, cookieStore\.getAll\(\)/);
  const trust = read("src/app/api/v1/auth/trusted-browser/route.ts");
  assert.match(trust, /role === "admin" \|\| role === "moderator"/);
  assert.match(trust, /level\?\.currentLevel !== "aal2"/);
  assert.match(read("src/app/api/v1/sessions/route.ts"), /stopTrustingDevices\(user\.id\)/);
});

test("C17: every way in records the browser", () => {
  assert.match(read("src/app/api/v1/auth/session/route.ts"), /await noteSignIn\(request, response, data\.user\.id\)/);
  assert.match(read("src/app/auth/callback/route.ts"), /if \(!previousUser\) await noteSignIn\(request, response, data\.user\.id\)/);
  assert.match(read("src/app/auth/confirm/route.ts"), /await noteSignIn\(request, response, data\.user\.id\)/);
});

test("B13: on sign-in pages a phone gets the short cookie bar", () => {
  assert.match(read("src/components/privacy/CookieConsentRuntime.tsx"), /compact=\{AUTH_ENTRY_PATHS\.has\(pathname\)\}/);
  assert.match(read("src/components/privacy/CookieConsentPanel.tsx"), /Cookies keep you signed in/);
});
