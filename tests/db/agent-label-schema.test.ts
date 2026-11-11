import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createProject, createUser, sql } from "./_helpers";

// Report Part B (migration 0086): the owner's "Show when agents helped" setting, who made a subtask, and browsers
// that can no longer read via / agent_name, so "No one" also means the data isn't sent.
after(() => sql.end());

test("workspaces default to Everyone and accept only the three choices", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, userId));
  const [row] = await sql`SELECT agent_label_visibility FROM workspaces WHERE id = ${ws}`;
  assert.equal(row!.agent_label_visibility, "everyone");
  for (const ok of ["person", "none", "everyone"]) await sql`UPDATE workspaces SET agent_label_visibility = ${ok} WHERE id = ${ws}`;
  await assert.rejects(sql`UPDATE workspaces SET agent_label_visibility = 'teammates' WHERE id = ${ws}`, /workspaces_agent_label_visibility_check/);
});

test("subtasks record who made them", async () => {
  const [col] = await sql`SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_subtasks' AND column_name = 'created_by'`;
  assert.equal(col?.is_nullable, "YES");
});

test("browsers read tasks, subtasks and comments but never via or agent_name", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["tasks", "task_subtasks", "task_comments"]) {
      const [row] = await sql`SELECT has_column_privilege(${role}, ${`public.${table}`}, 'id', 'SELECT') AS id_read,
        has_column_privilege(${role}, ${`public.${table}`}, 'via', 'SELECT') AS via_read,
        has_column_privilege(${role}, ${`public.${table}`}, 'agent_name', 'SELECT') AS agent_read`;
      assert.deepEqual({ ...row }, { id_read: true, via_read: false, agent_read: false }, `${role} ${table}`);
    }
  }
});
