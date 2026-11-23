import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// Report 38.10 parts 2 and 4 (plan A3.1): launches use the shared parts and the agreed words.
const parts = fs.readFileSync("src/components/workspaces/doc/DocLaunch.tsx", "utf8");

test("the header: Rocket, mono date and countdown, a square stage badge, progress as text; Launch now never posts", () => {
  assert.match(parts, /<Rocket aria-hidden="true"/);
  assert.match(parts, /font-mono text-\[12px\] text-muted-foreground" data-testid="launch-countdown"/);
  assert.match(parts, /const BADGE = "inline-flex h-5 items-center rounded-\[3px\] border/);
  assert.match(parts, /aria-label=\{`\$\{data\.progress\.text\} done`\}/);
  assert.match(parts, /Copy release notes for an Update \(nothing is posted\)/);
  assert.match(parts, /aria-label="Roadmap items that ship"/);
});

test("dialogs use the shared shell; words: Launch now, Close launch, Move the date, Cancel launch", () => {
  for (const id of ["new-launch-dialog", "launch-dialog", "launch-choice-dialog", "launch-date-dialog"]) assert.match(parts, new RegExp(`FORM_DIALOG_CLASS\\} data-testid="${id}"`), id);
  for (const word of [">Launch now<", ">Close launch<", ">Move the date…<", ">Cancel launch…<"]) assert.ok(parts.includes(word), word);
});
