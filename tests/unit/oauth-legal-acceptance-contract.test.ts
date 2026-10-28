import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("Google and GitHub OAuth return through versioned legal acceptance", () => {
  const callback = readFileSync(resolve(process.cwd(), "src/app/auth/callback/route.ts"), "utf8");
  const login = readFileSync(resolve(process.cwd(), "src/components/auth/LoginForm.tsx"), "utf8");
  const signup = readFileSync(resolve(process.cwd(), "src/components/auth/SignupForm.tsx"), "utf8");
  // Both forms use the one shared provider pair, which wraps every return in the legal step.
  const oauthButtons = readFileSync(resolve(process.cwd(), "src/components/auth/AuthShell.tsx"), "utf8");

  assert.match(oauthButtons, /const legalNext = `\/legal\/accept\?context=oauth_signup&next=\$\{encodeURIComponent\(next\)\}`/);
  assert.match(oauthButtons, /signInWithGoogle\(legalNext\)/);
  assert.match(oauthButtons, /signInWithGitHub\(legalNext\)/);
  assert.match(login, /<OAuthButtons next=\{redirectPath\}/);
  assert.match(signup, /<OAuthButtons next=\{afterSignupPath\}/);
  assert.match(callback, /requestedUrl\.pathname === '\/legal\/accept'/);
  assert.match(callback, /requestedUrl\.searchParams\.get\('context'\) === 'oauth_signup'/);
  assert.match(callback, /getLegalAcceptanceState\(data\.user\.id\)/);
  assert.match(callback, /isLegalAcceptance && !hasCurrentAcceptance/);
  assert.match(callback, /isLegalAcceptance && hasCurrentAcceptance/);
  assert.match(callback, /legalUrl\.searchParams\.set\('next', `\$\{onboardingUrl\.pathname\}/);
  assert.ok(callback.indexOf("if (isLegalAcceptance && !hasCurrentAcceptance)") < callback.indexOf("destinationPath = `${onboardingUrl.pathname}"));
});

test("cookie consent is available on authentication routes without a third-party analytics script", () => {
  const layout = readFileSync(resolve(process.cwd(), "src/app/root-document.tsx"), "utf8");
  const runtime = readFileSync(resolve(process.cwd(), "src/components/privacy/CookieConsentRuntime.tsx"), "utf8");
  const panel = readFileSync(resolve(process.cwd(), "src/components/privacy/CookieConsentPanel.tsx"), "utf8");
  const legalLinks = readFileSync(resolve(process.cwd(), "src/components/legal/LegalLinks.tsx"), "utf8");

  assert.match(layout, /<CookieConsentRuntime \/>/);
  assert.match(runtime, /new Set\(\["\/login", "\/signup"\]\)/);
  assert.doesNotMatch(runtime, /@vercel\/analytics|<Analytics/);
  assert.match(runtime, /dynamic\(\(\) => import\("\.\/CookieConsentPanel"\)/);
  assert.match(panel, /Reject optional/);
  assert.match(panel, /Accept all/);
  assert.match(panel, /Customize cookie settings/);
  assert.match(legalLinks, /CookieSettingsButton/);
});

test("Google One Tap uses a nonce, bridges the Supabase session, and preserves legal enforcement", () => {
  const oneTap = readFileSync(resolve(process.cwd(), "src/components/auth/GoogleOneTap.tsx"), "utf8");
  const authProvider = readFileSync(resolve(process.cwd(), "src/lib/auth/browser-auth-actions.ts"), "utf8");
  const mainLayout = readFileSync(resolve(process.cwd(), "src/app/(site)/(main)/layout.tsx"), "utf8");

  assert.match(oneTap, /createGoogleOneTapNonce\(\)/);
  assert.match(oneTap, /use_fedcm_for_prompt: true/);
  assert.match(oneTap, /auto_select: false/);
  assert.match(oneTap, /signInWithGoogleIdToken\(credential, raw\)/);
  assert.match(oneTap, /window\.location\.assign\(normalizedNextPath\)/);
  assert.match(authProvider, /supabase\.auth\.signInWithIdToken/);
  assert.match(authProvider, /syncBrowserSessionToServer\(result\.data\.session\)/);
  assert.match(mainLayout, /hasCurrentLegalAcceptance\(user\.id\)/);
});
