import assert from "node:assert/strict";
import { test } from "node:test";

import { ORG_TYPES, orgTypeLabel } from "../../src/lib/organizations/config";
import { ORG_CREATION_COPY, ORG_TYPE_CARDS, orgStarterDoc, orgTypeDefaults } from "../../src/lib/organizations/creation";

// Report §34: every type has its card, copy and defaults; Other reads as its own label.
test("every org type has a card, copy and defaults", () => {
  for (const type of ORG_TYPES) {
    assert.ok(ORG_TYPE_CARDS[type].label && ORG_CREATION_COPY[type].subjectLabel, type);
    assert.ok(orgTypeDefaults(type).roleNames.owner, type);
  }
});

test("Other shows its own label; known types their name", () => {
  assert.equal(orgTypeLabel("other", { typeLabel: " Nonprofit " }), "Nonprofit");
  assert.equal(orgTypeLabel("other", {}), "Other");
  assert.equal(orgTypeLabel("research"), "Research");
  assert.equal(orgTypeLabel(null), null);
});

test("type defaults: open joining and public for communities and clubs, approval and private for the rest", () => {
  assert.deepEqual([orgTypeDefaults("education").joinMode, orgTypeDefaults("education").visibility, orgTypeDefaults("education").memberUpdates], ["instant", "private", false]);
  assert.deepEqual([orgTypeDefaults("club").joinMode, orgTypeDefaults("club").visibility], ["instant", "public"]);
  assert.deepEqual([orgTypeDefaults("company").joinMode, orgTypeDefaults("company").visibility], ["approval", "private"]);
  assert.equal(orgTypeDefaults("research").creatorTitle, "PI");
  assert.equal(orgTypeDefaults("education").sprintPrefix, "Unit ");
});

test("the starter doc uses the type's template and the org's words", () => {
  const doc = orgStarterDoc("education", { title: "CSE-3A", description: "Data structures.", audience: "3rd semester" });
  assert.match(doc, /^# CSE-3A: Syllabus/);
  assert.match(doc, /\*\*Who it’s for:\*\* 3rd semester/);
  assert.match(doc, /## Late work/);
});
