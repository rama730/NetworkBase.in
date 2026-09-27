import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("application enforces universal elimination of outer orange focus outline lines", () => {
  const globals = source("src/app/globals.css");
  const button = source("src/components/ui/button.tsx");
  const input = source("src/components/ui/input.tsx");

  // globals.css must never contain outline: 2px solid var(--ring)
  assert.doesNotMatch(globals, /outline:\s*2px\s+solid\s+var\(--ring\)/);
  assert.doesNotMatch(globals, /outline:\s*.*var\(--ring\)/);

  // globals.css base layer enforces outline: none !important
  assert.match(globals, /\*:focus,\s*\*:focus-visible\s*\{\s*outline:\s*none\s*!important;\s*\}/);

  // Complete elimination rule covers all interactive elements, dialogs, buttons, inputs, tabs, and nav links
  assert.match(globals, /outline:\s*none\s*!important;\s*outline-width:\s*0\s*!important;\s*outline-color:\s*transparent\s*!important;\s*box-shadow:\s*none\s*!important;/);

  // Project cards do not turn orange on focus
  assert.doesNotMatch(globals, /\.nb-project-card:focus-within\s*\{\s*border-color:var\(--ring\)/);
  assert.match(globals, /\.nb-project-card:focus-within\s*\{\s*border-color:var\(--border\)/);

  // Button variants do not carry orange ring focus styles
  assert.doesNotMatch(button, /focus-visible:ring-ring/);
  assert.doesNotMatch(button, /focus-visible:ring-2/);

  // Input does not carry orange ring focus styles
  assert.doesNotMatch(input, /focus-visible:ring-ring/);
  assert.doesNotMatch(input, /focus-visible:ring-2/);
});
