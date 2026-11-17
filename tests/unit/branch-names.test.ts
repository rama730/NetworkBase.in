import assert from "node:assert/strict";
import { test } from "node:test";

import { branchNameForTask, branchNameProblem } from "../../src/lib/branches/names";

// Report H2: branch name rules, and the name a task's branch gets.
test("branch names: what's allowed and what's refused", () => {
  for (const ok of ["feature-x", "task/4-login-bug", "ram/try_new_header", "release-1.2", "A".repeat(100)]) assert.equal(branchNameProblem(ok), null, ok);
  for (const bad of ["", " ", "main", "MAIN", "HEAD", "/x", "x/", "a//b", "a..b", ".hidden", "x.", "x.lock", "has space", "émoji", "a:b", "A".repeat(101)]) {
    assert.ok(branchNameProblem(bad), bad);
  }
});

test("a task's branch name", () => {
  assert.equal(branchNameForTask(4, "Fix the login bug!"), "task/4-fix-the-login-bug");
  assert.equal(branchNameForTask(12, "Été — café", "agent"), "agent/12-ete-cafe");
  assert.equal(branchNameForTask(7, "!!!"), "task/7");
  assert.equal(branchNameProblem(branchNameForTask(9, "x".repeat(200))), null);
});
