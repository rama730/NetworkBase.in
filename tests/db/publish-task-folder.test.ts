import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let mutations: typeof import("../../src/app/actions/files/mutations");
before(async () => {
  mutations = await loadAppModule(() => import("../../src/app/actions/files/mutations"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// COR-012: publishing a nested task folder moves every descendant out of the task system tree.
test("publishing a task folder rewrites all descendant paths and releases their task scope", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  viewerId = owner;
  try {
    const projectId = await sql.begin((tx) => createProject(tx, owner));
    const [task] = await sql`INSERT INTO tasks (project_id, title) VALUES (${projectId}, 't') RETURNING id`;
    const taskId = task!.id as string;
    const node = async (type: string, name: string, path: string, parentId: string | null) => {
      const [row] = await sql`INSERT INTO project_nodes (project_id, task_id, type, name, path, parent_id) VALUES (${projectId}, ${taskId}, ${type}, ${name}, ${path}, ${parentId}) RETURNING id`;
      return row!.id as string;
    };
    const root = `/.system/tasks/${taskId}`;
    const taskRoot = await node("folder", taskId, root, null);
    const folder = await node("folder", "report", `${root}/report`, taskRoot);
    const sub = await node("folder", "charts", `${root}/report/charts`, folder);
    const file = await node("file", "a.png", `${root}/report/charts/a.png`, sub);
    const top = await node("file", "summary.md", `${root}/report/summary.md`, folder);

    const result = await mutations.moveWorkspaceNodes([folder], null, projectId, { mode: "publish" });
    assert.ok(result.nodes.length === 1, JSON.stringify(result));

    const rows = await sql`SELECT id, path, task_id FROM project_nodes WHERE project_id = ${projectId} ORDER BY path`;
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    assert.equal(byId.get(folder)!.path, "/report");
    assert.equal(byId.get(sub)!.path, "/report/charts");
    assert.equal(byId.get(file)!.path, "/report/charts/a.png");
    assert.equal(byId.get(top)!.path, "/report/summary.md");
    for (const id of [folder, sub, file, top]) assert.equal(byId.get(id)!.task_id, null, "no published node keeps the task scope");
    assert.equal(rows.filter((r) => String(r.path).startsWith("/.system") && r.id !== taskRoot).length, 0);
  } finally {
    await sql`DELETE FROM project_nodes WHERE project_id IN (SELECT id FROM projects WHERE owner_id = ${owner})`;
    await sql`DELETE FROM projects WHERE owner_id = ${owner}`;
  }
});
