import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.8a (report 30.6 W5): the thesis — chapters with words counted from their text, questions, supervisor, next milestone; insiders only.
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
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  doc = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function chapter(ws: string, slug: string, content: string, number: number, target: number) {
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${ws}, ${slug}, ${slug + ".md"}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true, section: "chapters", chapter: { number, target, status: "in_progress" } } as never)}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${ws}, ${d!.id}, 1, ${content}, ${slug}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
}

test("the thesis: chapters count their own words, research questions save, a supervisor must be staff, outsiders see nothing", async () => {
  const [student, supervisor, stranger] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, student!, { visibility: "private" }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${student!}, 'owner'), (${ws}, ${supervisor!}, 'admin')`;
  viewerId = student!;
  assert.equal((await doc.readThesisAction(ws)).success, false, "only with Thesis added");
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'thesis', ${student!})`;
  await chapter(ws, "method", "# 3. Method\n\nWe train a graph network.\n\n```\ncode here\n```\n", 3, 100);
  await chapter(ws, "intro", "# 1. Introduction\n\nTraffic is hard to predict.\n\n## References\n\nSmith 2020.", 1, 10);
  const r = await doc.readThesisAction(ws);
  assert.ok(r.success);
  assert.deepEqual(r.thesis.chapters.map((c) => [c.number, c.title, c.words]), [[1, "Introduction", 7], [3, "Method", 7]]);
  assert.deepEqual([r.thesis.words, r.thesis.target], [14, 110]);
  assert.equal((await doc.saveThesisAction(ws, { questions: ["Can GNNs beat ARIMA?", " "] })).success, true);
  assert.match((await doc.saveThesisAction(ws, { supervisorId: stranger! }) as { error?: string }).error ?? "", /admins or its class/);
  assert.equal((await doc.saveThesisAction(ws, { supervisorId: supervisor! })).success, true);
  const again = await doc.readThesisAction(ws);
  assert.ok(again.success && again.thesis.questions.length === 1 && again.thesis.supervisor);
  viewerId = stranger!;
  assert.equal((await doc.readThesisAction(ws)).success, false, "thesis text stays with insiders");
  assert.equal((await doc.saveThesisAction(ws, { questions: ["hijack"] })).success, false);
});
