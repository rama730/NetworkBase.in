import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Live-fix phase 1 (problem 1): the Tasks tab's first reads are started on the server in one go, so the board doesn't
// wait for six browser calls queued one after another.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.160" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let boot: typeof import("../../src/lib/workspaces/server/tasks-boot");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  boot = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks-boot"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("one boot read gives the board its first tasks page, columns, completion policy and teams", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const project = await sql.begin((tx) => createProject(tx, owner));
  created.push(project);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${project}, ${owner}, 'owner')`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id) VALUES (${project}, 'Write the parser', ${owner})`;
  viewerId = owner;
  const started = boot.startTasksBoot(project);
  const [tasks, workflow, policy, units] = await Promise.all([started.tasks, started.workflow, started.policy, started.units]);
  assert.ok(tasks.success, JSON.stringify(tasks));
  assert.deepEqual(tasks.success ? tasks.tasks.map((t: { title: string }) => t.title) : [], ["Write the parser"]);
  assert.ok(workflow.success && (workflow.columns?.length ?? 0) > 0, JSON.stringify(workflow));
  assert.ok(policy.success, JSON.stringify(policy));
  assert.ok(Array.isArray(units));
});
