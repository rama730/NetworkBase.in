import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Real database. The export carries what the settings page says it does, and only the person's own data.
let exporter: typeof import("@/lib/account/export-stream");
const created: string[] = [];

before(async () => {
  exporter = await loadAppModule(() => import("@/lib/account/export-stream"));
});
afterEach(async () => {
  if (created.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

const person = async () => {
  const id = await sql.begin((tx) => createUser(tx, {}));
  created.push(id);
  return id;
};
async function exportOf(userId: string) {
  const stream = await exporter.createAccountExportStream(userId, new AbortController().signal);
  const text = await new Response(stream).text();
  return JSON.parse(text) as Record<string, unknown[] | unknown>;
}

test("memberships, assigned tasks and update comments are exported, and nobody else's", async () => {
  const me = await person();
  const other = await person();
  const owner = await person();
  const project = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, project, me));
  await sql.begin((tx) => addMember(tx, project, other));
  await sql`INSERT INTO public.tasks (workspace_id, title, assignee_id) VALUES (${project}, 'Mine', ${me}), (${project}, 'Theirs', ${other})`;
  const [update] = await sql`INSERT INTO public.workspace_updates (workspace_id, author_id, content, visibility) VALUES (${project}, ${owner}, 'news', 'public') RETURNING id`;
  await sql`INSERT INTO public.workspace_update_comments (update_id, workspace_id, user_id, content) VALUES (${update!.id}, ${project}, ${me}, 'my comment'), (${update!.id}, ${project}, ${other}, 'their comment')`;

  const data = await exportOf(me) as { memberships: Array<{ projectId: string; role: string }>; assignedTasks: Array<{ title: string }>; updateComments: Array<{ content: string }> };
  assert.deepEqual(data.memberships.map((row) => row.projectId), [project]);
  assert.deepEqual(data.assignedTasks.map((row) => row.title), ["Mine"]);
  assert.deepEqual(data.updateComments.map((row) => row.content), ["my comment"]);
});

test("a person with nothing else still gets a valid file with every section", async () => {
  const data = await exportOf(await person());
  for (const key of ["profile", "projectContributions", "projects", "memberships", "assignedTasks", "updateComments", "connections", "messages", "legalAcceptances"]) {
    assert.ok(key in data, key);
  }
});
