import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, createProject, createUser, grantBrowserRead, inRollback, projectWithPeople, sql, type Tx } from "./_helpers";

after(() => sql.end());

async function node(tx: Tx, projectId: string, path: string, opts: { taskId?: string | null; deleted?: boolean } = {}) {
  const [row] = await tx`
    INSERT INTO public.workspace_nodes (workspace_id, type, name, path, task_id, deleted_at)
    VALUES (${projectId}, 'file', ${path.split("/").pop()!}, ${path}, ${opts.taskId ?? null}, ${opts.deleted ? new Date() : null})
    RETURNING id`;
  await tx`INSERT INTO public.file_versions (node_id, version, s3_key, size, mime_type) VALUES (${row!.id}, 1, ${`${projectId}/${row!.id}`}, 1, 'text/plain')`;
  await tx`INSERT INTO public.workspace_file_index (node_id, workspace_id, content) VALUES (${row!.id}, ${projectId}, 'secret words')`;
  return row!.id as string;
}

async function visibleCounts(tx: Tx, viewer: string | null, projectId: string) {
  await actAs(tx, viewer);
  const [row] = await tx`
    SELECT
      (SELECT count(*)::int FROM public.workspace_nodes WHERE workspace_id = ${projectId}) AS nodes,
      (SELECT count(*)::int FROM public.file_versions v JOIN public.workspace_nodes n ON n.id = v.node_id WHERE n.workspace_id = ${projectId}) AS versions,
      (SELECT count(*)::int FROM public.workspace_file_index WHERE workspace_id = ${projectId}) AS "fileIndex"`;
  await actAsOwner(tx);
  return { ...row };
}

// RLS-001 / RLS-003: obsolete permissive policies and the file index must not
// widen node visibility beyond nb_project_node_can_read.
test("outsiders see only public project content files; trash, task files, drafts and hidden Files stay hidden", async () => {
  const result = await inRollback(async (tx) => {
    await grantBrowserRead(tx, ["workspace_nodes", "file_versions", "workspace_file_index"]);
    const { owner, outsider, projectId } = await projectWithPeople(tx);
    const [task] = await tx`INSERT INTO public.tasks (workspace_id, title) VALUES (${projectId}, 't') RETURNING id`;
    await node(tx, projectId, "/readme.md");
    await node(tx, projectId, "/old.md", { deleted: true });
    await node(tx, projectId, "/.system/tasks/x/notes.md");
    await node(tx, projectId, "/task.md", { taskId: task!.id });
    const draft = await createProject(tx, owner, { status: "draft" });
    await node(tx, draft, "/draft.md");
    const hiddenFiles = await createProject(tx, owner, { publicTabVisibility: { files: false } });
    await node(tx, hiddenFiles, "/hidden.md");
    return {
      outsider: await visibleCounts(tx, outsider, projectId),
      anon: await visibleCounts(tx, null, projectId),
      owner: await visibleCounts(tx, owner, projectId),
      draft: await visibleCounts(tx, outsider, draft),
      hiddenFiles: await visibleCounts(tx, null, hiddenFiles),
    };
  });
  assert.deepEqual(result.outsider, { nodes: 1, versions: 1, fileIndex: 1 });
  assert.deepEqual(result.anon, { nodes: 1, versions: 1, fileIndex: 1 });
  assert.deepEqual(result.owner, { nodes: 3, versions: 3, fileIndex: 3 }, "owners see task and system files; trash is not served by RLS");
  assert.deepEqual(result.draft, { nodes: 0, versions: 0, fileIndex: 0 });
  assert.deepEqual(result.hiddenFiles, { nodes: 0, versions: 0, fileIndex: 0 });
});

// RLS-002: only the exact published, non-deleted version of a publicly
// visible doc is readable by outsiders; overrides apply.
test("doc versions: outsiders read only the published version; overrides and drafts apply", async () => {
  const result = await inRollback(async (tx) => {
    await grantBrowserRead(tx, ["workspace_documents", "workspace_document_versions"]);
    const { owner, member, outsider, projectId } = await projectWithPeople(tx);
    async function doc(project: string, slug: string, override: string) {
      const [d] = await tx`INSERT INTO public.workspace_documents (workspace_id, slug, filename, settings)
        VALUES (${project}, ${slug}, ${slug + ".md"}, ${tx.json({ version: 1, editPolicy: "leaders", visibilityOverride: override })}) RETURNING id`;
      const versions = [];
      for (const n of [1, 2]) {
        const [v] = await tx`INSERT INTO public.workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash)
          VALUES (${project}, ${d!.id}, ${n}, ${"v" + n}, ${"h" + n}) RETURNING id`;
        versions.push(v!.id);
      }
      await tx`UPDATE public.workspace_documents SET published_version_id = ${versions[0]!} WHERE id = ${d!.id}`;
      return d!.id as string;
    }
    await doc(projectId, "readme", "inherit_project");
    await doc(projectId, "team", "members_only");
    await doc(projectId, "leads", "leaders_only");
    const draft = await createProject(tx, owner, { status: "draft" });
    await doc(draft, "readme", "public");
    const count = async (viewer: string | null, project: string) => {
      await actAs(tx, viewer);
      const [row] = await tx`SELECT
        (SELECT count(*)::int FROM public.workspace_documents WHERE workspace_id = ${project}) AS docs,
        (SELECT count(*)::int FROM public.workspace_document_versions WHERE workspace_id = ${project}) AS versions`;
      await actAsOwner(tx);
      return { ...row };
    };
    return {
      outsider: await count(outsider, projectId),
      member: await count(member, projectId),
      owner: await count(owner, projectId),
      draftOutsider: await count(outsider, draft),
    };
  });
  assert.deepEqual(result.outsider, { docs: 1, versions: 1 }, "published readme only");
  assert.deepEqual(result.member, { docs: 2, versions: 4 }, "members: not leaders_only docs, with history");
  assert.deepEqual(result.owner, { docs: 3, versions: 6 });
  assert.deepEqual(result.draftOutsider, { docs: 0, versions: 0 });
});

// RLS-004: connection state changes are server-owned commands.
test("browser roles cannot create, accept or rewrite connections", async () => {
  const outcomes = await inRollback(async (tx) => {
    const requester = await createUser(tx);
    const addressee = await createUser(tx);
    const other = await createUser(tx);
    const [pending] = await tx`INSERT INTO public.connections (requester_id, addressee_id) VALUES (${requester}, ${addressee}) RETURNING id`;
    const attempt = async (viewer: string, statement: (t: Tx) => Promise<unknown>) => {
      await tx`SAVEPOINT attempt`;
      try {
        await actAs(tx, viewer);
        const rows = (await statement(tx)) as unknown[];
        await actAsOwner(tx);
        await tx`RELEASE SAVEPOINT attempt`;
        return Array.isArray(rows) && rows.length === 0 ? "no rows" : "allowed";
      } catch {
        await tx`ROLLBACK TO SAVEPOINT attempt`;
        await actAsOwner(tx);
        return "denied";
      }
    };
    return {
      insertAccepted: await attempt(requester, (t) => t`INSERT INTO public.connections (requester_id, addressee_id, status) VALUES (${requester}, ${other}, 'accepted') RETURNING id`),
      selfAccept: await attempt(requester, (t) => t`UPDATE public.connections SET status = 'accepted' WHERE id = ${pending!.id} RETURNING id`),
      rewritePeer: await attempt(requester, (t) => t`UPDATE public.connections SET addressee_id = ${other} WHERE id = ${pending!.id} RETURNING id`),
      participantsRead: await (async () => {
        await actAs(tx, addressee);
        const rows = await tx`SELECT id FROM public.connections WHERE id = ${pending!.id}`;
        await actAsOwner(tx);
        return rows.length;
      })(),
    };
  });
  assert.equal(outcomes.insertAccepted, "denied");
  assert.notEqual(outcomes.selfAccept, "allowed");
  assert.notEqual(outcomes.rewritePeer, "allowed");
  assert.equal(outcomes.participantsRead, 1);
});
