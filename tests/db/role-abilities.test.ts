import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { actAs, actAsOwner, addMember, closeAppDb, createProject, createUser, inRollback, loadAppModule, moduleStubs, sql } from "./_helpers";

// Member settings Part 4: what each role may do. The app's roleAllows() and the SQL mirror nb_workspace_role_allows()
// agree for every role and ability, with today's rules and with the owner's changes; the gates use them.
moduleStubs.set("@/lib/realtime/server-broadcast", { broadcast: async () => true });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, getAll: () => [] }) });

let abilities: typeof import("../../src/lib/workspaces/role-abilities");
let access: typeof import("../../src/lib/data/workspace-access");
let transition: typeof import("../../src/lib/workspaces/task-transition-service");
let db: typeof import("../../src/lib/db").db;
before(async () => {
  abilities = await loadAppModule(() => import("../../src/lib/workspaces/role-abilities"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  transition = await loadAppModule(() => import("../../src/lib/workspaces/task-transition-service"));
  db = (await loadAppModule(() => import("../../src/lib/db"))).db;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function setup() {
  const [owner, admin, member, viewer, done] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  await sql.begin(async (tx) => {
    await addMember(tx, ws, owner!, "owner");
    await addMember(tx, ws, admin!, "admin");
    await addMember(tx, ws, member!, "member");
    await addMember(tx, ws, viewer!, "viewer");
    await addMember(tx, ws, done!, "member");
  });
  await sql`UPDATE workspace_members SET completed_at = now(), completed_by = user_id WHERE workspace_id = ${ws} AND user_id = ${done!}`;
  return { ws, people: { owner: owner!, admin: admin!, member: member!, viewer: viewer!, done: done! } };
}

const sqlAllows = (ws: string, userId: string, ability: string) =>
  inRollback(async (tx) => { await actAs(tx, userId); const [r] = await tx`SELECT app_private.nb_workspace_role_allows(${ws}, ${ability}) AS ok`; await actAsOwner(tx); return Boolean(r!.ok); });

async function agree(ws: string, people: Record<string, string>) {
  for (const [who, id] of Object.entries(people)) {
    const a = await access.getWorkspaceAccessById(ws, id);
    for (const { key } of abilities.ROLE_ABILITIES) {
      assert.equal(await sqlAllows(ws, id, key), access.accessAllows(a, key), `${who} · ${key}: SQL and the app agree`);
    }
  }
}

test("defaults are today's rules, and SQL agrees with the app for every role and ability", async () => {
  const { ws, people } = await setup();
  await agree(ws, people);
  const a = (id: string) => access.getWorkspaceAccessById(ws, id);
  assert.equal(access.accessAllows(await a(people.member), "tasks.create"), true);
  assert.equal(access.accessAllows(await a(people.member), "tasks.delete"), false, "today only the owner deletes");
  assert.equal(access.accessAllows(await a(people.member), "members.invite"), false);
  assert.equal(access.accessAllows(await a(people.admin), "export"), true);
  assert.equal(access.accessAllows(await a(people.viewer), "tasks.create"), false);
  assert.equal(access.accessAllows(await a(people.done), "tasks.edit"), false, "a completed part counts as a viewer");
  assert.equal(access.accessAllows(await a(people.owner), "tasks.delete"), true);
});

test("the owner's changes apply in the app and in SQL; viewers never get write abilities", async () => {
  const { ws, people } = await setup();
  const changed = abilities.normalizeRoleAbilities({
    admin: { "tasks.delete": true, export: false },
    member: { "tasks.edit": false, "members.invite": true, "files.see": false },
    viewer: { "tasks.create": true, "agents.use": false },
  });
  assert.deepEqual(changed, {
    admin: { "tasks.delete": true, export: false },
    member: { "tasks.edit": false, "members.invite": true, "files.see": false },
    viewer: { "agents.use": false },
  }, "a viewer's write grant is dropped");
  await sql`UPDATE workspaces SET role_abilities = ${sql.json(changed as never)} WHERE id = ${ws}`;
  // A raw grant written past the app still can't give a viewer a write ability in SQL.
  await sql`UPDATE workspaces SET role_abilities = role_abilities || '{"viewer": {"agents.use": false, "tasks.create": true}}'::jsonb WHERE id = ${ws}`;
  await agree(ws, people);
  const a = (id: string) => access.getWorkspaceAccessById(ws, id);
  assert.equal(access.accessAllows(await a(people.admin), "tasks.delete"), true, "admin may delete");
  assert.equal(access.accessAllows(await a(people.member), "members.invite"), true, "member may invite");
  assert.equal(access.accessAllows(await a(people.viewer), "tasks.create"), false, "viewer never creates");
  // Files: a member who can't see Files reads it like a visitor (private workspace: not at all).
  assert.equal(access.canReadWorkspaceTab(await a(people.member), "files"), false, "member can't see Files");
  assert.equal(access.canReadWorkspaceTab(await a(people.admin), "files"), true, "admin sees Files");
});

test("the gates: task edits refuse a role without Edit, and a completed member", async () => {
  const { ws, people } = await setup();
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id) VALUES (${ws}, 'One', 'todo', ${people.owner}) RETURNING id`;
  const lock = (userId: string) => db.transaction((tx) => transition.lockTaskForWrite(tx, task!.id as string, userId));
  await lock(people.member);
  await assert.rejects(lock(people.done), /completed/);
  await sql`UPDATE workspaces SET role_abilities = '{"member": {"tasks.edit": false}}'::jsonb WHERE id = ${ws}`;
  await assert.rejects(lock(people.member), /can’t edit tasks/);
  await lock(people.admin);
});
