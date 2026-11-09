import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

// Unified back A1: the installed app has no browser back, so every page outside the top bar has its own.
test("pages without the top bar have a way back", () => {
  for (const [file, fallback] of [
    ["src/app/(site)/not-found.tsx", "/discover"],
    ["src/app/global-not-found.tsx", "/discover"],
    ["src/components/legal/LegalDocumentPage.tsx", "/"],
    ["src/app/(site)/admin/notifications/page.tsx", "/admin/trust"],
  ]) {
    const src = read(file);
    assert.match(src, /<BackButton\b/, file);
    assert.match(src, new RegExp(`fallback="${fallback.replace(/\//g, "\\/")}"`), `${file} falls back to ${fallback}`);
  }
  const globalError = read("src/app/global-error.tsx");
  assert.match(globalError, /history\.length > 1 \? window\.history\.back\(\) : window\.location\.assign\("\/discover"\)/);
});

test("offline errors say so instead of a generic failure (R9)", () => {
  const src = read("src/app/(site)/(main)/error.tsx");
  assert.match(src, /useOnlineStatus\(\)/);
  assert.match(src, /You’re offline\. Pages you opened still work when you go back\./);
});
