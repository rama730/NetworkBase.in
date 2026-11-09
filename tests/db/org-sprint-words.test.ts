import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Sprint redesign (2026-11-09): CO became Unit (a class) or Phase; admins can pick their own word, and rename old
// names once, on request.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.71" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let orgs: typeof import("../../src/app/actions/organizations");
let sprints: typeof import("../../src/lib/organizations/sprints");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  sprints = await loadAppModule(() => import("../../src/lib/organizations/sprints"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const user = () => sql.begin((tx) => createUser(tx));
async function classOrg() {
  const owner = await user();
  const id = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B' WHERE id = ${id}`;
  created.push(id);
  return { id, owner };
}
const sprint = async (ws: string, owner: string, n: number, name: string, parent: string | null = null) =>
  (await sql<{ id: string }[]>`INSERT INTO workspace_sprints (workspace_id, creator_id, sprint_number, name, start_date, end_date, status, parent_sprint_id)
    VALUES (${ws}, ${owner}, ${n}, ${name}, now() + ${`${n * 10} days`}::interval, now() + ${`${n * 10 + 6} days`}::interval, 'planning', ${parent}) RETURNING id`)[0]!.id;

test("a class's sprints are Units with Weeks; an admin's own word reaches the sprint page", async () => {
  const o = await classOrg();
  const context = await sprints.readSprintOrgContext(o.id, null);
  assert.deepEqual(context?.words, { main: "Unit", inner: "Week", plan: "Term", isClass: true });
  viewerId = o.owner;
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "work", { main_sprint_word: "co1" })).success, false, "letters only");
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "work", { main_sprint_word: "module" })).success, true);
  assert.equal((await sprints.readSprintOrgContext(o.id, null))?.words.main, "Module");
  // A team's workspace uses its organization's words.
  const team = await sql.begin((tx) => createProject(tx, o.owner));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${team}`;
  assert.equal((await sprints.readSprintOrgContext(team, null))?.words.main, "Module");
  // Back to the type's word.
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "work", { main_sprint_word: null })).success, true);
  assert.equal((await sprints.readSprintOrgContext(o.id, null))?.words.main, "Unit");
});

test("old names are renamed only when an admin asks; weeks inside and other names stay", async () => {
  const o = await classOrg();
  const co1 = await sprint(o.id, o.owner, 1, "CO1 Arrays and lists");
  await sprint(o.id, o.owner, 2, "CO2");
  await sprint(o.id, o.owner, 3, "Revision week");
  await sprint(o.id, o.owner, 4, "Week 1", co1);
  const member = await user();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${member}, 'member')`;
  viewerId = member;
  assert.equal((await orgs.readSprintRenameOfferAction(o.id)).success, false, "members don't rename");
  viewerId = o.owner;
  const offer = await orgs.readSprintRenameOfferAction(o.id);
  assert.deepEqual(offer.success && offer.changes, [{ from: "CO1 Arrays and lists", to: "Unit 1 Arrays and lists" }, { from: "CO2", to: "Unit 2" }]);
  assert.deepEqual(await orgs.renameOldSprintNamesAction(o.id), { success: true, renamed: 2 });
  const names = (await sql<{ name: string }[]>`SELECT name FROM workspace_sprints WHERE workspace_id = ${o.id} ORDER BY sprint_number`).map((r) => r.name);
  assert.deepEqual(names, ["Unit 1 Arrays and lists", "Unit 2", "Revision week", "Week 1"]);
  const again = await orgs.readSprintRenameOfferAction(o.id);
  assert.deepEqual(again.success && again.changes, [], "nothing left to offer");
});
