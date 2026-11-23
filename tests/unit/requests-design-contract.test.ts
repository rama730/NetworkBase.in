import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// Report 38.7 parts 7–8 (plan A2.4): Requests uses the shared parts and the agreed words.
const tab = fs.readFileSync("src/components/workspaces/workflows/RequestsTab.tsx", "utf8");
const parts = fs.readFileSync("src/components/workspaces/v2/tasks/RequestParts.tsx", "utf8");

test("the title row, views and Inbox follow the Bugs tab: Inbox icon, mono counts, UnderlineTabs, primary New request, ⋯", () => {
  assert.match(tab, /<Inbox aria-hidden="true" className="size-5" \/>Requests<\/h2>/);
  assert.match(tab, /font-mono text-\[12px\] text-muted-foreground" data-testid="requests-counts"/);
  assert.match(tab, /<UnderlineTabs label="Requests view"/);
  assert.match(tab, /label: "Inbox" }, { key: "board" as const, label: "Board" }, { key: "mine" as const, label: "Mine" }, { key: "asks" as const, label: "My asks" }, { key: "breaching" as const, label: "Breaching soon" }/);
  assert.match(tab, /<Timer aria-hidden="true" className="size-3" \/><span className="sr-only">\{label\}: <\/span>\{words\}/, "the clock is words with a screen-reader label, never colour alone");
  assert.match(tab, /className=\{FORM_PRIMARY_CLASS\}>New request</);
  assert.match(tab, /aria-label="Requests actions"/);
  assert.match(tab, /No requests yet\. People in the workspace ask here; you choose what to take on\./);
  assert.match(tab, /Nothing new\./);
});

test("dialogs are the shared New dialog shell; the ask form uses the shared fields", () => {
  for (const name of ["accept-request-dialog", "decline-request-dialog", "request-types-dialog", "working-hours-dialog"]) assert.match(parts, new RegExp(`FORM_DIALOG_CLASS[^\\n]*data-testid="${name}"`), name);
  assert.match(parts, /<SectionDivider title="Request details" \/>/);
  assert.match(parts, /<Field label="Request type" htmlFor="request-type">/);
  assert.match(parts, /FORM_FOOTER_CLASS/);
});

test("words: never ticket or SLA on screen; Need by, Request type, Accept, Decline, Request types", () => {
  for (const source of [tab, parts]) assert.doesNotMatch(source, />[^<]*\b(?:ticket|tickets|SLA)\b[^<]*</i);
  assert.match(tab, /Need by/);
  assert.match(parts, /Response times: /);
  assert.match(tab, />Request types</);
});
