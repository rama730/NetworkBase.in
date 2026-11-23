import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ROLE_ABILITIES, abilityEditable, normalizeRoleAbilities, roleAllows } from "../../src/lib/workspaces/role-abilities";

// Member settings Part 4: every ability is checked where the work happens, through roleAllows/accessAllows, so no
// gate keeps its own copy of the rules. The SQL mirror is checked against the app in tests/db/role-abilities.test.ts.
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const GATES: Record<string, string[]> = {
  "tasks.create": ["src/lib/workspaces/server/tasks.ts"],
  "tasks.edit": ["src/lib/workspaces/task-transition-service.ts"],
  "tasks.delete": ["src/lib/workspaces/server/tasks.ts"],
  "files.upload": ["src/lib/files/internal-helpers.ts"],
  "members.invite": ["src/lib/workspaces/workspace-invitations.ts"],
  "files.see": ["src/lib/data/workspace-access.ts", "src/components/workspaces/dashboard/WorkspaceLayout.tsx"],
  "docs.drafts": ["src/lib/workspaces/doc.ts"],
  "agents.use": ["src/lib/agents/policy.ts"],
  export: ["src/app/api/v1/workspaces/[id]/export/route.ts"],
};

test("every ability has a gate that reads it", () => {
  assert.deepEqual(Object.keys(GATES).sort(), ROLE_ABILITIES.map((a) => a.key).sort());
  for (const [ability, files] of Object.entries(GATES)) {
    for (const file of files) assert.match(read(file), new RegExp(`["']${ability.replace(".", "\\.")}["']`), `${file} checks ${ability}`);
  }
});

test("defaults are today's rules; the owner always may; viewers never get write abilities", () => {
  assert.equal(roleAllows(null, "owner", "tasks.delete"), true);
  assert.equal(roleAllows(null, "member", "tasks.delete"), false, "only the owner deletes tasks today");
  assert.equal(roleAllows(null, "admin", "members.invite"), true);
  assert.equal(roleAllows(null, "member", "members.invite"), false);
  assert.equal(roleAllows(null, null, "files.see"), false, "outsiders aren't covered here");
  for (const a of ROLE_ABILITIES) {
    if (a.write || a.key === "export") {
      assert.equal(abilityEditable("viewer", a.key), false, a.key);
      assert.equal(roleAllows({ viewer: { [a.key]: true } }, "viewer", a.key), false, `viewer · ${a.key}`);
    }
  }
  assert.equal(normalizeRoleAbilities({ member: { "tasks.create": true } }), null, "a cell equal to today's rule isn't stored");
  assert.equal(roleAllows({ member: { "tasks.edit": false } }, "member", "tasks.edit", { orgRules: true }), true, "organizations keep their own table");
});
