import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, createProject, createUser, grantBrowserRead, inRollback, projectWithPeople, sql, type Tx } from "./_helpers";

after(() => sql.end());

async function seed(tx: Tx, projectId: string, authorId: string) {
  const [task] = await tx`INSERT INTO public.tasks (project_id, title) VALUES (${projectId}, 't') RETURNING id`;
  await tx`INSERT INTO public.task_subtasks (task_id, title) VALUES (${task!.id}, 's')`;
  const [live] = await tx`INSERT INTO public.project_updates (project_id, author_id, content) VALUES (${projectId}, ${authorId}, 'live') RETURNING id`;
  const [gone] = await tx`INSERT INTO public.project_updates (project_id, author_id, content, deleted_at) VALUES (${projectId}, ${authorId}, 'gone', now()) RETURNING id`;
  await tx`INSERT INTO public.project_update_comments (update_id, project_id, user_id, content) VALUES (${live!.id}, ${projectId}, ${authorId}, 'c1'), (${gone!.id}, ${projectId}, ${authorId}, 'c2')`;
}

async function counts(tx: Tx, viewer: string | null, projectId: string) {
  await actAs(tx, viewer);
  const [row] = await tx`SELECT
    (SELECT count(*)::int FROM public.projects WHERE id = ${projectId}) AS projects,
    (SELECT count(*)::int FROM public.tasks WHERE project_id = ${projectId}) AS tasks,
    (SELECT count(*)::int FROM public.task_subtasks s JOIN public.tasks t ON t.id = s.task_id WHERE t.project_id = ${projectId}) AS subtasks,
    (SELECT count(*)::int FROM public.project_updates WHERE project_id = ${projectId}) AS updates,
    (SELECT count(*)::int FROM public.project_update_comments WHERE project_id = ${projectId}) AS comments`;
  await actAsOwner(tx);
  return { ...row };
}

test("RLS-007/RLS-010: drafts, hidden tabs and deleted updates are not readable by outsiders", async () => {
  const r = await inRollback(async (tx) => {
    const { owner, member, outsider, projectId } = await projectWithPeople(tx, { publicTabVisibility: { tasks: true } });
    await seed(tx, projectId, owner);
    const draft = await createProject(tx, owner, { status: "draft", publicTabVisibility: { tasks: true } });
    await seed(tx, draft, owner);
    const hidden = await createProject(tx, owner, { publicTabVisibility: { tasks: false, updates: false } });
    await seed(tx, hidden, owner);
    return {
      outsider: await counts(tx, outsider, projectId),
      anon: await counts(tx, null, projectId),
      member: await counts(tx, member, projectId),
      draft: await counts(tx, outsider, draft),
      draftOwner: await counts(tx, owner, draft),
      hidden: await counts(tx, outsider, hidden),
      hiddenMember: await counts(tx, owner, hidden),
    };
  });
  const visible = { projects: 1, tasks: 1, subtasks: 1, updates: 1, comments: 1 };
  assert.deepEqual(r.outsider, visible, "public project: deleted update and its comments hidden");
  assert.deepEqual(r.anon, visible);
  assert.deepEqual(r.member, { ...visible, updates: 1, comments: 1 });
  assert.deepEqual(r.draft, { projects: 0, tasks: 0, subtasks: 0, updates: 0, comments: 0 });
  assert.deepEqual(r.draftOwner, { ...visible, updates: 2, comments: 2 }, "the author still sees own deleted update");
  assert.deepEqual(r.hidden, { projects: 1, tasks: 0, subtasks: 0, updates: 0, comments: 0 });
  assert.deepEqual(r.hiddenMember, { ...visible, updates: 2, comments: 2 });
});
