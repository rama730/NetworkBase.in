import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { WORKFLOW_GROUPS } from "../../src/lib/workflows/catalog";

// Report 38.2 F1 part 10: the Add workflow dialog uses the shared shell, keeps the groups in order and the row anatomy,
// and adds no colours of its own; the tab row's button is a tab like the others.
const dir = "src/components/workspaces/workflows";
const files = fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")] as const);
const dialog = fs.readFileSync(path.join(dir, "AddWorkflowDialog.tsx"), "utf8");
const layout = fs.readFileSync("src/components/workspaces/dashboard/WorkspaceLayout.tsx", "utf8");

test("the dialog is the shared New dialog shell with SectionDivider groups and the shared buttons", () => {
  assert.match(dialog, /className=\{FORM_DIALOG_CLASS\}/);
  assert.match(dialog, /<SectionDivider title=\{group\.label\} \/>/);
  assert.match(dialog, /FORM_SECONDARY_CLASS/);
  assert.match(dialog, /FORM_FOOTER_CLASS/, "the Remove dialog's footer");
  assert.match(dialog, /DialogTitle[^>]*>Add workflow</);
  assert.match(dialog, /Workflows add views, stages or tabs\. Everyone in the workspace uses them\./);
});

test("groups come in the agreed order and parked rows say Coming later", () => {
  assert.deepEqual(WORKFLOW_GROUPS.map((g) => g.label), ["Blends into Tasks", "Own tab · same tasks", "Blends into Documents", "Blends into Files", "Blends into Updates", "Blends into Sprints", "Later · parked"]);
  assert.match(dialog, /Coming later/);
  assert.match(dialog, /role="list" aria-label=\{group\.label\}/, "each group is a labelled list");
});

test("no colours of their own: tokens only, app icons only, no emoji", () => {
  for (const [name, source] of files) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-\[#|rgb\(|hsl\(/, `${name} uses a raw colour`);
    assert.doesNotMatch(source, /\p{Extended_Pictographic}/u, `${name} uses an emoji`);
  }
});

test("the tab row: workflow tabs after a divider, the button is an nb-tab with its label for screen readers on narrow screens", () => {
  assert.match(layout, /data-testid="workflow-tab-divider"/);
  assert.match(layout, /data-testid="add-workflow-button"[\s\S]{0,400}className="nb-tab nb-ui-label nb-touch-target/);
  assert.match(layout, /<span className="max-\[1099px\]:sr-only">Add workflow<\/span>/);
});
