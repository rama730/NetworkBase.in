import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// Decision 75 (report §32.3): one visible keyboard focus ring everywhere, from one token. It replaces the old
// "no outer line" guard; component halos (Tailwind ring shadows) stay off so there is only ever one ring.
test("keyboard focus shows one ring from one token, and components add no second halo", () => {
  const globals = source("src/app/globals.css");
  const button = source("src/components/ui/button.tsx");
  const input = source("src/components/ui/input.tsx");
  const select = source("src/components/ui/select.tsx");

  assert.match(globals, /--focus-ring:\s*var\(--ring\)/);
  assert.match(globals, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)\s*!important/);
  assert.doesNotMatch(globals, /\*:focus-visible\s*\{\s*outline:\s*none/, "the global removal goes");
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
