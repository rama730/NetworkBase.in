import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Report Part B: the scope a read uses; an organization assignment can't hide the label from its reviewers.
let scopes: typeof import("../../src/lib/agents/via-scope");
before(async () => { scopes = await loadAppModule(() => import("../../src/lib/agents/via-scope")); });
after(async () => { await sql.end(); await closeAppDb(); });

test("a personal workspace uses the owner's setting", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE workspaces SET agent_label_visibility = 'person' WHERE id = ${ws}`;
  assert.deepEqual(await scopes.labelScope(owner, ws), { setting: "person", orgForced: false, viewerId: owner, viewerStaff: false });
});

test("an organization assignment that is Labelled or Not allowed stays visible to its reviewers; Allowed follows the setting", async () => {
  const [owner, admin, student] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${admin!}, 'admin'), (${org}, ${student!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_settings = '{"assignmentAiPolicy":"allowed"}'::jsonb WHERE id = ${org}`;
  const copyWs = await sql.begin((tx) => createProject(tx, student!));
  await sql`UPDATE workspaces SET parent_id = ${org}, agent_label_visibility = 'none' WHERE id = ${copyWs}`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_settings, creator_id) VALUES (${org}, 'Lab', 'assignment', ${sql.json({ aiPolicy: "not_allowed" })}, ${owner!}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, assignment_id, assignee_id, creator_id) VALUES (${copyWs}, 'Lab', ${master!.id}, ${student!}, ${owner!}) RETURNING id`;

  const reviewer = await scopes.labelScope(admin!, copyWs, copy!.id);
  assert.deepEqual([reviewer.setting, reviewer.orgForced, reviewer.viewerStaff], ["none", true, true]);
  assert.equal(scopes.visibleVia(reviewer, { via: "agent", agentName: "Claude Code", authorId: student! }).via, "agent", "the copy's owner can't hide it");
  const classmate = await scopes.labelScope(student!, copyWs, copy!.id);
  assert.equal(classmate.viewerStaff, false);
  // Outside the assignment the organization allows AI, so the owner's "No one" applies to staff too.
  const plain = await scopes.labelScope(admin!, copyWs);
  assert.deepEqual([plain.orgForced, scopes.visibleVia(plain, { via: "agent", agentName: "x", authorId: student! }).via], [false, null]);
});
