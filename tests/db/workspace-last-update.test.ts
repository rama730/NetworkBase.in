import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { addMember, createProject, createUser, inRollback, sql, type Tx } from "./_helpers";

after(async () => { await sql.end(); });

const OLD = "2020-01-01T00:00:00Z";

/** A workspace last touched long ago by nobody, so any stamp shows. */
async function seed(tx: Tx) {
  const owner = await createUser(tx);
  const worker = await createUser(tx);
  const workspace = await createProject(tx, owner);
  await addMember(tx, workspace, worker);
  await tx`UPDATE workspaces SET last_update_at = ${OLD}, last_update_by = NULL WHERE id = ${workspace}`;
  return { owner, worker, workspace };
}
async function stamp(tx: Tx, workspace: string) {
  const [row] = await tx`SELECT last_update_at, last_update_by, updated_at FROM workspaces WHERE id = ${workspace}`;
  return { at: row!.last_update_at as Date, by: row!.last_update_by as string | null, updatedAt: row!.updated_at as Date };
}
const untouched = (row: { at: Date; by: string | null }) => row.at.getTime() === new Date(OLD).getTime() && row.by === null;
async function task(tx: Tx, workspace: string, assignmentId: string | null = null) {
  const id = randomUUID();
  await tx`INSERT INTO tasks (id, workspace_id, title, assignment_id) VALUES (${id}, ${workspace}, 'Lab', ${assignmentId})`;
  return id;
}
const taskEvent = (tx: Tx, taskId: string, workspace: string, actor: string | null, type = "status_changed") =>
  tx`INSERT INTO task_activity_events (task_id, workspace_id, actor_id, event_type) VALUES (${taskId}, ${workspace}, ${actor}, ${type})`;
const nodeEvent = (tx: Tx, workspace: string, actor: string | null, type: string, node: string | null = null) =>
  tx`INSERT INTO workspace_node_events (workspace_id, actor_id, type, node_id) VALUES (${workspace}, ${actor}, ${type}, ${node})`;
async function fileNode(tx: Tx, workspace: string, owner: string) {
  const id = randomUUID();
  await tx`INSERT INTO workspace_nodes (id, workspace_id, type, name, path, created_by) VALUES (${id}, ${workspace}, 'folder', 'Notes', ${`/${id}`}, ${owner})`;
  return id;
}

test("a new workspace starts as updated by its owner", () => inRollback(async (tx) => {
  const owner = await createUser(tx);
  const row = await stamp(tx, await createProject(tx, owner));
  assert.equal(row.by, owner);
  assert.ok(row.at);
}));

test("a task change by a person stamps the workspace; updated_at stays out of it", () => inRollback(async (tx) => {
  const { worker, workspace } = await seed(tx);
  const before = await stamp(tx, workspace);
  await taskEvent(tx, await task(tx, workspace), workspace, worker);
  const row = await stamp(tx, workspace);
  assert.equal(row.by, worker);
  assert.notEqual(row.at.getTime(), new Date(OLD).getTime());
  assert.equal(row.updatedAt.getTime(), before.updatedAt.getTime());
}));

test("a task event with no person doesn't stamp", () => inRollback(async (tx) => {
  const { workspace } = await seed(tx);
  await taskEvent(tx, await task(tx, workspace), workspace, null);
  assert.ok(untouched(await stamp(tx, workspace)));
}));

test("an org member's own assignment copy doesn't name them on the organization", () => inRollback(async (tx) => {
  const { owner, worker, workspace } = await seed(tx);
  await tx`UPDATE workspaces SET kind = 'organization', org_type = 'education' WHERE id = ${workspace}`;
  const master = randomUUID();
  await tx`INSERT INTO tasks (id, workspace_id, title, kind) VALUES (${master}, ${workspace}, 'Lab 3', 'assignment')`;
  await taskEvent(tx, await task(tx, workspace, master), workspace, worker);
  assert.ok(untouched(await stamp(tx, workspace)));
  await taskEvent(tx, master, workspace, owner, "created");
  assert.equal((await stamp(tx, workspace)).by, owner);
}));

test("a team's assignment copy in its own workspace counts", () => inRollback(async (tx) => {
  const { worker, workspace } = await seed(tx);
  const other = await seed(tx);
  await tx`UPDATE workspaces SET kind = 'organization', org_type = 'education' WHERE id = ${other.workspace}`;
  const master = randomUUID();
  await tx`INSERT INTO tasks (id, workspace_id, title, kind) VALUES (${master}, ${other.workspace}, 'Lab 3', 'assignment')`;
  await taskEvent(tx, await task(tx, workspace, master), workspace, worker);
  assert.equal((await stamp(tx, workspace)).by, worker);
}));

test("file work stamps; file locks, joins and settings don't", () => inRollback(async (tx) => {
  const { owner, worker, workspace } = await seed(tx);
  const node = await fileNode(tx, workspace, owner);
  await nodeEvent(tx, workspace, worker, "lock_release", node);
  await nodeEvent(tx, workspace, worker, "workspace_member.added");
  await nodeEvent(tx, workspace, worker, "project_settings.visibility_changed");
  await nodeEvent(tx, workspace, worker, "project_notification_settings.updated");
  assert.ok(untouched(await stamp(tx, workspace)));
  await nodeEvent(tx, workspace, worker, "create_file", node);
  assert.equal((await stamp(tx, workspace)).by, worker);
}));

test("links and readme settings count as detail edits", () => inRollback(async (tx) => {
  const { worker, workspace } = await seed(tx);
  await nodeEvent(tx, workspace, worker, "project_social_links.updated");
  assert.equal((await stamp(tx, workspace)).by, worker);
}));

test("a posted update stamps with its author", () => inRollback(async (tx) => {
  const { worker, workspace } = await seed(tx);
  await tx`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${worker}, 'Shipped')`;
  assert.equal((await stamp(tx, workspace)).by, worker);
}));

test("only a GitHub push that landed stamps", () => inRollback(async (tx) => {
  const { worker, workspace } = await seed(tx);
  const push = { direction: "push", mode: "direct" };
  const finish = async (manifest: object, result: object) => {
    const id = randomUUID();
    await tx`INSERT INTO github_sync_runs (id, workspace_id, actor_id, manifest, status) VALUES (${id}, ${workspace}, ${worker}, ${tx.json(manifest as never)}, 'review')`;
    await tx`UPDATE github_sync_runs SET status = 'completed', result = ${tx.json(result as never)} WHERE id = ${id}`;
  };
  await finish({ direction: "pull", mode: "direct" }, { pushed: true });
  await finish(push, { pushed: false });
  assert.ok(untouched(await stamp(tx, workspace)));
  await finish(push, { pushed: true });
  assert.equal((await stamp(tx, workspace)).by, worker);
}));

test("the same person within a minute doesn't rewrite; someone else does", () => inRollback(async (tx) => {
  const { owner, worker, workspace } = await seed(tx);
  const recent = new Date(Date.now() - 30_000);
  await tx`UPDATE workspaces SET last_update_at = ${recent}, last_update_by = ${worker} WHERE id = ${workspace}`;
  const taskId = await task(tx, workspace);
  await taskEvent(tx, taskId, workspace, worker);
  assert.equal((await stamp(tx, workspace)).at.getTime(), recent.getTime());
  await taskEvent(tx, taskId, workspace, owner);
  assert.equal((await stamp(tx, workspace)).by, owner);
}));

test("deleting the person leaves the time and clears the name", () => inRollback(async (tx) => {
  const { worker, workspace } = await seed(tx);
  await taskEvent(tx, await task(tx, workspace), workspace, worker);
  await tx`DELETE FROM task_activity_events WHERE actor_id = ${worker}`;
  await tx`DELETE FROM workspace_members WHERE user_id = ${worker}`;
  await tx`DELETE FROM profiles WHERE id = ${worker}`;
  const row = await stamp(tx, workspace);
  assert.equal(row.by, null);
  assert.notEqual(row.at.getTime(), new Date(OLD).getTime());
}));

test("the browser roles can't read the new columns", () => inRollback(async (tx) => {
  const [row] = await tx`SELECT has_column_privilege('anon', 'public.workspaces', 'last_update_by', 'SELECT') AS anon,
    has_column_privilege('authenticated', 'public.workspaces', 'last_update_by', 'SELECT') AS authed`;
  assert.deepEqual({ anon: row!.anon, authed: row!.authed }, { anon: false, authed: false });
}));

test("the backfill takes the newest real event, else updated_at with no name", () => inRollback(async (tx) => {
  const { owner, worker, workspace } = await seed(tx);
  const quiet = (await seed(tx)).workspace;
  const node = await fileNode(tx, workspace, owner);
  const taskId = await task(tx, workspace);
  await tx`INSERT INTO task_activity_events (task_id, workspace_id, actor_id, event_type, created_at) VALUES (${taskId}, ${workspace}, ${owner}, 'created', '2024-01-01T00:00:00Z')`;
  await tx`INSERT INTO workspace_node_events (workspace_id, actor_id, type, node_id, created_at) VALUES (${workspace}, ${worker}, 'create_file', ${node}, '2024-06-01T00:00:00Z')`;
  await tx`INSERT INTO workspace_node_events (workspace_id, actor_id, type, created_at) VALUES (${workspace}, ${owner}, 'workspace_member.added', '2025-01-01T00:00:00Z')`;
  await tx`UPDATE workspaces SET updated_at = '2025-03-03T00:00:00Z' WHERE id IN (${workspace}, ${quiet})`;

  const backfill = readFileSync("drizzle/0041_workspace_last_update.sql", "utf8").split("--> statement-breakpoint").find((part) => part.includes("-- The newest real event"))!;
  await tx.unsafe(backfill);

  const busy = await stamp(tx, workspace);
  assert.equal(busy.by, worker);
  assert.equal(busy.at.getTime(), new Date("2024-06-01T00:00:00Z").getTime());
  const none = await stamp(tx, quiet);
  assert.equal(none.by, null);
  assert.equal(none.at.getTime(), new Date("2025-03-03T00:00:00Z").getTime());
}));
