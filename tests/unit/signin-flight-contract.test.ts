import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

// The sign-in welcome flight is wired through several places that must agree. The browser spec proves it works;
// these keep the wiring from being undone by an unrelated edit, and keep onboarding's own flight untouched.

test("the host is mounted once in the root document, next to onboarding's, and the curtain script runs in the head", () => {
  const root = read("src/app/root-document.tsx");
  assert.match(root, /import \{ SignInFlightHost \} from "@\/components\/auth\/SignInFlight"/);
  assert.equal((root.match(/<SignInFlightHost \/>/g) ?? []).length, 1);
  assert.equal((root.match(/<WelcomeFlightHost \/>/g) ?? []).length, 1, "onboarding keeps its own host");
  assert.match(root, /id="signin-curtain"[\s\S]*__html: SIGNIN_CURTAIN_SCRIPT/);
  assert.ok(root.indexOf('id="theme-prehydrate"') < root.indexOf('id="signin-curtain"'), "the theme is applied before the curtain is drawn in its colour");
});

test("onboarding's flight is untouched: its own words, its own events, nothing of the sign-in flight in it", () => {
  const overlay = read("src/components/onboarding/WelcomeFlightOverlay.tsx");
  assert.match(overlay, /Your presence is activated/);
  assert.match(overlay, /Welcome to NetworkBase, \{flight\.fullName\}!/);
  assert.match(overlay, /recordWelcomeFlight/);
  assert.doesNotMatch(overlay, /signin|SignIn/i);
  const host = read("src/components/onboarding/WelcomeFlight.tsx");
  assert.doesNotMatch(host, /signin|SignIn/i);
});

test("the sign-in flight sets its own attributes, and the shared hold and reveal rules add a rise only for it", () => {
  const css = read("src/app/globals.css");
  assert.doesNotMatch(css, /data-signin-curtain\]::before/, "the curtain lives with its script, not in a stylesheet that may be late or stale");
  assert.match(read("src/lib/auth/signin-flight.ts"), /style\.textContent = \$\{JSON\.stringify\(SIGNIN_CURTAIN_CSS\)\}/);
  assert.match(css, /html\[data-signin-flight\]\[data-welcome-flight="reveal"\] \.nb-main-frame > header,\s*html\[data-signin-flight\]\[data-welcome-flight="reveal"\] \.nb-main-frame > main \{ animation-name:nb-signin-rise; \}/);
  assert.match(css, /@keyframes nb-signin-rise \{ from \{ opacity:0; transform:translateY\(8px\); \} to \{ opacity:1; transform:none; \} \}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{\s*html\[data-signin-flight\]\[data-welcome-flight="reveal"\] :is\(/);
  assert.match(css, /html\[data-reduce-motion="true"\]\[data-signin-flight\]\[data-welcome-flight="reveal"\]/);
  // The curtain sits above the page and below the overlay (z-[1000]).
  assert.match(read("src/components/auth/SignInFlightOverlay.tsx"), /fixed inset-0 z-\[1000\]/);
});

test("every way in sets the marker: password and code through the form, Google and GitHub through the buttons, One Tap on success", () => {
  const form = read("src/components/auth/LoginForm.tsx");
  assert.match(form, /rememberSignInMethod\(method\)\s*\/\/[^\n]*\n\s*markSignIn\(redirectPath\)/, "set before the code step, so it survives it");
  assert.match(form, /await leaveWithWelcome\(\)/);
  const shell = read("src/components/auth/AuthShell.tsx");
  assert.match(shell, /markSignIn\(next\)\s*\n\s*const \{ error \} = await startOAuthSignIn/);
  assert.match(shell, /clearSignInMarker\(\)/, "a failed start leaves no marker behind");
  const oneTap = read("src/components/auth/GoogleOneTap.tsx");
  assert.match(oneTap, /markSignIn\(normalizedNextPath\);\s*\n\s*window\.location\.assign\(normalizedNextPath\)/);
});

test("the sign-in form: the button turns to a check, the flight starts from it, and every fallback is the plain move", () => {
  const form = read("src/components/auth/LoginForm.tsx");
  assert.match(form, /void preloadSignInFlight\(\)/, "loaded while the person types");
  assert.match(form, /data-signin-submit=""/);
  assert.match(form, /busy=\{busy && !accepted\} disabled=\{busy \|\| accepted\}/, "no second press once accepted");
  assert.match(form, /welcomeAnimationOff\(\) \|\| document\.hidden/);
  assert.match(form, /router\.prefetch\(redirectPath\)/, "the next page loads while the check shows");
  assert.match(form, /startSignInFlight\(\{ \.\.\.identity, next: redirectPath, version, from, navigate: true \}\)\) return\s*plain\('not-started'\)/);
  assert.match(form, /plain\('no-identity'\)/);
  assert.match(form, /const plain = \(reason: string\) => \{\s*logger\.warn\('auth\.signin_flight\.plain_move', \{ reason \}\)\s*clearSignInMarker\(\)\s*router\.replace\(redirectPath\)/, "a fallback says why and leaves no marker for a late animation");
});

test("the overlay never leaves the person behind a curtain, and stops when nobody is looking", () => {
  const overlay = read("src/components/auth/SignInFlightOverlay.tsx");
  assert.match(overlay, /const watchdog = setTimeout\(/, "a hard time limit");
  assert.match(overlay, /delete root\.dataset\.welcomeFlight/);
  assert.match(overlay, /delete root\.dataset\.signinFlight/);
  assert.match(overlay, /releaseSignInCurtain\(\)/);
  assert.match(overlay, /window\.location\.replace\(flight\.next\)/, "a page that never came is fetched the plain way");
  assert.match(overlay, /event\.key === 'Escape' \|\| event\.key === 'Enter'/);
  assert.match(overlay, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  assert.match(overlay, /isReducedMotionEnabled\(/);
  assert.match(overlay, /signInAnnouncement\(flight\.fullName\)/, "one spoken sentence");
  assert.match(overlay, /clickable && 'pointer-events-none'/, "the page takes clicks before the light version lands");
});

test("the host consumes the marker when a flight starts, waits on pages on the way in, drops it on onboarding", () => {
  const host = read("src/components/auth/SignInFlight.tsx");
  assert.match(host, /clearSignInMarker\(\)\s*\n\s*writeSignInPlayedAt\(\)/);
  assert.match(host, /action === 'wait'\) return/);
  assert.match(host, /action === 'drop' \|\| welcomeAnimationOff\(\) \|\| document\.hidden/);
});

test("a flight starts over a page only when the page was covered from its first paint", () => {
  const host = read("src/components/auth/SignInFlight.tsx");
  assert.match(host, /if \(!document\.documentElement\.hasAttribute\('data-signin-curtain'\)\) \{\s*logger\.warn\('auth\.signin_flight\.arrival_skipped', \{ reason: 'no-curtain' \}\)\s*clearSignInMarker\(\)\s*return\s*\}/);
});

test("signing out clears the device but keeps the record of when the animation last played, so the second sign-in of the day is light", () => {
  const cache = read("src/lib/utils/cache-manager.ts");
  assert.match(cache, /import \{ SIGNIN_PLAYED_KEY \} from "@\/lib\/auth\/signin-flight"/);
  assert.match(cache, /COOKIE_CONSENT_STORAGE_KEY,\s*\/\/[^\n]*\n\s*SIGNIN_PLAYED_KEY,/);
});

test("the account's own switch is read while the picture loads, so a device that never saw it still respects it", () => {
  const host = read("src/components/auth/SignInFlight.tsx");
  assert.match(host, /readAppearanceSettings\(\)/);
  assert.match(host, /appearance\?\.snapshot\?\.welcomeAnimation === false\) return null/);
});

test("the setting is in Appearance, on by default, and saved with the other appearance choices", () => {
  const settings = read("src/components/settings/AppearanceSettings.tsx");
  assert.match(settings, /title="Welcome animation"/);
  assert.match(settings, /data-testid="appearance-welcome-animation-toggle"/);
  const provider = read("src/components/providers/theme-provider.tsx");
  assert.match(provider, /welcomeAnimation: patch\.welcomeAnimation \?\? welcomeAnimation/);
  assert.match(provider, /setWelcomeAnimationState\(snapshot\.welcomeAnimation\)/);
});

test("the words have no exclamation mark and the telemetry takes only its own three events from a signed-in person, rate limited", () => {
  const lib = read("src/lib/auth/signin-flight.ts");
  assert.doesNotMatch(lib, /Welcome back!|Ada!|again!|, \$\{name\}!/);
  const action = read("src/app/actions/signin-flight.ts");
  assert.match(action, /z\.enum\(SIGNIN_FLIGHT_EVENT_TYPES\)/);
  assert.match(action, /auth\.getUser\(\)/);
  assert.match(action, /consumeRateLimit\(/);
});

test("who just signed in is read from the server (the cookie), because after a Google or GitHub return the browser has no session yet", () => {
  const host = read("src/components/auth/SignInFlight.tsx");
  assert.match(host, /fetch\('\/api\/v1\/me', \{ credentials: 'same-origin'/);
  assert.doesNotMatch(host, /supabase|getSession/, "no dependence on the browser's own session");
  assert.match(host, /logger\.warn\('auth\.signin_flight\.no_identity', \{ reason \}\)/, "a skip says why");
  const me = read("src/app/api/v1/me/route.ts");
  assert.match(me, /visibility: profiles\.visibility/);
  assert.match(me, /visibility: profile\?\.visibility \?\? "public"/);
});

test("both versions greet in the middle of the screen, and the greeting is gone as the app comes in", () => {
  const overlay = read("src/components/auth/SignInFlightOverlay.tsx");
  assert.doesNotMatch(overlay, /captionTimer|lightRest|captionOutAt/, "no timer that can leave the greeting over the app");
  assert.match(overlay, /const rising = moveTo\(centre\.box, t\.rise\)/);
  assert.match(overlay, /root\.dataset\.welcomeFlight = 'reveal'\s*\/\/[^\n]*\n\s*setCaption\(0\)/, "the greeting leaves with the reveal");
});

