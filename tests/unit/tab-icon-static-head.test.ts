import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Next swaps streamed metadata on every navigation; icons declared there vanish from the tab until the next page's
// metadata arrives. They belong in the root document's static head.
test("tab icons are static head links, not metadata", () => {
  const source = readFileSync("src/app/root-document.tsx", "utf8");
  assert.doesNotMatch(source, /\bicons\s*:/, "rootMetadata must not declare icons");
  const head = source.slice(source.indexOf("<head>"), source.indexOf("</head>"));
  for (const href of ["/icon-paper-tab.ico", "/icon-paper-tab-32.png", "/icon-paper-tab.svg", "/icon-paper-180.png", "/icon-paper-mono.svg"]) {
    assert.ok(head.includes(`href="${href}"`), `static head is missing ${href}`);
  }
});
