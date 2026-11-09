import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

test("top bar renders the back arrow in its own row, both widths (§7.2)", () => {
  const nav = read("src/components/layout/header/TopNav.tsx");
  assert.match(nav, /<BackSlot\b/, "desktop slot before search");
  assert.match(nav, /<BackLogoSwap\b/, "phone arrow takes the logo's place");
});

test("back arrow: ArrowLeft icon, inert when hidden, real back (§7.1, §7.4)", () => {
  const src = read("src/components/layout/header/BackButton.tsx");
  assert.match(src, /ArrowLeft/);
  assert.match(src, /inert=\{!show\}/);
  assert.match(src, /aria-hidden=\{!show\}/);
  assert.match(src, /useBack\(/);
  assert.match(src, /backLabel\(/);
  assert.doesNotMatch(src, /<X\b|ChevronLeft/);
});

test("motion: 220ms, the approved curve, only after the first navigation (§7.3)", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.nb-back-slot\[data-animate="true"\]\s*\{[^}]*width 220ms cubic-bezier\(\.2, 0, 0, 1\)/);
  assert.match(css, /\.nb-back-slot\[data-show="true"\]\s*\{[^}]*width:\s*44px/);
  assert.match(css, /translateX\(-8px\)/);
  assert.match(css, /translateX\(8px\)/);
  assert.match(read("src/components/layout/header/BackButton.tsx"), /data-animate=\{animate/);
});
