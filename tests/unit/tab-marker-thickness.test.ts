import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("underline tab markers stay inside the row so a scrolling row never clips them to 1px", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.nb-tab-marker \{[^}]*height: 2px;/);
  assert.match(css, /\.nb-tab-marker\[data-overlap\] \{ bottom: 0; \}/);
});
