import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId: string | null = null;
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => (viewerId ? { id: viewerId } : null) });

let action: typeof import("../../src/app/actions/workspace/last-update");
const users: string[] = [];
before(async () => {
  action = await loadAppModule(() => import("../../src/app/actions/workspace/last-update"));
});
afterEach(async () => {
  viewerId = null;
  if (users.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(users)}`;
  users.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function seed(options: { visibility?: string; workerVisibility?: string } = {}) {
  return sql.begin(async (tx) => {
    const owner = await createUser(tx);
    const worker = await createUser(tx, { visibility: options.workerVisibility ?? "public" });
    const member = await createUser(tx);
    const outsider = await createUser(tx);
    users.push(owner, worker, member, outsider);
    const workspace = await createProject(tx, owner, { visibility: options.visibility ?? "public" });
    await addMember(tx, workspace, worker);
    await addMember(tx, workspace, member);
    await tx`UPDATE workspaces SET last_update_by = ${worker} WHERE id = ${workspace}`;
    const [row] = await tx`SELECT username FROM profiles WHERE id = ${worker}`;
    return { owner, worker, member, outsider, workspace, name: row!.username as string };
  });
}
const read = async (viewer: string | null, workspace: string) => {
  viewerId = viewer;
  return (await action.getWorkspaceLastUpdates({ projectIds: [workspace] }))[0] ?? null;
};

test("anyone who can read a public workspace sees a public profile's name", async () => {
  const { outsider, workspace, name } = await seed();
  assert.equal((await read(null, workspace))?.byName, name);
  assert.equal((await read(outsider, workspace))?.byName, name);
});

test("a non-public profile's name is for members only; others still see the time", async () => {
  const { member, outsider, workspace, name } = await seed({ workerVisibility: "private" });
  assert.equal((await read(member, workspace))?.byName, name);
  const seen = await read(outsider, workspace);
  assert.equal(seen?.byName, null);
  assert.ok(seen?.at);
});

test("a viewer who can't read the workspace gets nothing", async () => {
  const { member, outsider, workspace } = await seed({ visibility: "private" });
  assert.equal(await read(outsider, workspace), null);
  assert.equal(await read(null, workspace), null);
  assert.ok(await read(member, workspace));
});

test("someone the viewer blocked isn't named", async () => {
  const { member, worker, workspace } = await seed();
  await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${member}, ${worker})`;
  assert.equal((await read(member, workspace))?.byName, null);
});

test("a deleted workspace returns nothing", async () => {
  const { owner, workspace } = await seed();
  await sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${workspace}`;
  assert.equal(await read(owner, workspace), null);
});
