import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

test("project Settings keeps visible clearance above and below its workspace", async () => {
  const source = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

  assert.match(source, /gap-6 px-4 pb-6 pt-5 sm:px-6 sm:pb-8 sm:pt-6/);
  assert.match(source, /top-\[calc\(var\(--project-tabs-height\)\+1\.5rem\)\]/);
  assert.match(source, /max-h-\[calc\(100dvh-var\(--ui-topnav-height\)-var\(--project-tabs-height\)-3\.5rem\)\]/);
  assert.match(source, /top-\[calc\(var\(--project-tabs-height\)\+1\.25rem\)\]/);
});
