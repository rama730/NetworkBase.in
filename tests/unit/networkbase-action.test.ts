import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// @ts-expect-error plain JS module of the GitHub Action (report F6)
import { taskFromPullRequest } from "../../packages/networkbase-action/task.mjs";

test("the Action finds the task: Closes #4 in the pull request, else a branch nb/4-…", () => {
  assert.equal(taskFromPullRequest({ title: "Login fix", body: "This closes #4 and more" }), "4");
  assert.equal(taskFromPullRequest({ title: "Fixes #12: header", body: null }), "12");
  assert.equal(taskFromPullRequest({ title: "x", body: "", head: { ref: "nb/7-login-bug" } }), "7");
  assert.equal(taskFromPullRequest({ title: "x", body: "see #4", head: { ref: "feature/4" } }), null, "a mention isn't a close");
  assert.equal(taskFromPullRequest(null), null);
});

test("action.yml runs the published CLI with the token as a secret input", () => {
  const yml = readFileSync("packages/networkbase-action/action.yml", "utf8");
  assert.match(yml, /using: composite/);
  assert.match(yml, /NETWORKBASE_TOKEN: \$\{\{ inputs\.token \}\}/);
  assert.match(readFileSync("packages/networkbase-action/run.mjs", "utf8"), /@networkbase\/cli@2/);
});
