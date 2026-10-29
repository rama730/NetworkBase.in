import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, addMember, createProject, createUser, inRollback, sql, type Tx } from "./_helpers";

after(() => sql.end());

async function org(tx: Tx, ownerId: string) {
  const id = await createProject(tx, ownerId);
  await tx`UPDATE public.projects SET kind = 'organization', org_type = 'education' WHERE id = ${id}`;
  return id;
}

async function child(tx: Tx, ownerId: string, orgId: string, options: { visibility?: string; status?: string } = {}) {
  const id = await createProject(tx, ownerId, options);
  await tx`UPDATE public.projects SET parent_id = ${orgId} WHERE id = ${id}`;
  return id;
}

/** Runs `query` in a savepoint and expects the database to refuse it. */
async function rejects(tx: Tx, query: (sp: Tx) => Promise<unknown>, message: RegExp) {
  await assert.rejects(tx.savepoint((sp) => query(sp as Tx)), message);
}

/** Calls the read-rule functions as `userId` (they read auth.uid() from the JWT claims). */
async function rules(tx: Tx, userId: string, projectId: string) {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  await tx`SELECT set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`;
  const [row] = await tx`
    SELECT app_private.nb_project_can_read(${projectId}) AS read,
           app_private.nb_project_tab_visible(${projectId}, 'files') AS files,
           app_private.nb_project_tab_visible(${projectId}, 'tasks') AS tasks,
           app_private.nb_project_can_write(${projectId}) AS write`;
  await actAsOwner(tx);
  return { ...row };
}

test("two levels only: orgs have no parent, parents are orgs, an org with children stays an org", async () => {
  await inRollback(async (tx) => {
    const owner = await createUser(tx);
    const orgId = await org(tx, owner);
    const plain = await createProject(tx, owner);
    const kid = await child(tx, owner, orgId);
    const other = await createProject(tx, owner);
    const secondOrg = await org(tx, owner);

    await rejects(tx, (sp) => sp`UPDATE public.projects SET parent_id = ${orgId} WHERE id = ${secondOrg}`, /projects_org_has_no_parent/);
    await rejects(tx, (sp) => sp`UPDATE public.projects SET parent_id = ${plain} WHERE id = ${other}`, /project_parent_must_be_org/);
    await rejects(tx, (sp) => sp`UPDATE public.projects SET parent_id = ${kid} WHERE id = ${other}`, /project_parent_must_be_org/);
    await rejects(tx, (sp) => sp`UPDATE public.projects SET kind = 'project' WHERE id = ${orgId}`, /org_has_child_projects/);
    await rejects(tx, (sp) => sp`UPDATE public.projects SET kind = 'team' WHERE id = ${plain}`, /projects_kind_check/);
  });
});

test("Organization and inherited admin read rules match project-access.ts", async () => {
  const result = await inRollback(async (tx) => {
    const [owner, admin, member, guest, outsider, lead] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => createUser(tx)));
    const orgId = await org(tx, owner!);
    await addMember(tx, orgId, admin!, "admin");
    await addMember(tx, orgId, member!, "member");
    await addMember(tx, orgId, guest!, "viewer");
    const orgOnly = await child(tx, lead!, orgId, { visibility: "org" });
    const privateDraft = await child(tx, lead!, orgId, { visibility: "private", status: "draft" });

    const out: Record<string, unknown> = {};
    for (const [name, id] of Object.entries({ owner, admin, member, guest, outsider, lead })) {
      out[`orgOnly.${name}`] = await rules(tx, id!, orgOnly);
      out[`privateDraft.${name}`] = await rules(tx, id!, privateDraft);
    }
    await actAs(tx, member!);
    out.rlsMember = (await tx`SELECT count(*)::int AS n FROM public.projects WHERE id IN (${orgOnly}, ${privateDraft})`)[0]!.n;
    await actAs(tx, null);
    out.rlsAnon = (await tx`SELECT count(*)::int AS n FROM public.projects WHERE id IN (${orgOnly}, ${privateDraft})`)[0]!.n;
    await actAsOwner(tx);
    return out;
  });
  const all = { read: true, files: true, tasks: true, write: true };
  const none = { read: false, files: false, tasks: false, write: false };
  assert.deepEqual(result["orgOnly.owner"], all);
  assert.deepEqual(result["orgOnly.admin"], all, "inherited admin");
  assert.deepEqual(result["orgOnly.member"], { read: true, files: true, tasks: false, write: false });
  assert.deepEqual(result["orgOnly.guest"], { read: true, files: true, tasks: false, write: false });
  assert.deepEqual(result["orgOnly.outsider"], none);
  assert.deepEqual(result["orgOnly.lead"], all);
  assert.deepEqual(result["privateDraft.admin"], all, "inherited admin sees private drafts");
  assert.deepEqual(result["privateDraft.member"], none);
  assert.deepEqual(result["privateDraft.guest"], none);
  assert.equal(result.rlsMember, 1);
  assert.equal(result.rlsAnon, 0);
});

test("org tables hold no browser access (invite emails stay server-side)", async () => {
  await inRollback(async (tx) => {
    const owner = await createUser(tx);
    await actAs(tx, owner);
    for (const table of ["org_join_blocks", "org_email_invites", "org_handle_holds"]) {
      await rejects(tx, (sp) => sp.unsafe(`SELECT 1 FROM public.${table}`), /permission denied/);
    }
    await actAsOwner(tx);
  });
});
