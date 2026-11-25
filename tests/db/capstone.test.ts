import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.5a (report 31.6 C4): a team's Capstone card, Ready only with every milestone done, public only when every
// member agrees; the class's Showcase (members see Ready cards, outsiders only public ones) and the staff table.
let viewerId = "";
let token: string | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.192" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/capstone");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/capstone"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const err = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("capstone card, Ready with milestones, public with every member's agreement, showcase and staff table", async () => {
  const [teacher, a, b, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "public" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${a!}, 'member'), (${klass}, ${b!}, 'member')`;
  const ws = await sql.begin((tx) => createProject(tx, a!, { visibility: "org" }));
  created.push(ws);
  await sql`UPDATE workspaces SET parent_id = ${klass}, title = 'Team Kite' WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${a!}, 'owner'), (${ws}, ${b!}, 'member')`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow) VALUES (${ws}, 'capstone')`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind) VALUES (${klass}, 'Final', 'todo', 'medium', ${teacher!}, 'assignment') RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, review_status, due_date) VALUES (${ws}, 'Final', 'todo', 'medium', ${a!}, 'task', ${master!.id}, 'none', now() + interval '5 days') RETURNING id`;

  viewerId = outsider!;
  assert.equal((await act.readCapstoneAction(ws)).success, false, "outsiders don't read the team's card");
  viewerId = a!;
  assert.equal((await act.saveCapstoneAction(ws, { problem: "Buses are late", metrics: ["Predict within 2 min", "Used by 50 riders"], roles: { [b!]: "Front-end" }, showcase: { title: "Bus delay predictor", line: "Know before you wait" } })).success, true);
  assert.match(err(await act.saveCapstoneAction(ws, { roles: { [outsider!]: "Spy" } })), /team’s members/);
  token = "agent";
  assert.equal((await act.saveCapstoneAction(ws, { problem: "x" })).success, false, "tokens don't edit the card");
  token = null;
  const card = await act.readCapstoneAction(ws);
  assert.ok(card.success);
  assert.deepEqual([card.capstone.problem, card.capstone.roles[b!], card.next?.title], ["Buses are late", "Front-end", "Final"]);
  assert.match(err(await act.setShowcaseReadyAction(ws, true)), /every milestone/);
  await sql`UPDATE tasks SET status = 'done' WHERE id = ${copy!.id}`;
  assert.equal((await act.setShowcaseReadyAction(ws, true)).success, true);

  // Members of the class see the Ready card; an outsider only once every team member agreed.
  viewerId = b!;
  const inside = await act.readShowcaseAction(klass);
  assert.ok(inside.success);
  assert.deepEqual(inside.cards.map((c) => c.title), ["Bus delay predictor"]);
  viewerId = outsider!;
  const before1 = await act.readShowcaseAction(klass);
  assert.ok(before1.success);
  assert.equal(before1.cards.length, 0, "not public until everyone agrees");
  viewerId = a!;
  assert.equal((await act.consentShowcaseAction(ws, true)).success, true);
  viewerId = outsider!;
  assert.equal((await act.consentShowcaseAction(ws, true)).success, false, "only members agree for themselves");
  assert.equal(((await act.readShowcaseAction(klass)) as { cards: unknown[] }).cards.length, 0);
  viewerId = b!;
  assert.equal((await act.consentShowcaseAction(ws, true)).success, true);
  viewerId = outsider!;
  const pub = await act.readShowcaseAction(klass);
  assert.ok(pub.success);
  assert.deepEqual(pub.cards.map((c) => [c.title, c.team]), [["Bus delay predictor", null]], "public, without the team's names");
  // Security review: changing the card after everyone agreed asks the others again.
  viewerId = a!;
  assert.equal((await act.saveCapstoneAction(ws, { showcase: { line: "Something new" } })).success, true);
  viewerId = outsider!;
  assert.equal(((await act.readShowcaseAction(klass)) as { cards: unknown[] }).cards.length, 0, "not public until B agrees to the new words");
  viewerId = a!;
  assert.equal((await act.saveCapstoneAction(ws, { problem: "Buses are very late" })).success, true);
  const still = await act.readCapstoneAction(ws);
  assert.ok(still.success && Boolean(still.capstone.showcase.consents[a!]), "the brief isn't the card: A's agreement stays");
  viewerId = b!;
  assert.equal((await act.consentShowcaseAction(ws, true)).success, true);

  // Staff table: counts and states, never the team's work.
  viewerId = a!;
  assert.equal((await act.readCapstoneTeamsAction(klass)).success, false, "staff only");
  viewerId = teacher!;
  const t = await act.readCapstoneTeamsAction(klass);
  assert.ok(t.success);
  assert.deepEqual(t.rows.map((r) => [r.title, r.size, r.done, r.total, r.showcase]), [["Team Kite", 2, 1, 1, "public"]]);
});
