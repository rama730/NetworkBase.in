import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// Sprint redesign §0 (4 November 2026, replacing decision 75's ring): no orange outer line anywhere. Keyboard focus
// stays visible without it (WCAG 2.4.7): a clay tint on links, tabs and rows, a clay border on Buttons, a darker
// border on fields, and a thin neutral outline only on native checkboxes and radios.
test("keyboard focus draws no outer ring; tints and borders show it instead", () => {
  const globals = source("src/app/globals.css");
  const button = source("src/components/ui/button.tsx");
  const input = source("src/components/ui/input.tsx");
  const select = source("src/components/ui/select.tsx");

  assert.match(globals, /--focus-ring:\s*var\(--ring\)/);
  assert.doesNotMatch(globals, /outline:\s*2px solid var\(--focus-ring\)/, "no orange outline");
  assert.match(globals, /^:focus-visible\s*\{\s*outline:\s*none\s*!important;/m);
  assert.match(globals, /:is\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), textarea, select\):focus-visible\s*\{\s*border-color:\s*var\(--foreground\)/);
  assert.match(globals, /input:is\(\[type="checkbox"\], \[type="radio"\]\):focus-visible\s*\{\s*outline:\s*1\.5px solid var\(--foreground\) !important/);
  assert.match(globals, /\[role="tab"\]/, "tabs keep the clay tint");
  assert.doesNotMatch(globals, /\.nb-story-input:focus-visible \{ outline:2px solid var\(--primary\)/);
  assert.doesNotMatch(globals, /Final focus-chrome guard/);
  assert.match(globals, /--tw-ring-shadow:\s*0 0 #0000\s*!important;/);
  assert.doesNotMatch(globals, /0 0 0 4px var\(--ring\)/);

  // Project cards do not turn orange on focus
  assert.doesNotMatch(globals, /\.nb-project-card:focus-within\s*\{\s*border-color:var\(--ring\)/);
  assert.match(globals, /\.nb-project-card:focus-within\s*\{\s*border-color:var\(--border\)/);

  // Shared controls use tonal focus states, never an outer halo.
  assert.doesNotMatch(button, /focus-visible:ring-2/);
  assert.doesNotMatch(button, /focus-visible:ring-ring/);
  assert.match(button, /focus-visible:brightness-\[0\.92\]/);
  assert.match(button, /focus-visible:shadow-none!/);
  assert.doesNotMatch(input, /focus-visible:(?:border-ring|ring-)/);
  assert.match(input, /focus-visible:bg-muted\/20/);
  assert.doesNotMatch(select, /focus-visible:(?:border-ring|ring-)/);
  assert.match(select, /focus-visible:bg-muted\/20/);
});
