import assert from "node:assert/strict";
import { it } from "node:test";

import { parseReport } from "../../src/lib/workspaces/task-report";

it("reads the CLI's report comment: summary, checks with notes, output", () => {
  const r = parseReport("**Report** Fixed the login\n\n- ✓ npm test — 42 passed\n- ✗ lint\n```\n\x1b[31m1 error\x1b[0m\n```");
  assert.equal(r?.summary, "Fixed the login");
  assert.deepEqual(r?.checks, [{ ok: true, name: "npm test", note: "42 passed" }, { ok: false, name: "lint", note: null }]);
  assert.match(r?.output ?? "", /1 error/);
  assert.equal(parseReport("just a comment"), null);
});
