import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAsOwner, createUser, grantBrowserRead, inRollback, sql } from "./_helpers";

after(() => sql.end());

// SQL-001: current PostgREST sets only the JSON `request.jwt.claims`. Policies
// must resolve the caller through native auth.uid(), which reads it.
test("owners read their private contributions with JSON-only JWT claims", async () => {
  const counts = await inRollback(async (tx) => {
    await grantBrowserRead(tx, ["profile_project_contributions", "profile_project_contribution_stages", "profile_contribution_skills", "profile_collaboration_summaries"]);
    const owner = await createUser(tx, { visibility: "private" });
    await tx`INSERT INTO public.profile_project_contributions (profile_id, external_key, project_title, visibility, source)
             VALUES (${owner}, 'ext:1', 'Side project', 'private', 'manual')`;
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true), set_config('request.jwt.claim.sub', '', true)`;
    const [row] = await tx`SELECT count(*)::int AS n FROM public.profile_project_contributions WHERE profile_id = ${owner}`;
    await actAsOwner(tx);
    return row!.n as number;
  });
  assert.equal(counts, 1);
});

test("no app policy or function depends on the retired get_auth_uid helper", async () => {
  const [row] = await sql`SELECT to_regprocedure('app_private.get_auth_uid()') AS helper, to_regprocedure('public.get_auth_uid()') AS legacy`;
  assert.deepEqual({ ...row }, { helper: null, legacy: null });
});
