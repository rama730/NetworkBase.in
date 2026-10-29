import assert from "node:assert/strict";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

test("project Settings preserves sticky tab clearance and shared content padding", () => {
  const source = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
  assert.match(source, /md:p-\[calc\(var\(--ui-panel-padding\)\+4px\)\]/);
  assert.match(source, /top-\[calc\(var\(--project-tabs-height\)\+1rem\)\]/);
  assert.match(source, /max-h-\[calc\(100dvh-var\(--ui-topnav-height\)-var\(--project-tabs-height\)-2rem\)\]/);
  assert.match(source, /top-\[var\(--project-tabs-height\)\]/);
});
