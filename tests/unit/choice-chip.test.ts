import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ChipSelector, { choiceChipClass } from "../../src/components/onboarding/ChipSelector";

const read = (path: string) => readFileSync(path, "utf8");

test("choice chips are compact and squared like the controls beside them", () => {
  for (const selected of [true, false]) {
    const classes = choiceChipClass(selected);
    assert.match(classes, /rounded-\[3px\]/);
    assert.match(classes, /min-h-\[26px\]/, "26px is the spec's larger tag height");
    assert.match(classes, /nb-touch-target/, "still 44px on touch screens");
    assert.doesNotMatch(classes, /rounded-full|min-h-11/);
  }
  assert.match(choiceChipClass(true), /bg-foreground text-background/, "selected uses ink fill");
});

test("a selected chip renders pressed with its check, an unselected one without", () => {
  const html = renderToStaticMarkup(createElement(ChipSelector, {
    options: [{ value: "a", label: "Open Source" }, { value: "b", label: "SaaS" }],
    selected: new Set(["a"]),
    onToggle: () => undefined,
    labelledBy: "x",
  }));
  assert.doesNotMatch(html, /rounded-full/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 1);
  assert.match(html, /gap-1\.5/, "6px gaps between tags");
});

test("every chip on the profile and onboarding screens uses the one style", () => {
  for (const file of ["src/components/profile/GenderChoice.tsx", "src/components/onboarding/UsernameInput.tsx"]) {
    const source = read(file);
    assert.match(source, /choiceChipClass\(/, file);
    assert.doesNotMatch(source, /rounded-full/, file);
  }
  const editor = read("src/components/profile/edit/EditProfileTabs.tsx");
  assert.doesNotMatch(editor, /border-dashed border-border bg-card\/60/, "suggestions are ordinary chips");
  assert.match(editor, /className=\{choiceChipClass\(false\)\}/);
});

test("Save changes is the one primary action in Collaboration preferences", () => {
  const editor = read("src/components/profile/edit/EditProfileTabs.tsx");
  assert.match(editor, /<Button type="button" variant="outline" onClick=\{handleAddCustomCategory\}>Add category<\/Button>/);
  assert.match(editor, /<Button type="button" variant="outline" onClick=\{\(\) => handleAddCustomRole\(\)\}>Add role<\/Button>/);
});
