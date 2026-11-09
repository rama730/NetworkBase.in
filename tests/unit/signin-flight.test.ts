import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";

import {
  buildSignInCurtainScript,
  chooseSignInVersion,
  clearSignInMarker,
  firstNameOf,
  markerPathAction,
  markSignIn,
  parseSignInMarker,
  readSignInMarker,
  readSignInPlayedAt,
  SIGNIN_CURTAIN_CSS,
  SIGNIN_CURTAIN_FAILSAFE_MS,
  SIGNIN_FLIGHT_EVENT_TYPES,
  SIGNIN_MARKER_KEY,
  SIGNIN_MARKER_TTL_MS,
  signInAnnouncement,
  signInLines,
  signInTimings,
  welcomeAnimationOff,
  wordDelays,
  worthWaitingFor,
  writeSignInPlayedAt,
} from "../../src/lib/auth/signin-flight";
import {
  APPEARANCE_STORAGE_KEYS,
  areAppearanceSnapshotsEquivalent,
  createAppearanceSnapshot,
  DEFAULT_APPEARANCE_SNAPSHOT,
  parseAppearanceSnapshot,
  readLocalAppearanceSnapshot,
  writeAppearanceSnapshot,
} from "../../src/lib/theme/appearance";

const NOW = new Date(2026, 10, 9, 15, 30).getTime();

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const brokenStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

test("the marker is valid for ten minutes and refuses garbage and a clock from the future", () => {
  const fresh = JSON.stringify({ t: NOW - 60_000, next: "/discover" });
  assert.deepEqual(parseSignInMarker(fresh, NOW), { t: NOW - 60_000, next: "/discover" });
  assert.equal(parseSignInMarker(JSON.stringify({ t: NOW - SIGNIN_MARKER_TTL_MS - 1, next: "/discover" }), NOW), null);
  assert.equal(parseSignInMarker(JSON.stringify({ t: NOW + 5 * 60_000, next: "/discover" }), NOW), null);
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "discover", ""]) {
    assert.equal(parseSignInMarker(JSON.stringify({ t: NOW, next }), NOW), null, `next: ${next}`);
  }
  assert.equal(parseSignInMarker("not json", NOW), null);
  assert.equal(parseSignInMarker(JSON.stringify({ t: "now", next: 1 }), NOW), null);
  assert.equal(parseSignInMarker(null, NOW), null);
});

test("a marker is written once, read, and consumed; blocked storage just means no animation", () => {
  const store = fakeStore();
  assert.equal(readSignInMarker(NOW, store), null);
  markSignIn("/discover", NOW, store);
  assert.deepEqual(readSignInMarker(NOW + 1000, store), { t: NOW, next: "/discover" });
  clearSignInMarker(store);
  assert.equal(readSignInMarker(NOW + 1000, store), null);
  assert.doesNotThrow(() => markSignIn("/discover", NOW, brokenStore));
  assert.equal(readSignInMarker(NOW, brokenStore), null);
  assert.doesNotThrow(() => clearSignInMarker(brokenStore));
});

test("pages on the way in wait, onboarding drops the marker, everything else plays", () => {
  for (const path of ["/login", "/signup", "/forgot-password", "/auth/callback", "/legal/accept", "/verify/email"]) {
    assert.equal(markerPathAction(path), "wait", path);
  }
  for (const path of ["/onboarding", "/onboarding/profile"]) assert.equal(markerPathAction(path), "drop", path);
  for (const path of ["/discover", "/projects/abc", "/settings", "/organizations/x"]) assert.equal(markerPathAction(path), "play", path);
  assert.equal(markerPathAction("/loginfoo"), "play");
});

test("full is the first sign-in of the day to the default page; a later one, or any deep link, is light", () => {
  const today = new Date(2026, 10, 9, 8, 0).getTime();
  const yesterday = new Date(2026, 10, 8, 23, 50).getTime();
  assert.equal(chooseSignInVersion({ playedAt: null, now: NOW, next: "/discover" }), "full");
  assert.equal(chooseSignInVersion({ playedAt: yesterday, now: NOW, next: "/discover" }), "full");
  assert.equal(chooseSignInVersion({ playedAt: today, now: NOW, next: "/discover" }), "light");
  assert.equal(chooseSignInVersion({ playedAt: null, now: NOW, next: "/projects/abc" }), "light");
  assert.equal(chooseSignInVersion({ playedAt: Number.NaN, now: NOW, next: "/discover" }), "full");
});

test("the last time it played is remembered per device and survives blocked storage", () => {
  const store = fakeStore();
  assert.equal(readSignInPlayedAt(store), null);
  writeSignInPlayedAt(NOW, store);
  assert.equal(readSignInPlayedAt(store), NOW);
  assert.doesNotThrow(() => writeSignInPlayedAt(NOW, brokenStore));
  assert.equal(readSignInPlayedAt(brokenStore), null);
});

test("the two lines use the first name, never an exclamation mark, and fall back without a name", () => {
  assert.equal(firstNameOf("  Ada   Lovelace "), "Ada");
  assert.deepEqual(signInLines("Ada Lovelace"), { first: "Welcome back", second: "Good to see you again, Ada" });
  assert.deepEqual(signInLines(""), { first: "Welcome back", second: "Good to see you again" });
  for (const name of ["Ada Lovelace", "", "Wolfeschlegelsteinhausenbergerdorff Senior"]) {
    const { first, second } = signInLines(name);
    assert.ok(!first.includes("!") && !second.includes("!"), "no exclamation marks");
  }
});

test("screen readers hear one sentence, not both visual lines", () => {
  assert.equal(signInAnnouncement("Ada Lovelace"), "Welcome back, Ada.");
  assert.equal(signInAnnouncement(""), "Welcome back.");
});

test("timings: full is about 3.2 to 3.4 s, light about 1.3 to 1.5 s, reduced motion under a second", () => {
  const full = signInTimings("full", false);
  const fullTotal = full.rise + full.presenceHold + full.secondHold + full.fly;
  assert.ok(fullTotal >= 3200 && fullTotal <= 3400, `full is ${fullTotal}ms`);
  const light = signInTimings("light", false);
  assert.ok(light.fly >= 1300 && light.fly <= 1500, `light is ${light.fly}ms`);
  assert.ok(light.scrimOutAt <= 500 && light.scrimOutAt < light.fly, "the page is clickable about half a second in, before it lands");
  assert.ok(light.captionInAt < light.captionOutAt && light.captionOutAt < light.fly);
  for (const version of ["full", "light"] as const) {
    const reduced = signInTimings(version, true);
    assert.ok(reduced.fadeIn + reduced.presenceHold + reduced.secondHold + reduced.fly <= 1000, "reduced motion is under a second");
    assert.equal(reduced.rise, 0);
  }
  assert.ok(full.max > fullTotal + full.slotWait + full.contentWait, "the watchdog outlasts the story and the waits");
  assert.equal(full.contentWait, 1500);
  assert.equal(full.hintAfter, 1200);
  assert.equal(light.hintAfter, 0, "the light version never shows the skip hint");
});

test("the name arrives last, a beat after the other words", () => {
  const words = wordDelays("Good to see you again, Ada");
  assert.deepEqual(words.map((w) => w.word), ["Good", "to", "see", "you", "again,", "Ada"]);
  assert.equal(words[1].delay - words[0].delay, 60);
  assert.equal(words[5].delay - words[4].delay, 60 + 140);
  assert.deepEqual(wordDelays("Hello"), [{ word: "Hello", delay: 0 }]);
});

test("only a real address is worth waiting for", () => {
  assert.equal(worthWaitingFor("https://x/y.png"), true);
  assert.equal(worthWaitingFor(""), false);
  assert.equal(worthWaitingFor(null), false);
  assert.equal(worthWaitingFor("data:image/png;base64,AAAA"), false);
});

test("the events are separate from onboarding's", () => {
  assert.deepEqual([...SIGNIN_FLIGHT_EVENT_TYPES], ["signin_flight_started", "signin_flight_completed", "signin_flight_skipped"]);
});

test("the person's own switch is read from this device's copy", () => {
  assert.equal(welcomeAnimationOff(fakeStore()), false);
  assert.equal(welcomeAnimationOff(fakeStore({ "app-welcome-animation": "false" })), true);
  assert.equal(welcomeAnimationOff(fakeStore({ "app-welcome-animation": "true" })), false);
  assert.equal(welcomeAnimationOff(brokenStore), false);
});

// The curtain script runs before the first paint. It is executed here against a stand-in page.
function runCurtain(options: { marker?: object | string | null; path: string; off?: boolean; now?: number }) {
  const attributes = new Map<string, string>();
  const timers: Array<() => void> = [];
  const styles: Array<{ id?: string; textContent?: string }> = [];
  const session = fakeStore();
  if (options.marker !== undefined && options.marker !== null) {
    session.setItem(SIGNIN_MARKER_KEY, typeof options.marker === "string" ? options.marker : JSON.stringify(options.marker));
  }
  const local = fakeStore(options.off ? { "app-welcome-animation": "false" } : {});
  const RealDate = Date;
  const now = options.now ?? NOW;
  const context = {
    sessionStorage: session,
    localStorage: local,
    location: { pathname: options.path },
    document: {
      createElement: () => ({}) as { id?: string; textContent?: string },
      head: { appendChild: (el: { id?: string; textContent?: string }) => void styles.push(el) },
      documentElement: {
        setAttribute: (name: string, value: string) => void attributes.set(name, value),
        removeAttribute: (name: string) => void attributes.delete(name),
      },
    },
    setTimeout: (fn: () => void) => void timers.push(fn),
    Date: class extends RealDate {
      static now() {
        return now;
      }
    },
    JSON,
  };
  runInNewContext(buildSignInCurtainScript(), context);
  return { covered: attributes.has("data-signin-curtain"), lift: () => timers.forEach((fn) => fn()), attributes, styles };
}

test("the curtain covers the page from the first paint when this tab just signed in", () => {
  const marker = { t: NOW - 5000, next: "/discover" };
  assert.equal(runCurtain({ marker, path: "/discover" }).covered, true);
  assert.equal(runCurtain({ marker, path: "/projects/abc" }).covered, true);
});

test("the curtain brings its own style, so it covers the page whatever the stylesheet is doing", () => {
  const marker = { t: NOW - 5000, next: "/discover" };
  const covered = runCurtain({ marker, path: "/discover" });
  assert.equal(covered.styles.length, 1);
  assert.equal(covered.styles[0]!.textContent, SIGNIN_CURTAIN_CSS);
  assert.match(SIGNIN_CURTAIN_CSS, /html\[data-signin-curtain\]::before\{content:"";position:fixed;inset:0;z-index:999;background:var\(--background,#FAF8F4\)\}/);
  assert.match(SIGNIN_CURTAIN_CSS, /html\.dark\[data-signin-curtain\]::before\{background:var\(--background,#0D1114\)\}/);
  assert.equal(runCurtain({ path: "/discover" }).styles.length, 0, "nothing is injected when there is no marker");
  assert.ok(SIGNIN_CURTAIN_FAILSAFE_MS >= 15_000, "a cold start can take a while: the curtain must not lift before the page can");
});

test("the curtain stays down when there is nothing to play, and lifts itself if nothing else does", () => {
  const marker = { t: NOW - 5000, next: "/discover" };
  assert.equal(runCurtain({ path: "/discover" }).covered, false, "no marker");
  assert.equal(runCurtain({ marker: "garbage", path: "/discover" }).covered, false, "bad marker");
  assert.equal(runCurtain({ marker: { t: NOW - SIGNIN_MARKER_TTL_MS - 1000, next: "/discover" }, path: "/discover" }).covered, false, "expired");
  assert.equal(runCurtain({ marker, path: "/login" }).covered, false, "still on the sign-in page");
  assert.equal(runCurtain({ marker, path: "/legal/accept" }).covered, false, "still on the way in");
  assert.equal(runCurtain({ marker, path: "/onboarding" }).covered, false, "a new person gets the onboarding flight");
  assert.equal(runCurtain({ marker, path: "/discover", off: true }).covered, false, "the setting is off");
  const covered = runCurtain({ marker, path: "/discover" });
  covered.lift();
  assert.equal(covered.attributes.has("data-signin-curtain"), false);
});

test("the setting: on by default, old snapshots read as on, and it travels with the other appearance choices", () => {
  assert.equal(DEFAULT_APPEARANCE_SNAPSHOT.welcomeAnimation, true);
  const old = parseAppearanceSnapshot({ theme: "dark", accentColor: "default", density: "default", reduceMotion: false, updatedAt: "2026-11-01T00:00:00.000Z" });
  assert.equal(old?.welcomeAnimation, true);
  const off = parseAppearanceSnapshot({ theme: "dark", accentColor: "default", density: "default", reduceMotion: false, welcomeAnimation: false, updatedAt: "2026-11-01T00:00:00.000Z" });
  assert.equal(off?.welcomeAnimation, false);
  const on = createAppearanceSnapshot({ welcomeAnimation: true });
  assert.equal(areAppearanceSnapshotsEquivalent(on, createAppearanceSnapshot({ welcomeAnimation: false })), false);
  const written = new Map<string, string>();
  writeAppearanceSnapshot(createAppearanceSnapshot({ welcomeAnimation: false }), (key, value) => void written.set(key, value));
  assert.equal(written.get(APPEARANCE_STORAGE_KEYS.welcomeAnimation), "false");
  assert.equal(readLocalAppearanceSnapshot((key) => (key === APPEARANCE_STORAGE_KEYS.welcomeAnimation ? "false" : null)).welcomeAnimation, false);
  assert.equal(readLocalAppearanceSnapshot(() => null).welcomeAnimation, true);
});
