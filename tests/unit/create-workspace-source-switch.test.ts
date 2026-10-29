import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFormControl } from "react-hook-form";

// Bug: GitHub -> Start empty left Continue greyed out. Phase 1 replaces the whole
// `import_source` object; react-hook-form does not re-render a host that only read
// `watch('import_source.type')` for a parent-path setValue, so the footer kept "github".
test("a parent-path setValue reaches useWatch-style subscribers but not the root render", () => {
  const { control, setValue, watch } = createFormControl<{ import_source: { type: string; metadata?: object } }>({
    defaultValues: { import_source: { type: "scratch" } },
  });
  watch("import_source.type");
  let rootRenders = 0;
  let watcherUpdates = 0;
  control._subscribe({ formState: control._proxyFormState, reRenderRoot: true, callback: () => { rootRenders++; } });
  control._subscribe({ name: ["import_source.type"], formState: { values: true }, callback: () => { watcherUpdates++; } });
  control._state.mount = true;

  for (const type of ["github", "scratch"]) {
    setValue("import_source", { ...control._formValues.import_source, type, metadata: {} }, { shouldDirty: true });
  }

  assert.equal(control._formValues.import_source.type, "scratch");
  assert.equal(rootRenders, 0, "watch() in render is not a subscription: the host may never re-render");
  assert.ok(watcherUpdates >= 2, "useWatch sees every source switch");
});

test("the create wizard subscribes to the source fields with useWatch, not render-time watch()", () => {
  const wizard = readFileSync("src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx", "utf8");
  const hook = readFileSync("src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts", "utf8");

  assert.doesNotMatch(wizard, /methods\.watch\(/);
  assert.match(wizard, /useWatch\(\{\s*control: methods\.control,\s*name: \['import_source\.type', 'import_source\.repoUrl', 'import_source\.metadata'\]/);
  assert.doesNotMatch(hook, /= watch\('import_source\./);
  assert.match(hook, /useWatch\(\{\s*control: methods\.control,\s*name: \['import_source\.type', 'import_source\.repoUrl', 'import_source\.branch'\]/);
});
