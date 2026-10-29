import assert from "node:assert/strict";
import { after, test } from "node:test";

import { addMember, createProject, createUser, sql } from "./_helpers";

after(() => sql.end());

async function channelOf(owner: string, projectId: string, name: string) {
  const [{ id }] = await sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${owner}::uuid, ${name}, null, false) AS id`;
  return id as string;
}
const bootstrap = async (userId: string) =>
  (await sql`SELECT app_private.chat_bootstrap(${userId}::uuid, null) AS b`)[0]!.b as { projects: Array<{ id: string }>; channels: Array<{ id: string; project_id: string | null }> };

async function twoProjects() {
  const owner = await sql.begin((tx) => createUser(tx));
  const live = await sql.begin((tx) => createProject(tx, owner));
  const gone = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, live, owner, "owner"));
  await sql.begin((tx) => addMember(tx, gone, owner, "owner"));
  const liveChannel = await channelOf(owner, live, `live-${owner.slice(0, 6)}`);
  const goneChannel = await channelOf(owner, gone, `gone-${owner.slice(0, 6)}`);
  const cleanup = async () => {
    await sql`DELETE FROM chat_channels WHERE workspace_id = ANY(${[live, gone]}::uuid[])`;
    await sql`DELETE FROM workspaces WHERE id = ANY(${[live, gone]}::uuid[])`;
    await sql`DELETE FROM profiles WHERE id = ${owner}`;
  };
  return { owner, live, gone, liveChannel, goneChannel, cleanup };
}

// A soft-deleted project showed up as a second copy of itself in Messages.
test("the bootstrap lists neither a deleted project nor its channels, even if a channel was left behind", async () => {
  const f = await twoProjects();
  try {
    // Simulate what earlier versions of project delete left: the workspace soft-deleted with its channel intact.
    await sql`ALTER TABLE workspaces DISABLE TRIGGER workspaces_drop_chat_on_soft_delete`;
    await sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${f.gone}`;
    await sql`ALTER TABLE workspaces ENABLE TRIGGER workspaces_drop_chat_on_soft_delete`;
    assert.equal((await sql`SELECT 1 FROM chat_channels WHERE id = ${f.goneChannel}`).length, 1, "the leftover channel exists");
    const data = await bootstrap(f.owner);
    assert.deepEqual(data.projects.map((p) => p.id), [f.live]);
    assert.deepEqual(data.channels.filter((c) => c.project_id).map((c) => c.project_id), [f.live]);
  } finally { await f.cleanup(); }
});

test("soft-deleting a project removes its chat; other projects keep theirs", async () => {
  const f = await twoProjects();
  try {
    await sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${f.gone}`;
    assert.equal((await sql`SELECT 1 FROM chat_channels WHERE id = ${f.goneChannel}`).length, 0);
    assert.equal((await sql`SELECT 1 FROM chat_channel_members WHERE channel_id = ${f.goneChannel}`).length, 0);
    assert.equal((await sql`SELECT 1 FROM chat_channels WHERE id = ${f.liveChannel}`).length, 1);
    const data = await bootstrap(f.owner);
    assert.deepEqual(data.projects.map((p) => p.id), [f.live]);
  } finally { await f.cleanup(); }
});

test("a deleted project's members no longer count as project members for chat", async () => {
  const f = await twoProjects();
  try {
    const member = async (project: string) => (await sql`SELECT app_private.chat_is_workspace_member(${project}::uuid, ${f.owner}::uuid) AS v`)[0]!.v as boolean;
    assert.equal(await member(f.gone), true);
    await sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${f.gone}`;
    assert.equal(await member(f.gone), false);
    assert.equal(await member(f.live), true);
  } finally { await f.cleanup(); }
});
