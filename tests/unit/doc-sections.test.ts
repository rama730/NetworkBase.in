import assert from "node:assert/strict";
import { test } from "node:test";

import { availableSections, decisionLabel, docSectionOf, nextDecisionNumber, railSections, sectionLabel } from "../../src/lib/workspaces/doc-sections";
import { normalizeWorkspaceDocSettings } from "../../src/lib/workspaces/doc";

// Report 38.3 F2 part 7 (railSections) and S1: the order, what shows without document workflows, and the fallback.
const doc = (id: string, filename: string, settings: Record<string, unknown> = {}) => ({ id, slug: id, filename, linkedNodeId: null, section: settings.section as string | undefined, date: settings.date as string | undefined, kind: settings.kind as string | undefined, decisionNumber: settings.decisionNumber as number | undefined });

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

// Report 38.3 F2 part 7 (nextDecisionNumber), S1 and S4 (plan A0.6): D-numbers are the workspace's next, gaps kept.
test("nextDecisionNumber: empty is 1, gaps are kept (1, 2, 5 -> 6); labels are D-001 style", () => {
  assert.equal(nextDecisionNumber([]), 1);
  assert.equal(nextDecisionNumber([1, 2, 5]), 6);
  assert.equal(nextDecisionNumber([null, undefined, 3]), 4);
  assert.deepEqual([decisionLabel(1), decisionLabel(14), decisionLabel(1234)], ["D-001", "D-014", "D-1234"]);
});

test("Decisions in the rail: newest number first, D-014 before the title; unnumbered last", () => {
  const docs = [doc("a", "Use Postgres.md", { section: "decisions", decisionNumber: 2 }), doc("b", "Ship Friday.md", { section: "decisions", decisionNumber: 14 }), doc("c", "Loose.md", { section: "decisions" })];
  const decisions = railSections(docs, ["meetings"]).find((s) => s.id === "decisions")!;
  assert.deepEqual(decisions.docs.map((d) => [d.id, d.prefix]), [["b", "D-014"], ["a", "D-002"], ["c", null]]);
});

test("document settings keep a decision's number, status and source document; drop invalid ones", () => {
  const kept = normalizeWorkspaceDocSettings({ section: "decisions", decisionNumber: 7, decisionStatus: "decided", fromDocId: "7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10" });
  assert.deepEqual([kept.decisionNumber, kept.decisionStatus, kept.fromDocId], [7, "decided", "7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10"]);
  const bad = normalizeWorkspaceDocSettings({ decisionNumber: -1, decisionStatus: "maybe", fromDocId: "x" });
  assert.deepEqual([bad.decisionNumber, bad.decisionStatus, bad.fromDocId], [undefined, undefined, undefined]);
});
