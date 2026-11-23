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

// Plan A2.9: Results, Performance and the Overview card.
test("Performance is a view; the chart is labelled SVG with a named legend, and the table sorts and has a caption", () => {
  assert.match(tab, /\{ key: "schedule" as const, label: "To schedule" \}, \{ key: "performance" as const, label: "Performance" \}/);
  assert.match(parts, /role="img" aria-label=\{`Posts per week by channel/);
  assert.doesNotMatch(parts, /<svg viewBox/, "plain bars: SVG text would scale with the width");
  assert.match(parts, /<ul className="flex flex-wrap gap-3 text-\[12px\]" aria-label="Channels">/);
  assert.match(parts, /aria-sort=\{sort\.key === key/);
  assert.match(parts, /<caption className="sr-only">Results by piece and channel<\/caption>/);
  assert.match(parts, /background: CHART\[ci % CHART\.length\]/, "chart colours are tokens");
});

test("Results dialog: four optional numbers per channel in the shared dialog shell; the Overview card is a RailSection", () => {
  assert.match(parts, /FORM_DIALOG_CLASS\} data-testid="results-dialog"/);
  assert.match(parts, /const METRICS = \["views", "likes", "comments", "clicks"\] as const;/);
  const card = fs.readFileSync("src/components/workspaces/dashboard/ContentOverviewCard.tsx", "utf8");
  assert.match(card, /<RailSection title="Content" headingId="workspace-content-title"/);
  assert.match(card, /publishing this week · \{s\.editing\} waiting for edit/);
});
