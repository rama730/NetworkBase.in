import assert from "node:assert/strict";
import test from "node:test";
import { phaseProblems } from "../../src/components/workspaces/create-wizard/phase-problems";

// Create workspace v6, Task 2: how many things each step still needs (the step strip's "3 to fix").
const base = { title: "", description: "", project_type: "", custom_project_type: "", roles: [], import_source: { type: "scratch" } };

test("an empty Info has three to fix: name, category, description", () => {
  assert.equal(phaseProblems(base as never, { uploadReady: false })[2], 3);
});

test("a filled Info has none; Other needs its own name", () => {
  const filled = { ...base, title: "Garden Map", project_type: "side_project", description: "A shared map of community gardens and volunteer days." };
  assert.equal(phaseProblems(filled as never, { uploadReady: false })[2], 0);
  assert.equal(phaseProblems({ ...filled, project_type: "other" } as never, { uploadReady: false })[2], 1);
});

test("a role with no title and a duplicate title each count on Team", () => {
  const roles = [{ role: "", count: 1 }, { role: "Designer", count: 1 }, { role: "designer ", count: 1 }];
  assert.equal(phaseProblems({ ...base, roles } as never, { uploadReady: false })[3], 2);
});

test("Start counts a GitHub source that hasn't passed its check, and an upload that isn't ready", () => {
  assert.equal(phaseProblems({ ...base, import_source: { type: "github", repoUrl: "", metadata: {} } } as never, { uploadReady: false })[1], 1);
  assert.equal(phaseProblems({ ...base, import_source: { type: "github", repoUrl: "https://github.com/a/b", metadata: { githubPreflightStatus: "ok" } } } as never, { uploadReady: false })[1], 0);
  assert.equal(phaseProblems({ ...base, import_source: { type: "upload" } } as never, { uploadReady: false })[1], 1);
  assert.equal(phaseProblems({ ...base, import_source: { type: "upload" } } as never, { uploadReady: true })[1], 0);
});
