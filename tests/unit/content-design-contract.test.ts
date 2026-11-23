import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// Report 38.8 parts 7–8 (plan A2.7): Content uses the shared parts and the agreed words.
const tab = fs.readFileSync("src/components/workspaces/workflows/ContentTab.tsx", "utf8");
const parts = fs.readFileSync("src/components/workspaces/v2/tasks/ContentParts.tsx", "utf8");

test("the title row, quick-adds and views follow the other own tabs; the Calendar is T1's part", () => {
  assert.match(tab, /<PenLine aria-hidden="true" className="size-5" \/>Content<\/h2>/);
  assert.match(tab, /font-mono text-\[12px\] text-muted-foreground" data-testid="content-counts"/);
  assert.match(tab, /label: "Calendar" \}, \{ key: "week" as const, label: "This week" \}, \{ key: "board" as const, label: "Board" \}, \{ key: "schedule" as const, label: "To schedule" \}/);
  assert.match(tab, /<TasksCalendar [^>]*onlyType="content" rail=\{ideasRail\}/);
  assert.match(tab, /Plan what you’ll publish and when\. Ideas wait on the left until they get a date\./);
  assert.match(tab, />Cross-channel</);
});

test("channels show a mark beside their name (or a screen-reader name), never colour or a mark alone", () => {
  assert.match(parts, /withName \? <span>\{channel\.name\}<\/span> : <span className="sr-only">\{channel\.name\}<\/span>/);
  for (const name of ["plan-content-dialog", "content-settings-dialog"]) assert.match(parts, new RegExp(`FORM_DIALOG_CLASS[^\\n]*data-testid="${name}"`), name);
});

test("words: Idea, Drafting, Publish date, Channels; never posts for you", () => {
  assert.match(parts, /Pick your channels/);
  assert.match(parts, /label="Publish date"/);
  assert.doesNotMatch(tab + parts, />[^<]*\b(?:auto-post|post for you)\b[^<]*</i);
});
