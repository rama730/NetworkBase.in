import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCE_STORAGE_KEYS,
  areAppearanceSnapshotsEquivalent,
  chooseAppearanceSync,
  createAppearanceSnapshot,
  DEFAULT_APPEARANCE_SNAPSHOT,
  parseAppearanceSnapshot,
  readLocalAppearanceSnapshot,
  buildThemePrehydrateScript,
} from "../../src/lib/theme/appearance";
import {
  ACCENT_PALETTES,
  getAccentSwatchBackground,
} from "../../src/lib/theme/appearance-runtime";
import { readAppearanceSettings } from "../../src/lib/theme/appearance-client";

test("parseAppearanceSnapshot accepts valid snapshot payload", () => {
  const parsed = parseAppearanceSnapshot({
    version: 1,
    theme: "dark",
    accentColor: "lagoon",
    density: "comfortable",
    reduceMotion: true,
    updatedAt: "2026-03-10T00:00:00.000Z",
  });

  assert.ok(parsed);
  assert.equal(parsed?.theme, "dark");
  assert.equal(parsed?.accentColor, "lagoon");
  assert.equal(parsed?.density, "comfortable");
  assert.equal(parsed?.reduceMotion, true);
});

test("parseAppearanceSnapshot rejects invalid payload", () => {
  const parsed = parseAppearanceSnapshot({
    theme: "invalid",
    accentColor: "lagoon",
    density: "default",
    reduceMotion: "yes",
  });
  assert.equal(parsed, null);
});

test("readLocalAppearanceSnapshot prefers unified snapshot key", () => {
  const nowIso = "2026-03-10T12:00:00.000Z";
  const store = new Map<string, string>();
  store.set(
    APPEARANCE_STORAGE_KEYS.snapshot,
    JSON.stringify({
      version: 1,
      theme: "dark",
      accentColor: "rose",
      density: "compact",
      reduceMotion: true,
      updatedAt: "2026-03-09T10:00:00.000Z",
    }),
  );

  const snapshot = readLocalAppearanceSnapshot((key) => store.get(key) ?? null, nowIso);
  assert.equal(snapshot.theme, "dark");
  assert.equal(snapshot.accentColor, "rose");
  assert.equal(snapshot.density, "compact");
  assert.equal(snapshot.reduceMotion, true);
});

test("readLocalAppearanceSnapshot falls back to legacy keys", () => {
  const nowIso = "2026-03-10T12:00:00.000Z";
  const store = new Map<string, string>([
    [APPEARANCE_STORAGE_KEYS.theme, "light"],
    [APPEARANCE_STORAGE_KEYS.accent, "green"],
    [APPEARANCE_STORAGE_KEYS.density, "comfortable"],
    [APPEARANCE_STORAGE_KEYS.reduceMotion, "true"],
  ]);

  const snapshot = readLocalAppearanceSnapshot((key) => store.get(key) ?? null, nowIso);
  assert.equal(snapshot.theme, "light");
  assert.equal(snapshot.accentColor, "forest");
  assert.equal(snapshot.density, "comfortable");
  assert.equal(snapshot.reduceMotion, true);
  assert.equal(snapshot.updatedAt, DEFAULT_APPEARANCE_SNAPSHOT.updatedAt);
});

test("readLocalAppearanceSnapshot normalizes legacy accent aliases", () => {
  const nowIso = "2026-03-10T12:00:00.000Z";
  const store = new Map<string, string>([
    [APPEARANCE_STORAGE_KEYS.snapshot, JSON.stringify({
      version: 1,
      theme: "light",
      accentColor: "purple",
      density: "default",
      reduceMotion: false,
      updatedAt: "2026-03-09T10:00:00.000Z",
    })],
  ]);

  const snapshot = readLocalAppearanceSnapshot((key) => store.get(key) ?? null, nowIso);
  assert.equal(snapshot.accentColor, "orchid");
});

test("chooseAppearanceSync pulls a newer account snapshot", () => {
  const local = createAppearanceSnapshot({ theme: "light", updatedAt: "2026-03-09T00:00:00.000Z" });
  const remote = createAppearanceSnapshot({ theme: "dark", updatedAt: "2026-03-10T00:00:00.000Z" });
  assert.equal(chooseAppearanceSync(local, remote, false), "pull");
});

test("chooseAppearanceSync pushes only a real local change", () => {
  const remote = createAppearanceSnapshot({ theme: "dark", updatedAt: "2026-03-09T00:00:00.000Z" });
  const changed = createAppearanceSnapshot({ theme: "light", updatedAt: "2026-03-10T00:00:00.000Z" });
  const same = createAppearanceSnapshot({ theme: "dark", updatedAt: "2026-03-10T00:00:00.000Z" });
  assert.equal(chooseAppearanceSync(changed, remote, false), "push");
  assert.equal(chooseAppearanceSync(changed, null, false), "push");
  assert.equal(chooseAppearanceSync(same, remote, false), "none");
  assert.equal(chooseAppearanceSync(changed, remote, true), "none");
});

test("chooseAppearanceSync never pushes untouched local defaults over the account", () => {
  const fresh = readLocalAppearanceSnapshot(() => null);
  const remote = createAppearanceSnapshot({ theme: "dark", updatedAt: "2026-03-09T00:00:00.000Z" });
  assert.equal(chooseAppearanceSync(fresh, remote, false), "pull");
  assert.equal(chooseAppearanceSync(fresh, null, false), "none");
});

test("areAppearanceSnapshotsEquivalent ignores updatedAt when values match", () => {
  const first = createAppearanceSnapshot({
    ...DEFAULT_APPEARANCE_SNAPSHOT,
    theme: "dark",
    updatedAt: "2026-03-10T00:00:00.000Z",
  });
  const second = createAppearanceSnapshot({
    ...DEFAULT_APPEARANCE_SNAPSHOT,
    theme: "dark",
    updatedAt: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(areAppearanceSnapshotsEquivalent(first, second), true);
});


test("buildThemePrehydrateScript includes core storage keys", () => {
  const script = buildThemePrehydrateScript();
  assert.ok(script.includes(APPEARANCE_STORAGE_KEYS.snapshot));
  assert.ok(script.includes(APPEARANCE_STORAGE_KEYS.theme));
  assert.ok(script.includes("data-accent"));
  assert.ok(script.includes("data-density"));
});

test("accent palette metadata exposes dual-color palette ids", () => {
  assert.deepEqual(Object.keys(ACCENT_PALETTES), [
    "default",
    "orchid",
    "forest",
    "ember",
    "rose",
    "lagoon",
  ]);
});

test("accent palette metadata exposes solid action color and selected tint", () => {
  assert.equal(ACCENT_PALETTES.default.solid, "#C24720");
  assert.equal(ACCENT_PALETTES.default.selectedTint, "#F3F0EA");
});

test("getAccentSwatchBackground renders the selected solid action swatch", () => {
  const background = getAccentSwatchBackground("default");
  assert.equal(background, ACCENT_PALETTES.default.solid);
  assert.doesNotMatch(background, /gradient/);
  assert.match(background, /#C24720/);
});

test("readAppearanceSettings dedupes concurrent bootstrap fetches", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          userId: "user-1",
          snapshot: createAppearanceSnapshot({
            ...DEFAULT_APPEARANCE_SNAPSHOT,
            updatedAt: "2026-03-10T00:00:00.000Z",
          }),
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const [first, second] = await Promise.all([
      readAppearanceSettings(),
      readAppearanceSettings(),
    ]);

    assert.equal(fetchCount, 1);
    assert.deepEqual(first, second);
    assert.equal(first.userId, "user-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a snapshot dated far in the future is not believed", () => {
  const far = parseAppearanceSnapshot({ ...DEFAULT_APPEARANCE_SNAPSHOT, updatedAt: "2099-01-01T00:00:00.000Z" });
  assert.ok(far && Date.parse(far.updatedAt) < Date.now() + 60_000);
  const soon = new Date(Date.now() + 2 * 60_000).toISOString();
  assert.equal(parseAppearanceSnapshot({ ...DEFAULT_APPEARANCE_SNAPSHOT, updatedAt: soon })?.updatedAt, soon);
});
