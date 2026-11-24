import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rollValue } from "../../src/hooks/useRoll";

// Create workspace v6 (docs/superpowers/plans/2026-11-24-create-workspace-v6-implementation.md, Task 1): shared pieces.

test("UnderlineTabs takes an icon per tab, a trailing slot and the workspace look", async () => {
  const tabs = await readFile("src/components/ui/UnderlineTabs.tsx", "utf8");
  assert.match(tabs, /icon\?: /);
  assert.match(tabs, /trailing\?: ReactNode/);
  assert.match(tabs, /variant\?: 'underline' \| 'workspace'/);
  // The workspace row's look (WorkspaceLayout): 16px icon in clay when chosen, control height, px-3 gap-2.
  assert.match(tabs, /h-\[var\(--ui-control-height\)\]/);
  assert.match(tabs, /text-primary/);
  assert.match(tabs, /\{trailing\}/);
});

test("PixelTick draws six pixels left to right", async () => {
  const tick = await readFile("src/components/ui/PixelTick.tsx", "utf8");
  assert.equal((tick.match(/\[\d, \d\]/g) ?? []).length, 6);
  assert.match(tick, /'--d': i/);
  assert.match(tick, /nb-pxtick/);
});

test("the motion keyframes and the docked settings nav live in globals.css", async () => {
  const [globals, settings] = await Promise.all([
    readFile("src/app/globals.css", "utf8"),
    readFile("src/app/(site)/(main)/settings/settings.css", "utf8"),
  ]);
  for (const name of ["nb-enter-settle", "nb-enter-drop", "nb-enter-chip", "nb-enter-reveal", "nb-px-in"]) assert.match(globals, new RegExp(`@keyframes ${name}`));
  assert.match(globals, /\.nb-pxtick\[data-draw="true"\] rect/);
  assert.match(globals, /\.nbs-nl \{/);
  assert.match(globals, /\.nbs-navlist \{/);
  assert.doesNotMatch(settings, /^\.nbs-nl \{/m);
  // Reduced motion turns every enter animation off.
  assert.match(globals, /prefers-reduced-motion: reduce\) \{[^}]*\.nb-enter/);
});

test("rollValue eases from the old number to the new one and lands exactly", () => {
  assert.equal(rollValue(10, 20, 0), 10);
  assert.equal(rollValue(10, 20, 1), 20);
  const mid = rollValue(10, 20, 0.5);
  assert.ok(mid > 15 && mid < 20, `ease-out passes the midpoint early (${mid})`);
  assert.equal(rollValue(44, 128, 1), 128);
});
