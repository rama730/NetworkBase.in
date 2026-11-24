import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRelease, releaseMarkdown } from "../../src/lib/workflows/changelog";

test("A7.5: a release Update's three groups; missing groups empty; no version → one plain block", () => {
  const md = "## v2.4\n\n### Added\n- Docs site\n- Snippets\n\n### Fixed\n* Push of SVG files\n\nThanks all.";
  assert.deepEqual(parseRelease(md), { kind: "release", version: "v2.4", added: ["Docs site", "Snippets"], improved: [], fixed: ["Push of SVG files"] });
  assert.deepEqual(parseRelease("## 3.0.1\n### Changed\n- Faster"), { kind: "release", version: "v3.0.1", added: [], improved: ["Faster"], fixed: [] });
  assert.deepEqual(parseRelease("We shipped a lot this week.\n- one"), { kind: "plain", text: "We shipped a lot this week.\n- one" });
  assert.deepEqual(parseRelease(releaseMarkdown("2.5", { added: ["A"], fixed: ["B"] })), { kind: "release", version: "v2.5", added: ["A"], improved: [], fixed: ["B"] });
});
