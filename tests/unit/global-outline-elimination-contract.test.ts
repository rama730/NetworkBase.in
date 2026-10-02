import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("application focus never renders an outer orange line", () => {
  const globals = source("src/app/globals.css");
  const button = source("src/components/ui/button.tsx");
  const input = source("src/components/ui/input.tsx");
  const select = source("src/components/ui/select.tsx");

  assert.doesNotMatch(globals, /0 0 0 4px var\(--ring\)/);
  assert.match(globals, /Final focus-chrome guard/);
  assert.match(globals, /\*:focus,\s*\*:focus-visible,[\s\S]*\.nb-command-input[\s\S]*\[data-command-palette-dialog\][\s\S]*\{/);
  assert.match(globals, /outline-width:\s*0\s*!important;/);
  assert.match(globals, /--tw-ring-shadow:\s*0 0 #0000\s*!important;/);
  assert.match(globals, /box-shadow:\s*none\s*!important;/);

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
