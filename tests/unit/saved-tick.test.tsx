import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedTick } from "@/components/ui/SavedTick";

test("a saved tick is a status line with a tick and the word, popping once", () => {
  const html = renderToStaticMarkup(<SavedTick />);
  assert.match(html, /role="status"/);
  assert.match(html, /nb-saved/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.match(html, />Saved<\/span>$/);
  assert.match(renderToStaticMarkup(<SavedTick label="Order saved" />), />Order saved</);
});

test("forms whose result is on screen say Saved in place, not with a toast", () => {
  for (const file of ["src/components/organizations/OrgSettingsSections.tsx", "src/components/organizations/OrgFilesPanel.tsx", "src/components/profile/v2/sections/ProfileOrganizationsSection.tsx"]) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /toast\.success\(\s*['"]Saved['"]\s*\)/, file);
  }
});
