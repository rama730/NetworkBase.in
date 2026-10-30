import assert from "node:assert/strict";
import { after, test } from "node:test";

import { profileSkills, tasks, uploadIntents, workspaceMembers, workspaceNodes, workspaces, workspaceUpdateDrafts } from "../../src/lib/db/schema";
import { sql } from "./_helpers";

after(() => sql.end());

// The database rule and the code's list must say the same thing: a new value needs a migration and a schema change.
const RULES = [
  ["workspace_members", "workspace_members_role_check", workspaceMembers.role.enumValues],
  ["workspaces", "workspaces_visibility_check", workspaces.visibility.enumValues],
  ["workspaces", "workspaces_sync_status_check", workspaces.syncStatus.enumValues],
  ["tasks", "tasks_review_status_check", tasks.reviewStatus.enumValues],
  ["workspace_update_drafts", "workspace_update_drafts_visibility_check", workspaceUpdateDrafts.visibility.enumValues],
  ["profile_skills", "profile_skills_visibility_check", profileSkills.visibility.enumValues],
  ["upload_intents", "upload_intents_kind_check", uploadIntents.kind.enumValues],
  ["workspace_nodes", "workspace_nodes_type_check", workspaceNodes.type.enumValues],
] as const;

for (const [table, name, values] of RULES) {
  test(`${name} allows exactly the values the code declares`, async () => {
    const [row] = await sql`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conrelid = ${`public.${table}`}::regclass AND conname = ${name}`;
    assert.ok(row, `${name} exists`);
    assert.equal(row.convalidated, true);
    const allowed = [...String(row.def).matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
    assert.deepEqual([...allowed].sort(), [...values].sort());
  });
}
