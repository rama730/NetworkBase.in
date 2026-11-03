import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_DOC_GROUPS, docFileName, docLabel, fillDocTemplate, readDocGroups, readOrgDocOptions, templateCopyTitle } from "../../src/lib/organizations/doc-rules";

test("templates fill {{project}}, {{team}} and {{date}} and name the copy", () => {
  const filled = fillDocTemplate("# Lab report: {{project}}\nTeam: {{ team }}\nDate: {{date}}\n{{unknown}}", { project: "Compiler Lab", team: "Parser", date: "Oct 30" });
  assert.equal(filled, "# Lab report: Compiler Lab\nTeam: Parser\nDate: Oct 30\n{{unknown}}");
  assert.equal(templateCopyTitle("Lab report.md", "Compiler Lab", "Oct 30"), "Lab report: Compiler Lab — Oct 30");
  assert.equal(docFileName("Lab report: Compiler Lab — Oct 30"), "Lab report Compiler Lab — Oct 30.md");
  assert.equal(docFileName("  /  "), "Untitled.md");
});

test("New until opened at the current re-read version; Updated for 7 days after a later change", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const at = new Date("2026-10-20T12:00:00Z");
  assert.equal(docLabel({ readVersion: 0, opened: null, updatedAt: null, now }), "new");
  assert.equal(docLabel({ readVersion: 1, opened: { version: 0, at }, updatedAt: null, now }), "new", "re-read requested");
  assert.equal(docLabel({ readVersion: 1, opened: { version: 1, at }, updatedAt: new Date("2026-10-28T00:00:00Z"), now }), "updated");
  assert.equal(docLabel({ readVersion: 1, opened: { version: 1, at }, updatedAt: new Date("2026-10-21T00:00:00Z"), now }), null, "older than 7 days");
  assert.equal(docLabel({ readVersion: 1, opened: { version: 1, at }, updatedAt: new Date("2026-10-19T00:00:00Z"), now }), null, "changed before the open");
});

test("options default to the first group, templates to Templates, and show in child projects", () => {
  assert.deepEqual(readOrgDocOptions(undefined), { group: "start", required: false, template: false, showInChildren: true, readVersion: 0, lifecycle: null, publishedAt: null }, "older documents have no lifecycle and read live");
  assert.equal(readOrgDocOptions({ template: true }).group, "templates");
  assert.equal(readOrgDocOptions({ group: "gone" }).group, "start", "a removed group falls back");
  assert.deepEqual(readDocGroups([]), DEFAULT_DOC_GROUPS);
  assert.deepEqual(readDocGroups([{ id: "a", name: "Week 1" }, { id: "b", name: " " }]), [{ id: "a", name: "Week 1" }]);
});

test("37.4, decision 101: a document is a Draft, Published, or Published with changes waiting", async () => {
  const { docState } = await import("../../src/lib/organizations/doc-rules");
  const at = "2026-11-01T10:00:00Z";
  assert.equal(docState({ lifecycle: "draft", publishedAt: null, fileUpdatedAt: null, latestVersionId: null, publishedVersionId: null, linked: true }), "draft");
  assert.equal(docState({ lifecycle: "published", publishedAt: at, fileUpdatedAt: new Date("2026-11-02T10:00:00Z"), latestVersionId: null, publishedVersionId: "v", linked: true }), "changed");
  assert.equal(docState({ lifecycle: "published", publishedAt: at, fileUpdatedAt: new Date("2026-10-31T10:00:00Z"), latestVersionId: null, publishedVersionId: "v", linked: true }), "published");
  assert.equal(docState({ lifecycle: null, publishedAt: null, fileUpdatedAt: new Date(), latestVersionId: null, publishedVersionId: null, linked: true }), "published", "older file documents read live");
  assert.equal(docState({ lifecycle: null, publishedAt: null, fileUpdatedAt: null, latestVersionId: "v2", publishedVersionId: "v1", linked: false }), "changed");
});
