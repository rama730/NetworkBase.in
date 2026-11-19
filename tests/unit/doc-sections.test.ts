import assert from "node:assert/strict";
import { test } from "node:test";

import { availableSections, docSectionOf, railSections, sectionLabel } from "../../src/lib/workspaces/doc-sections";
import { normalizeWorkspaceDocSettings } from "../../src/lib/workspaces/doc";

// Report 38.3 F2 part 7 (railSections) and S1: the order, what shows without document workflows, and the fallback.
const doc = (id: string, filename: string, settings: Record<string, unknown> = {}) => ({ id, slug: id, filename, linkedNodeId: null, section: settings.section as string | undefined, date: settings.date as string | undefined, kind: settings.kind as string | undefined });

test("no document workflow: the rail stays flat (no Pages header)", () => {
  assert.deepEqual(railSections([doc("a", "A.md"), doc("b", "B.md")], []), []);
  assert.deepEqual(railSections([doc("a", "A.md")], ["bugs"]), [], "Bugs adds no document section");
});

test("Meetings added: Pages, Meetings and Decisions in that order, empty ones kept for their + line", () => {
  const rail = railSections([doc("a", "Plan.md"), doc("m1", "Weekly.md", { section: "meetings", date: "2026-11-12" }), doc("m2", "Kickoff.md", { section: "meetings", date: "2026-11-19" })], ["meetings"]);
  assert.deepEqual(rail.map((s) => s.id), ["pages", "meetings", "decisions"]);
  assert.deepEqual(rail[1]!.docs.map((d) => d.id), ["m2", "m1"], "newest meeting first");
  assert.equal(rail[1]!.docs[0]!.prefix, "Nov 19");
  assert.deepEqual(rail[2]!.docs, []);
});

test("a document in a section whose workflow was hidden falls back to Pages", () => {
  const rail = railSections([doc("l", "Launch.md", { section: "launches" }), doc("m", "Weekly.md", { section: "meetings", date: "2026-11-12" })], ["meetings"]);
  assert.deepEqual(rail.find((s) => s.id === "pages")!.docs.map((d) => d.id), ["l"]);
  assert.equal(docSectionOf({ section: "launches" }, ["meetings"]), "pages");
});

test("availableSections and labels follow the added workflows", () => {
  assert.deepEqual(availableSections([]), ["pages"]);
  assert.deepEqual(availableSections(["launches", "meetings"]), ["pages", "meetings", "decisions", "launches"]);
  assert.equal(sectionLabel("offsite"), "Off-site");
});

test("document settings keep a valid section, kind and date, and drop invalid ones", () => {
  assert.deepEqual((({ section, kind, date }) => ({ section, kind, date }))(normalizeWorkspaceDocSettings({ section: "meetings", kind: "standup", date: "2026-11-19" })), { section: "meetings", kind: "standup", date: "2026-11-19" });
  const bad = normalizeWorkspaceDocSettings({ section: "nope", kind: "x".repeat(80), date: "19/11/2026" });
  assert.deepEqual([bad.section, bad.kind, bad.date], [undefined, undefined, undefined]);
});
