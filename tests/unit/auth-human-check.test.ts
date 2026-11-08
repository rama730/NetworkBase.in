import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  HUMAN_CHECK_MAX_AGE_SECONDS,
  createHumanCheckValue,
  hasPassedHumanCheck,
  humanCheckMatches,
} from "@/lib/auth/human-check";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("the pass works only for the sign-in attempt it was made for", () => {
  const value = createHumanCheckValue("rid-one");
  assert.equal(humanCheckMatches(value, "rid-one"), true);
  assert.equal(humanCheckMatches(value, "rid-two"), false);
  assert.equal(humanCheckMatches(value, null), false);
  assert.equal(humanCheckMatches(null, "rid-one"), false);
});

test("the pass runs out after ten minutes", () => {
  const madeAt = Date.now();
  const value = createHumanCheckValue("rid-one", madeAt);
  assert.equal(humanCheckMatches(value, "rid-one", madeAt + (HUMAN_CHECK_MAX_AGE_SECONDS - 1) * 1000), true);
  assert.equal(humanCheckMatches(value, "rid-one", madeAt + (HUMAN_CHECK_MAX_AGE_SECONDS + 1) * 1000), false);
});

test("a changed pass is refused", () => {
  const value = createHumanCheckValue("rid-one");
  const [rid, expiresAt, signature] = value.split(".");
  assert.equal(humanCheckMatches(`${rid}.${Number(expiresAt) + 60_000}.${signature}`, "rid-one"), false);
  assert.equal(humanCheckMatches(`rid-two.${expiresAt}.${signature}`, "rid-two"), false);
  assert.equal(humanCheckMatches(`${value}x`, "rid-one"), false);
  assert.equal(humanCheckMatches("not-a-pass", "rid-one"), false);
});

test("an account passed the check if it carries the mark or signed up with email", () => {
  assert.equal(hasPassedHumanCheck({ app_metadata: { human_checked_at: "2026-11-09T00:00:00.000Z" }, identities: [] }), true);
  assert.equal(hasPassedHumanCheck({ app_metadata: {}, identities: [{ provider: "email" }] }), true);
  assert.equal(hasPassedHumanCheck({ app_metadata: {}, identities: [{ provider: "google" }] }), false);
  assert.equal(hasPassedHumanCheck({ app_metadata: { provider: "github" } }), false);
});

test("Cloudflare's answer may carry any of the allowed page actions", async () => {
  const originalSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = "0x4AAAAAAABBBBBBCCCCCC";
  const answer = (action: string) => async () => new Response(JSON.stringify({ success: true, action }), { status: 200 });
  try {
    globalThis.fetch = answer("signup") as typeof fetch;
    assert.equal((await verifyTurnstileToken({ token: "t", expectedAction: ["login", "signup"] })).success, true);
    globalThis.fetch = answer("signup-resend") as typeof fetch;
    assert.equal((await verifyTurnstileToken({ token: "t", expectedAction: ["login", "signup"] })).success, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    else process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = originalSecret;
  }
});

test("Google and GitHub sign-in finish only with a pass, and the pass is used once", () => {
  const callback = read("src/app/auth/callback/route.ts");
  const gate = callback.indexOf("humanCheckMatches(");
  assert.ok(gate > 0, "the return step checks the pass");
  assert.ok(gate < callback.indexOf("exchangeCodeForSession(code)"), "before any session is made");
  assert.match(callback, /const humanCheckNeeded = !previousUserData\.user && isTurnstileServerConfigured\(\)/);
  assert.match(callback, /'error', 'security-check'/);
  assert.match(callback, /markHumanChecked\(data\.user\)/);
  assert.match(callback, /clearHumanCheckCookie\(response\)/);
});

test("the buttons get a pass from the server before leaving for Google or GitHub", () => {
  const actions = read("src/lib/auth/browser-auth-actions.ts");
  const buttons = read("src/components/auth/AuthShell.tsx");
  const route = read("src/app/api/v1/auth/human-check/route.ts");
  assert.match(actions, /fetch\('\/api\/v1\/auth\/human-check'/);
  assert.ok(actions.indexOf("/api/v1/auth/human-check") < actions.indexOf("signInWithOAuth"));
  assert.match(buttons, /requiresCaptcha && !captchaToken/);
  assert.match(buttons, /SECURITY_CHECK_PROMPT/);
  assert.match(route, /verifyTurnstileToken\(/);
  assert.match(route, /expectedAction: HUMAN_CHECK_ACTIONS/);
  assert.match(route, /setHumanCheckCookie\(response, parsed\.data\.rid\)/);
});

test("One Tap signs in through the server, which asks Cloudflare first", () => {
  const actions = read("src/lib/auth/browser-auth-actions.ts");
  const route = read("src/app/api/v1/auth/google-one-tap/route.ts");
  const oneTap = read("src/components/auth/GoogleOneTap.tsx");
  assert.doesNotMatch(actions, /supabase\.auth\.signInWithIdToken/);
  assert.match(actions, /fetch\('\/api\/v1\/auth\/google-one-tap'/);
  assert.ok(route.indexOf("verifyTurnstileToken(") < route.indexOf("signInWithIdToken("));
  assert.match(route, /markHumanChecked\(/);
  assert.match(oneTap, /captchaTokenRef\.current/);
});

test("a new Google or GitHub account can't accept the terms without the check", () => {
  const route = read("src/app/api/v1/legal/acceptance/route.ts");
  assert.match(route, /hasPassedHumanCheck\(auth\.user\)/);
  assert.match(route, /!state\.latest/);
  assert.ok(route.indexOf("hasPassedHumanCheck(") < route.indexOf("recordCurrentLegalAcceptance({"));
});
