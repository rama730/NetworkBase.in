import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Left navigation → Workspaces (2026-11-05-sidebar-workspaces-findings.md §3a): ordered by your own visits (G4),
// new-updates dots (G5), every child and up to 50 personal workspaces so the list can show the one you're on (G2, G3),
// and pins on the account (G9, D4).

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }), getSession: async () => ({ data: { session: null }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.42" }) });

let side: typeof import("../../src/app/actions/org-workspace");
let members: typeof import("../../src/lib/organizations/members");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", { ...viewerContext, getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }) });
  side = await loadAppModule(() => import("../../src/app/actions/org-workspace"));
  members = await loadAppModule(() => import("../../src/lib/organizations/members"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function space(owner: string, title: string, extra: string[] = []) {
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "public" }));
  await sql`UPDATE workspaces SET title = ${title} WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${owner}, 'owner', now() - interval '30 days')`;
  for (const u of extra) await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${u}, 'member', now() - interval '30 days')`;
  created.push(id);
  return id;
}

test("G4: ordered by your own visits, not by other people's edits; every open counts", async () => {
  const [me, other] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const a = await space(me!, "Alpha", [other!]);
  const b = await space(me!, "Bravo", [other!]);
  viewerId = me!;
  await members.stampOpened(a, me!);
  let read = await side.readSidebarWorkspacesAction();
  assert.deepEqual(read!.personal.map((p) => p.title).slice(0, 2), ["Alpha", "Bravo"]);
  await sql`UPDATE workspaces SET updated_at = now() + interval '1 hour' WHERE id = ${b}`;
  read = await side.readSidebarWorkspacesAction();
  assert.equal(read!.personal[0]!.title, "Alpha", "someone else's edit doesn't move Bravo up");
  await members.stampOpened(b, me!);
  read = await side.readSidebarWorkspacesAction();
  assert.equal(read!.personal[0]!.title, "Bravo", "opening it moves it up");
});

test("G5: a dot when someone else posted after your last visit; not for your own posts; gone once you open the workspace or its Updates", async () => {
  const [me, other] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await space(me!, "Dots", [other!]);
  viewerId = me!;
  const dot = async () => (await side.readSidebarWorkspacesAction())!.personal.find((p) => p.id === ws)!.unseen;
  assert.equal(await dot(), false);
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ws}, ${me!}, 'Mine')`;
  assert.equal(await dot(), false, "your own post isn't news");
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ws}, ${other!}, 'Theirs')`;
  assert.equal(await dot(), true);
  await members.stampOpened(ws, me!);
  assert.equal(await dot(), false, "opening the workspace (any tab) clears it — the user, 5 Nov");
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, created_at) VALUES (${ws}, ${other!}, 'Later', now() + interval '1 second')`;
  assert.equal(await dot(), true, "a newer post brings it back");
  await sql`UPDATE workspace_members SET last_seen_updates_at = now() + interval '2 seconds' WHERE workspace_id = ${ws} AND user_id = ${me!}`;
  assert.equal(await dot(), false, "reading Updates clears it too");
});

test("G2, G3: every child of an organization and up to 50 personal workspaces come back", async () => {
  const me = await sql.begin((tx) => createUser(tx));
  const org = await space(me, "Big Org");
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  for (let i = 0; i < 7; i += 1) {
    const child = await space(me, `Team ${i}`);
    await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${child}`;
  }
  for (let i = 0; i < 14; i += 1) await space(me, `Side ${i}`);
  viewerId = me;
  const read = await side.readSidebarWorkspacesAction();
  assert.equal(read!.orgs.find((o) => o.id === org)!.children.length, 7, "no longer cut at 5");
  assert.ok(read!.personal.length >= 14, "no longer cut at 12");
});

test("G9, D4: pins are on the account, need membership, stop at 10, and come back first in the order pinned", async () => {
  const [me, stranger] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const mine = await Promise.all(Array.from({ length: 11 }, (_, i) => space(me!, `Pin ${i}`)));
  const theirs = await space(stranger!, "Not mine");
  viewerId = me!;
  assert.equal((await side.setSidebarPinAction(theirs, true)).success, false, "only workspaces you're in");
  for (const id of mine.slice(0, 10)) assert.deepEqual(await side.setSidebarPinAction(id, true), { success: true });
  const eleventh = await side.setSidebarPinAction(mine[10]!, true);
  assert.ok(!eleventh.success && /up to 10/.test(eleventh.error));
  assert.deepEqual((await side.readSidebarWorkspacesAction())!.pinned, mine.slice(0, 10));
  assert.deepEqual(await side.setSidebarPinAction(mine[0]!, false), { success: true });
  assert.equal((await side.readSidebarWorkspacesAction())!.pinned.includes(mine[0]!), false);
  await sql`DELETE FROM workspaces WHERE id = ${mine[1]!}`;
  assert.equal((await sql`SELECT 1 FROM sidebar_pins WHERE workspace_id = ${mine[1]!}`).length, 0, "a deleted workspace leaves no pin");
});
