import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.15 D6 (plan A6.1): NetworkBase document templates under Start from.
test("templates: unique ids, known groups, a one-line purpose, a body that starts with the title", async () => {
  const { DOC_TEMPLATES, TEMPLATE_GROUPS, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const ids = DOC_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of DOC_TEMPLATES) {
    assert.ok(TEMPLATE_GROUPS.some((g) => g.id === t.group), t.id);
    assert.ok(t.line.length > 0 && t.line.length <= 90, t.id);
    assert.match(templateBody(t, "Sign-in"), /^# .+\n/, t.id);
  }
});

test("templateFileName and the title line: “Tech spec – Sign-in.md”; no title → the template's name", async () => {
  const { templateFileName, templateTitle } = await import("../../src/lib/workflows/doc-templates");
  assert.equal(templateTitle("Assumptions check", "Pricing"), "Assumptions check – Pricing");
  assert.equal(templateTitle("Assumptions check", "  "), "Assumptions check");
  assert.equal(templateFileName("Assumptions check", "Pricing / v2"), "Assumptions check – Pricing v2.md");
});

test("parked parts say when they arrive (call 2)", async () => {
  const { parked } = await import("../../src/lib/workflows/doc-templates");
  assert.equal(parked("Money"), "> Available when Money is added.");
});

test("Assumptions check (11.8): intro, then the table with its columns and the words for Evidence and Status", async () => {
  const { templateById, templateBody } = await import("../../src/lib/workflows/doc-templates");
  const md = templateBody(templateById("assumptions-check")!, "Pricing");
  assert.match(md, /^# Assumptions check – Pricing\n\n_What has to be true for this to work\?/);
  assert.match(md, /\| Assumption \| Depends on \| Evidence \| If it's wrong, what breaks \| Cheapest test \| Status \|\n\|---\|---\|---\|---\|---\|---\|/);
  assert.match(md, /Evidence: None · Weak · Strong\. Status: Untested · Testing · Holds · Broken\./);
});
