import assert from "node:assert/strict";
import { test } from "node:test";

import { needsAgreement, parseRules, readCommunitySettings, showGettingStarted } from "../../src/lib/organizations/community";
import { orgStarterDoc } from "../../src/lib/organizations/creation";

test("34.2: the starter Code of conduct has four parts and numbered rules that parse", () => {
  const md = orgStarterDoc("community", { title: "Pune Devs" });
  assert.match(md, /## Values[\s\S]*## Rules[\s\S]*## How we keep it safe[\s\S]*## Contact/);
  const rules = parseRules(md);
  assert.equal(rules.length, 5);
  assert.deepEqual(rules[1], { n: 2, text: "No harassment, hate or personal attacks." });
  assert.deepEqual(parseRules("# x\n## Rules\n1. **Be kind**\n- not numbered\n### Detail\n2. Still a rule\n## Contact\n3. not a rule"), [{ n: 1, text: "Be kind" }, { n: 2, text: "Still a rule" }]);
});

test("34.2: agreeing again on a new version; Getting started for 14 days; settings defaults", () => {
  assert.equal(needsAgreement(true, 2, 1), true);
  assert.equal(needsAgreement(true, 2, 2), false);
  assert.equal(needsAgreement(true, 0, null), true, "never agreed");
  assert.equal(needsAgreement(false, 3, null), false);
  const now = new Date("2026-11-26T00:00:00Z");
  assert.equal(showGettingStarted("2026-11-20T00:00:00Z", now, 3, 1), true);
  assert.equal(showGettingStarted("2026-11-01T00:00:00Z", now, 3, 1), false, "after 14 days");
  assert.equal(showGettingStarted("2026-11-20T00:00:00Z", now, 3, 3), false, "all done");
  const d = readCommunitySettings({});
  assert.deepEqual([d.agreeRequired, d.welcomePost, d.firstDayLimit, d.questions.length, d.gettingStarted.length], [true, false, true, 0, 3]);
});
