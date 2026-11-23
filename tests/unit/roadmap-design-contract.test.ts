import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// Report 38.9 parts 2 and 4 (plan A2.10): Roadmap uses the shared parts and the agreed words.
const tab = fs.readFileSync("src/components/workspaces/workflows/RoadmapTab.tsx", "utf8");
const parts = fs.readFileSync("src/components/workspaces/v2/tasks/RoadmapParts.tsx", "utf8");

test("title row, counts and views follow the other own tabs; columns are labelled lists with a Move to menu", () => {
  assert.match(tab, /<MapIcon aria-hidden="true" className="size-5" \/>Roadmap<\/h2>/);
  assert.match(tab, /font-mono text-\[12px\] text-muted-foreground" data-testid="roadmap-counts"/);
  assert.match(tab, /<UnderlineTabs label="Roadmap view"/);
  assert.match(tab, /<ul className="space-y-2" aria-label=\{`\$\{COLUMN_LABEL\[c\]\}, \$\{list\.length\}`\}>/);
  assert.match(tab, /Move to \{COLUMN_LABEL\[c\]\}/, "every drag has a menu path");
  assert.match(tab, /Put what you’re building now in Now\. Work tasks go on the Tasks board\./);
});

test("badges are square with words; the New module and the panel use the shared form parts", () => {
  assert.match(tab, /const BADGE = "inline-flex h-5 items-center rounded-\[3px\] border/);
  assert.doesNotMatch(tab + parts, /rounded-full px/);
  assert.match(parts, /<SectionDivider title="Roadmap details" \/>/);
  assert.match(parts, /FORM_DIALOG_CLASS\} data-testid="wont-do-dialog"/);
  assert.match(parts, /label="Why not\?"/);
});

// Plan A2.11: Timeline and Backlog.
test("Timeline and Backlog: labelled regions, a keyboard path for every drag, diamonds with names", () => {
  assert.match(tab, /\{ key: "timeline" as const, label: "Timeline" \}, \{ key: "backlog" as const, label: "Backlog" \}/);
  assert.match(tab, /aria-label="Roadmap timeline"/);
  assert.match(tab, /role="img" title=\{`\$\{String\(r\.typeFields\.milestone/);
  assert.match(tab, /aria-label=\{`Move \$\{r\.title\} up`\}/);
  assert.match(tab, /<caption className="sr-only">Backlog items in order<\/caption>/);
});
