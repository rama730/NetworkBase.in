import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createProject, createUser, inRollback, sql, type Tx } from "./_helpers";

after(() => sql.end());

const fails = async (tx: Tx, statement: () => Promise<unknown>) => {
  await tx`SAVEPOINT edge`;
  try { await statement(); await tx`RELEASE SAVEPOINT edge`; return false; }
  catch { await tx`ROLLBACK TO SAVEPOINT edge`; return true; }
};

// DB-001: every graph edge stays inside one project (or doc / update).
test("cross-project parent, canonical, task, sprint, doc and reply edges are rejected", async () => {
  const outcome = await inRollback(async (tx) => {
    const owner = await createUser(tx);
    const a = await createProject(tx, owner);
    const b = await createProject(tx, owner);
    const node = async (project: string, path: string) =>
      (await tx`INSERT INTO public.workspace_nodes (workspace_id, type, name, path) VALUES (${project}, 'folder', ${path.slice(1)}, ${path}) RETURNING id`)[0]!.id as string;
    const nodeA = await node(a, "/a");
    const nodeB = await node(b, "/b");
    const [taskB] = await tx`INSERT INTO public.tasks (workspace_id, title) VALUES (${b}, 'tb') RETURNING id`;
    const [taskA] = await tx`INSERT INTO public.tasks (workspace_id, title) VALUES (${a}, 'ta') RETURNING id`;
    const [sprintB] = await tx`INSERT INTO public.workspace_sprints (workspace_id, name, start_date, end_date) VALUES (${b}, 'sb', now(), now() + interval '7 days') RETURNING id`;
    const [docB] = await tx`INSERT INTO public.workspace_documents (workspace_id, slug) VALUES (${b}, 'readme') RETURNING id`;
    const [docA] = await tx`INSERT INTO public.workspace_documents (workspace_id, slug) VALUES (${a}, 'readme') RETURNING id`;
    const [versionB] = await tx`INSERT INTO public.workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${b}, ${docB!.id}, 1, 'x', 'h') RETURNING id`;
    const [updA] = await tx`INSERT INTO public.workspace_updates (workspace_id, author_id, content) VALUES (${a}, ${owner}, 'u') RETURNING id`;
    const [updA2] = await tx`INSERT INTO public.workspace_updates (workspace_id, author_id, content) VALUES (${a}, ${owner}, 'u2') RETURNING id`;
    const [comment] = await tx`INSERT INTO public.workspace_update_comments (update_id, workspace_id, user_id, content) VALUES (${updA2!.id}, ${a}, ${owner}, 'c') RETURNING id`;
    return {
      parent: await fails(tx, () => tx`INSERT INTO public.workspace_nodes (workspace_id, parent_id, type, name, path) VALUES (${a}, ${nodeB}, 'file', 'x', '/b/x')`),
      canonical: await fails(tx, () => tx`UPDATE public.workspace_nodes SET canonical_node_id = ${nodeB} WHERE id = ${nodeA}`),
      nodeTask: await fails(tx, () => tx`UPDATE public.workspace_nodes SET task_id = ${taskB!.id} WHERE id = ${nodeA}`),
      link: await fails(tx, () => tx`INSERT INTO public.task_node_links (task_id, node_id) VALUES (${taskA!.id}, ${nodeB})`),
      sprint: await fails(tx, () => tx`UPDATE public.tasks SET sprint_id = ${sprintB!.id} WHERE id = ${taskA!.id}`),
      docNode: await fails(tx, () => tx`UPDATE public.workspace_documents SET linked_node_id = ${nodeB} WHERE id = ${docA!.id}`),
      docVersion: await fails(tx, () => tx`UPDATE public.workspace_documents SET published_version_id = ${versionB!.id} WHERE id = ${docA!.id}`),
      reply: await fails(tx, () => tx`INSERT INTO public.workspace_update_comments (update_id, workspace_id, user_id, content, parent_id) VALUES (${updA!.id}, ${a}, ${owner}, 'r', ${comment!.id})`),
      sameProjectOk: !(await fails(tx, () => tx`INSERT INTO public.workspace_nodes (workspace_id, parent_id, type, name, path) VALUES (${a}, ${nodeA}, 'file', 'y', '/a/y')`)),
      setNullKeepsProject: await (async () => {
        await tx`UPDATE public.tasks SET sprint_id = NULL WHERE id = ${taskA!.id}`;
        const [s] = await tx`INSERT INTO public.workspace_sprints (workspace_id, name, start_date, end_date) VALUES (${a}, 'sa', now(), now() + interval '7 days') RETURNING id`;
        await tx`UPDATE public.tasks SET sprint_id = ${s!.id} WHERE id = ${taskA!.id}`;
        await tx`DELETE FROM public.workspace_sprints WHERE id = ${s!.id}`;
        const [t] = await tx`SELECT workspace_id AS project_id, sprint_id FROM public.tasks WHERE id = ${taskA!.id}`;
        return t!.project_id === a && t!.sprint_id === null;
      })(),
    };
  });
  assert.deepEqual(outcome, {
    parent: true, canonical: true, nodeTask: true, link: true, sprint: true, docNode: true, docVersion: true, reply: true,
    sameProjectOk: true, setNullKeepsProject: true,
  });
});
