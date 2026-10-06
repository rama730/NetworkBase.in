import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createProject, createUser, inRollback, sql } from "./_helpers";

after(() => sql.end());

// DB-005: derived values follow clears and moves.
test("clearing a profile field removes it from Auth metadata and keeps other keys", async () => {
  const meta = await inRollback(async (tx) => {
    const id = await createUser(tx);
    await tx`UPDATE auth.users SET raw_user_meta_data = '{"provider_extra": "keep"}'::jsonb WHERE id = ${id}`;
    await tx`UPDATE public.profiles SET avatar_url = 'https://x.test/a.png', full_name = 'Ada' WHERE id = ${id}`;
    await tx`UPDATE public.profiles SET avatar_url = NULL WHERE id = ${id}`;
    const [row] = await tx`SELECT raw_user_meta_data AS m FROM auth.users WHERE id = ${id}`;
    return row!.m as Record<string, unknown>;
  });
  assert.equal("avatar_url" in meta, false);
  assert.equal(meta.full_name, "Ada");
  assert.equal(meta.provider_extra, "keep");
});

test("moving an open role recounts both projects", async () => {
  const counts = await inRollback(async (tx) => {
    const owner = await createUser(tx);
    const a = await createProject(tx, owner);
    const b = await createProject(tx, owner);
    const [role] = await tx`INSERT INTO public.project_open_roles (project_id, role, count) VALUES (${a}, 'dev', 1) RETURNING id`;
    await tx`UPDATE public.project_open_roles SET project_id = ${b} WHERE id = ${role!.id}`;
    const rows = await tx`SELECT id, open_roles_count FROM public.projects WHERE id IN (${a}, ${b})`;
    return Object.fromEntries(rows.map((r) => [r.id === a ? "a" : "b", r.open_roles_count]));
  });
  assert.deepEqual(counts, { a: 0, b: 1 });
});
