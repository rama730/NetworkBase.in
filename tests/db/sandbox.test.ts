import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Report C1, C15 (M4d): nb learn's practice workspace. One per person, private, theirs; deleted at the end or by the
// daily sweep after 24 hours; a real workspace can never be deleted this way.
let sandbox: typeof import("../../src/lib/workspaces/sandbox");
before(async () => { sandbox = await loadAppModule(() => import("../../src/lib/workspaces/sandbox")); });
after(async () => { await sql.end(); await closeAppDb(); });

test("one private practice workspace per person, owned by them, ending in 24 hours", async () => {
  const me = await sql.begin((tx) => createUser(tx));
  const first = await sandbox.startSandbox(me);
  assert.equal(first.created, true);
  const again = await sandbox.startSandbox(me);
  assert.equal(again.created, false);
  assert.equal(again.id, first.id, "the same one while it lasts");
  const [row] = await sql`SELECT visibility, owner_id, sandbox_expires_at - created_at AS life FROM workspaces WHERE id = ${first.id}`;
  assert.equal(row!.visibility, "private");
  assert.equal(row!.owner_id, me);
  const [member] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${first.id} AND user_id = ${me}`;
  assert.equal(member!.role, "owner");
  assert.ok(String(row!.life).startsWith("1 day") || String(row!.life).startsWith("24:"), String(row!.life));
});

test("only its owner ends it, and a real workspace is never deleted this way", async () => {
  const [me, other] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const mine = await sandbox.startSandbox(me!);
  assert.equal(await sandbox.endSandbox(other!, mine.id), "missing", "someone else's");
  const real = await sql.begin((tx) => createProject(tx, me!));
  assert.equal(await sandbox.endSandbox(me!, real), "missing", "a real workspace");
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ${real}`)[0]!.n, 1);
  assert.equal(await sandbox.endSandbox(me!, mine.id), "deleted");
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ${mine.id}`)[0]!.n, 0);
});

test("the sweep deletes practice workspaces past their time, and an expired one is replaced on the next start", async () => {
  const [me, other] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const old = await sandbox.startSandbox(me!);
  await sql`UPDATE workspaces SET sandbox_expires_at = now() - interval '1 minute' WHERE id = ${old.id}`;
  const fresh = await sandbox.startSandbox(me!);
  assert.notEqual(fresh.id, old.id);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ${old.id}`)[0]!.n, 0);
  const left = await sandbox.startSandbox(other!);
  await sql`UPDATE workspaces SET sandbox_expires_at = now() - interval '1 minute' WHERE id = ${left.id}`;
  const swept = await sandbox.sweepSandboxes();
  assert.ok(swept.deleted >= 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ${left.id}`)[0]!.n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ${fresh.id}`)[0]!.n, 1, "a live one stays");
});

test("a practice workspace someone else joined has become real: it's kept, never swept (security review)", async () => {
  const [me, friend] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const mine = await sandbox.startSandbox(me!);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${mine.id}, ${friend!}, 'member')`;
  await sql`UPDATE workspaces SET sandbox_expires_at = now() - interval '1 minute' WHERE id = ${mine.id}`;
  await sandbox.sweepSandboxes();
  const [row] = await sql`SELECT sandbox_expires_at FROM workspaces WHERE id = ${mine.id}`;
  assert.ok(row, "still there");
  assert.equal(row!.sandbox_expires_at, null, "no longer a sandbox");
  assert.equal(await sandbox.endSandbox(me!, mine.id), "missing", "and nb learn can't delete it either");
});
