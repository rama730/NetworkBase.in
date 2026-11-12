import assert from "node:assert/strict";
import { test } from "node:test";

import { workingLine } from "../../src/components/workspaces/v2/tasks/TaskDetailTabs/AgentPresence";

test("the task says who's working on it (report D5, D17)", () => {
  assert.equal(workingLine([]), null);
  assert.equal(workingLine(["Claude Code"]), "Claude Code is working on this");
  assert.equal(workingLine(["Claude Code", "Codex"]), "Claude Code and Codex are working on this");
  assert.equal(workingLine(["Claude Code", "Codex", "Cursor"]), "Claude Code, Codex and Cursor are working on this");
});
