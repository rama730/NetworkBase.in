import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, createProject, createUser, grantBrowserRead, inRollback, projectWithPeople, sql } from "./_helpers";

after(() => sql.end());

// Replaces scripts/check-ponytail-database-hardening.ts (OPS-004): same RLS
// assertion, but on its own fixtures in a disposable database, always rolled back.
test("a member of one project cannot read another private project's rows", async () => {
  const visible = await inRollback(async (tx) => {
    await grantBrowserRead(tx, ["workspace_nodes", "workspace_file_index", "workspace_node_events"]);
    const { member } = await projectWithPeople(tx);
    const otherOwner = await createUser(tx);
    const denied = await createProject(tx, otherOwner, { visibility: "private" });
    await tx`INSERT INTO public.workspace_nodes (workspace_id, type, name, path) VALUES (${denied}, 'file', 'secret.txt', '/secret.txt')`;
    await tx`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (${denied}, ${otherOwner}, 'admin')`;
    await actAs(tx, member);
    const [row] = await tx`
      SELECT
        (SELECT count(*)::int FROM public.workspace_nodes WHERE workspace_id = ${denied}) AS nodes,
        (SELECT count(*)::int FROM public.workspace_file_index WHERE workspace_id = ${denied}) AS "fileIndex",
        (SELECT count(*)::int FROM public.workspace_node_events WHERE workspace_id = ${denied}) AS events,
        (SELECT count(*)::int FROM public.workspace_members WHERE workspace_id = ${denied}) AS members,
        (SELECT count(*)::int FROM public.workspaces WHERE id = ${denied}) AS projects`;
    await actAsOwner(tx);
    // Positive control: the fixture is real, its own owner sees it.
    await actAs(tx, otherOwner);
    const [own] = await tx`SELECT (SELECT count(*)::int FROM public.workspace_nodes WHERE workspace_id = ${denied}) AS nodes`;
    return { ...row, ownerNodes: own.nodes };
  });
  assert.deepEqual(visible, { nodes: 0, fileIndex: 0, events: 0, members: 0, projects: 0, ownerNodes: 1 });
});
