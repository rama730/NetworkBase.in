import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// SIMPLE-001: one enforced budget (GITHUB_WORKER_BUDGETS); no clone-era process or limit constants.
test("the importer keeps no retired clone-era scaffolding", () => {
  const runner = readFileSync("src/lib/github/workspace-import-runner.ts", "utf8");
  const utils = readFileSync("src/lib/import/utils.ts", "utf8");
  assert.doesNotMatch(runner, /child_process|execFileAsync|GIT_CLONE_TIMEOUT_MS|GITHUB_IMPORT_CLONE_TIMEOUT_MS/);
  assert.doesNotMatch(utils, /MAX_IMPORT_(FILE_COUNT|TOTAL_BYTES|DIR_COUNT)|GITHUB_IMPORT_MAX_/);
  assert.match(runner, /GITHUB_WORKER_BUDGETS\.maxFiles/);
});
