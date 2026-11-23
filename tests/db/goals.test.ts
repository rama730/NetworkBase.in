import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A4.1 (report 38.11 D1): meetings, series, Finish with carried action items, reminders, Open action items.


let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.174" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let docs: typeof import("../../src/app/actions/workspace/doc");
let taskActions: typeof import("../../src/app/actions/task");
let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true, time_zone = 'Asia/Kolkata' WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'goals', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const doc = async (slug: string) => {
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', ${slug + ".md"}, ${"/" + slug + ".md"}, ${owner!}) RETURNING id`;
    const [row] = await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${ws}, ${node!.id}, ${slug}, ${slug + ".md"}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })}) RETURNING id`;
    return row!.id as string;
  };
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws, doc };
}
const settingsOf = async (id: string) => (await sql`SELECT settings FROM workspace_documents WHERE id = ${id}`)[0]!.settings;
const ist = (s: string) => new Date(`${s}+05:30`).toISOString();

const goalsDoc = async (t: Awaited<ReturnType<typeof workspace>>, slug: string, period: string) => {
  const id = await t.doc(slug);
  const r = await docs.createGoalsDocAction(t.ws, { docSlug: slug, period });
  return { id, r };
};

test("W1: one members-only goals document per period", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const { id, r } = await goalsDoc(t, "goals-q1", "2027-Q1");
  assert.ok(r.success, JSON.stringify(r));
  assert.deepEqual([(await settingsOf(id)).section, (await settingsOf(id)).period, (await settingsOf(id)).visibilityOverride], ["goals", "2027-Q1", "members_only"]);
  const again = await goalsDoc(t, "goals-q1-again", "2027-Q1");
  assert.equal((again.r as { error?: string }).error, "Q1 2027 already has a goals document.");
  viewerId = t.viewer;
  assert.equal(((await goalsDoc(t, "viewer-goals", "2027-Q2")).r as { error?: string }).error, "Only people who can edit documents set goals.");
  // Never public: someone outside sees nothing even in a public workspace.
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${t.ws}`;
  viewerId = t.outsider;
  assert.equal((await docs.readGoalsAction(t.ws, "goals-q1") as { error?: string }).error, "Goals are for workspace members.");
});

test("W2–W5: objectives and key results (off the board), check-ins move current and confidence, pace and status, set by hand until the next check-in", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await goalsDoc(t, "goals-q1", "2027-Q1");
  const o = await docs.addObjectiveAction(t.ws, { docSlug: "goals-q1", title: "Teams love the app" });
  assert.ok(o.success && o.id);
  assert.equal((await docs.addKeyResultAction(t.ws, { docSlug: "goals-q1", objectiveId: o.id, title: "x", direction: "increase", unit: "", start: 10, target: 5 }) as { error?: string }).error, "The target is below the start: pick Decrease.");
  const kr = await docs.addKeyResultAction(t.ws, { docSlug: "goals-q1", objectiveId: o.id, title: "Weekly active teams", direction: "increase", unit: "teams", start: 10, target: 50, assigneeId: t.member });
  assert.ok(kr.success && kr.id, JSON.stringify(kr));
  const [row] = await sql`SELECT item_type, stage, on_board, part_of_id, type_fields FROM tasks WHERE id = ${kr.id}`;
  assert.deepEqual([row!.item_type, row!.stage, row!.on_board, row!.part_of_id, row!.type_fields.period, row!.type_fields.current], ["key_result", "active", false, o.id, "2027-Q1", 10]);

  // The assignee checks in; a viewer who isn't the assignee can't.
  viewerId = t.viewer;
  assert.equal((await docs.checkInAction(t.ws, { taskId: kr.id, value: 30, confidence: 7 }) as { error?: string }).error, "Only its owner or people who can edit these goals do this.");
  viewerId = t.member;
  assert.ok((await docs.checkInAction(t.ws, { taskId: kr.id, value: 30, confidence: 7, note: "Halfway" })).success);
  const read = await docs.readGoalsAction(t.ws, "goals-q1");
  assert.ok(read.success);
  const k = read.objectives[0]!.keyResults[0]!;
  assert.deepEqual([k.current, k.confidence, k.progress, k.history.length, read.objectives[0]!.progress, read.label], [30, 7, 50, 1, 50, "Q1 2027"]);
  assert.ok(["on_track", "at_risk", "off_track"].includes(k.status));

  // Set by hand with a reason; the next check-in ends it.
  assert.equal((await docs.setGoalStatusAction(t.ws, { taskId: kr.id, status: "at_risk" }) as { error?: string }).error, "Say why.");
  assert.ok((await docs.setGoalStatusAction(t.ws, { taskId: kr.id, status: "off_track", reason: "Launch slipped" })).success);
  let again = await docs.readGoalsAction(t.ws, "goals-q1");
  assert.ok(again.success);
  assert.deepEqual([again.objectives[0]!.keyResults[0]!.status, again.objectives[0]!.keyResults[0]!.override], ["off_track", { status: "off_track", reason: "Launch slipped" }]);
  assert.ok((await docs.checkInAction(t.ws, { taskId: kr.id, value: 50, confidence: 9 })).success);
  again = await docs.readGoalsAction(t.ws, "goals-q1");
  assert.ok(again.success);
  assert.deepEqual([again.objectives[0]!.keyResults[0]!.progress, again.objectives[0]!.keyResults[0]!.override, again.objectives[0]!.keyResults[0]!.history.length], [100, null, 2]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM key_result_check_ins WHERE task_id = ${kr.id}`)[0]!.n, 2);
  // Objectives and key results never show on the board.
  const board = await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${t.ws} AND on_board AND item_type IN ('objective', 'key_result')`;
  assert.equal(board[0]!.n, 0);
});
