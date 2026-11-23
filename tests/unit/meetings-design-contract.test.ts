import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// Report 38.11 parts 2 and 4 (plan A4.1): meetings use the shared parts and the agreed words.
const parts = fs.readFileSync("src/components/workspaces/doc/DocMeeting.tsx", "utf8");

test("the header: CalendarClock, the time in mono with the zone, square chips, Now, Finish meeting", () => {
  assert.match(parts, /<CalendarClock aria-hidden="true"/);
  assert.match(parts, /className="font-mono text-\[12px\]" data-testid="meeting-when"/);
  assert.match(parts, /const CHIP = "inline-flex h-5 items-center rounded-\[3px\] border/);
  assert.ok(parts.includes(">Now</span>") && parts.includes(">Finish meeting</button>"));
});

test("dialogs use the shared shell; words: New meeting, Finish meeting, Edit this meeting, End the series, Open action items", () => {
  for (const id of ["new-meeting-dialog", "finish-meeting-dialog", "move-meeting-dialog"]) assert.match(parts, new RegExp(`FORM_DIALOG_CLASS\\} data-testid="${id}"`), id);
  for (const word of [">New meeting<", ">Edit this meeting…<", ">End the series<", ">Open action items <"]) assert.ok(parts.includes(word), word);
  assert.match(parts, /<caption className="sr-only">Open action items from every meeting<\/caption>/);
});
