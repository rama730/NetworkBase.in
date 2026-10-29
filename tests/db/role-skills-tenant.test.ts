import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

after(async () => { await sql.end(); await closeAppDb(); });

// COR-001: an owner of project A supplying project B's role id must not touch B.
test("syncRoleSkills refuses a role from another project before writing", async () => {
  const { db } = await loadAppModule(() => import("../../src/lib/db"));
  const { syncRoleSkills } = await loadAppModule(() => import("../../src/lib/skills/service"));
  const marker = randomUUID();
  const ids = await sql.begin(async (tx) => {
    const ownerA = await createUser(tx);
    const ownerB = await createUser(tx);
    const projectA = await createProject(tx, ownerA);
    const projectB = await createProject(tx, ownerB);
    const [roleB] = await tx`INSERT INTO public.project_open_roles (project_id, role, count) VALUES (${projectB}, ${"dev-" + marker}, 1) RETURNING id`;
    return { ownerA, projectA, roleB: roleB!.id as string };
  });
  try {
    const before = await sql`SELECT skill_id FROM public.role_skills WHERE role_id = ${ids.roleB} ORDER BY skill_id`;
    await assert.rejects(
      db.transaction((tx) => syncRoleSkills(tx, ids.projectA, ids.roleB, ["Rust"], ids.ownerA)),
      /Role not found in this workspace/,
    );
    const afterRows = await sql`SELECT skill_id FROM public.role_skills WHERE role_id = ${ids.roleB} ORDER BY skill_id`;
    assert.deepEqual(afterRows, before);
  } finally {
    await sql`DELETE FROM public.projects WHERE id IN (SELECT project_id FROM public.project_open_roles WHERE id = ${ids.roleB}) OR id = ${ids.projectA}`;
  }
});
