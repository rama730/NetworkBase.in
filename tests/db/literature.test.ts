import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.8b (report 30.6 W5): the literature list — insiders read, editors add; duplicates skipped; the last supervision and outputs on the thesis.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.177" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let doc: typeof import("../../src/app/actions/workspace/doc");
let lit: typeof import("../../src/app/actions/literature");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  doc = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  lit = await loadAppModule(() => import("../../src/app/actions/literature"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("literature: editors add (duplicates by DOI or title skipped), viewers and outsiders can't write, outsiders can't read", async () => {
  const [student, viewer, stranger] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, student!, { visibility: "private" }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${student!}, 'owner'), (${ws}, ${viewer!}, 'viewer')`;
  viewerId = student!;
  const first = await lit.addSourcesAction(ws, [{ title: "Graph networks for traffic", authors: "Rao, A.", year: 2020, doi: "10.1/ABC", keyIssues: ["traffic", "graphs"] }, { title: "Sensors" }]);
  assert.deepEqual(first, { success: true, added: 2, skipped: 0 });
  const again = await lit.addSourcesAction(ws, [{ title: "Another title", doi: "10.1/abc" }, { title: "sensors!" }, { title: "New one" }]);
  assert.deepEqual(again, { success: true, added: 1, skipped: 2 }, "Already in the list");
  assert.match((await lit.addSourcesAction(ws, [{ title: "Bad", link: "javascript:alert(1)" }]) as { error?: string }).error ?? "", /https/);
  const r = await lit.readLiteratureAction(ws);
  assert.ok(r.success && r.rows.length === 3);
  assert.deepEqual(r.rows.find((x) => x.doi === "10.1/ABC")!.keyIssues, ["traffic", "graphs"]);
  viewerId = viewer!;
  assert.equal((await lit.readLiteratureAction(ws)).success, true);
  assert.equal((await lit.addSourcesAction(ws, [{ title: "From a viewer" }])).success, false, "viewers read, never write");
  viewerId = stranger!;
  assert.equal((await lit.readLiteratureAction(ws)).success, false, "outsiders read nothing");
  assert.equal((await lit.deleteSourceAction(ws, r.rows[0]!.id)).success, false);
});

test("the thesis shows the last Supervision meeting with its open action items, and outputs labelled Publication or Talk", async () => {
  const student = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, student, { visibility: "private" }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${student}, 'owner')`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'thesis', ${student}), (${ws}, 'meetings', ${student})`;
  const [m] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${ws}, 'sup-1', 'sup-1.md', ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true, section: "meetings", kind: "supervision", date: "2026-11-02" } as never)}) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, source_doc_id) VALUES (${ws}, 'Fix chapter 2', 'todo', 'medium', ${student}, 'task', ${m!.id}), (${ws}, 'Done thing', 'done', 'medium', ${student}, 'task', ${m!.id})`;
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, labels) VALUES (${ws}, 'IEEE ITS paper', 'in_progress', 'medium', ${student}, 'task', ARRAY['Publication']), (${ws}, 'Lab talk', 'done', 'medium', ${student}, 'task', ARRAY['talk'])`;
  viewerId = student;
  const r = await doc.readThesisAction(ws);
  assert.ok(r.success);
  assert.deepEqual(r.thesis.lastSupervision, { date: "2026-11-02", slug: "sup-1", openItems: 1 });
  assert.deepEqual(r.thesis.outputs.map((o) => [o.title, o.kind, o.state]).sort(), [["IEEE ITS paper", "Publication", "In progress"], ["Lab talk", "Talk", "Completed"]]);
});
