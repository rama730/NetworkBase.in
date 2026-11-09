import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

// The welcome flight is wired through five places that must agree. The browser spec proves it works; these keep
// the wiring from being undone by an unrelated edit.

test("the host is mounted once, in the root document, so it survives the move from onboarding to the app", () => {
  const root = read("src/app/root-document.tsx");
  assert.match(root, /import \{ WelcomeFlightHost \} from "@\/components\/onboarding\/WelcomeFlight"/);
  assert.equal((root.match(/<WelcomeFlightHost \/>/g) ?? []).length, 1);
});

test("the top bar marks where the photo lands: the avatar on desktop, the menu button on phones", () => {
  const nav = read("src/components/layout/header/TopNav.tsx");
  assert.match(nav, /<span className="relative inline-flex" data-welcome-slot="">\s*<ProfileAvatar/);
  assert.match(nav, /data-welcome-slot-mobile=""\s*className="nb-mobile-menu-trigger/);
});

test("the app shell waits behind the photo, then fades in region by region; reduced motion drops the fade", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /html\[data-welcome-flight\] \[data-welcome-slot\] \{ visibility:hidden; \}/);
  assert.match(css, /html\[data-welcome-flight="hold"\] \.nb-sidebar,\s*html\[data-welcome-flight="hold"\] \.nb-main-frame \{ opacity:0; \}/);
  for (const region of [".nb-sidebar", ".nb-main-frame > header", ".nb-main-frame > main"]) {
    assert.ok(css.includes(`html[data-welcome-flight="reveal"] ${region} { animation:nb-welcome-in`), `${region} fades in`);
  }
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{\s*html\[data-welcome-flight="reveal"\] :is\(/);
  assert.match(css, /html\[data-reduce-motion="true"\]\[data-welcome-flight="reveal"\]/);
});

test("the page preloads the overlay, starts the flight with the photo's place, and falls back to the old navigation", () => {
  const page = read("src/app/(site)/(onboarding)/onboarding/page.tsx");
  assert.match(page, /void preloadWelcomeFlight\(\)/);
  assert.match(page, /onContinue=\{\(from\) => \{[\s\S]*startWelcomeFlight\(\{[\s\S]*visibility: data\.visibility[\s\S]*from,[\s\S]*\}\)\s*if \(!started\) window\.location\.replace\(continuePath\)/);
});

test("the finish screen cannot start two flights, and uses the same photo identity as the top bar", () => {
  const screen = read("src/components/onboarding/FinishScreen.tsx");
  assert.match(screen, /disabled=\{continuing\}/);
  assert.match(screen, /if \(continuing\) return\s*setContinuing\(true\)/);
  assert.match(screen, /identity=\{\{ id: userId, fullName, username, avatarUrl \}\}/);
});

test("the overlay never leaves the person behind a curtain", () => {
  const overlay = read("src/components/onboarding/WelcomeFlightOverlay.tsx");
  assert.match(overlay, /const watchdog = setTimeout\(/, "a hard time limit");
  assert.match(overlay, /delete root\.dataset\.welcomeFlight/, "the page is released");
  assert.match(overlay, /window\.location\.replace\(flight\.continuePath\)/, "a page that never came is fetched the old way (replace: back never returns to onboarding)");
  assert.match(overlay, /event\.key === 'Escape' \|\| event\.key === 'Enter'/);
  assert.match(overlay, /isReducedMotionEnabled\(/, "the in-app and the system setting both count");
});

test("the telemetry action takes only the three flight events, only from a signed-in person, and is rate limited", () => {
  const action = read("src/app/actions/welcome-flight.ts");
  assert.match(action, /z\.enum\(WELCOME_FLIGHT_EVENT_TYPES\)/);
  assert.match(action, /auth\.getUser\(\)/);
  assert.match(action, /consumeRateLimit\(/);
});
