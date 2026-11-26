import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createUser, inRollback, sql } from "./_helpers";

after(() => sql.end());

// Global search mix (0165): who can find me, saved searches, the query log behind "Trending near you".
test("a new person can be found by everyone, and not by email", async () => {
  await inRollback(async (tx) => {
    const id = await createUser(tx);
    const [row] = await tx`SELECT search_visibility, findable_by_email FROM public.profiles WHERE id = ${id}`;
    assert.equal(row!.search_visibility, "everyone");
    assert.equal(row!.findable_by_email, false);
    await assert.rejects(tx`UPDATE public.profiles SET search_visibility = 'nobody' WHERE id = ${id}`);
  });
});

test("a saved search alerts weekly unless told otherwise", async () => {
  await inRollback(async (tx) => {
    const id = await createUser(tx);
    const [row] = await tx`INSERT INTO public.saved_searches (user_id, query, tab) VALUES (${id}, 'react', 'discover') RETURNING notify`;
    assert.equal(row!.notify, "weekly");
    await assert.rejects(tx`INSERT INTO public.saved_searches (user_id, query, tab, notify) VALUES (${id}, 'vue', 'discover', 'hourly')`);
  });
});

test("the same search can't be saved twice", async () => {
  await inRollback(async (tx) => {
    const id = await createUser(tx);
    await tx`INSERT INTO public.saved_searches (user_id, query, tab) VALUES (${id}, 'React', 'people')`;
    await assert.rejects(tx`INSERT INTO public.saved_searches (user_id, query, tab) VALUES (${id}, 'react', 'people')`);
  });
});

test("the browser roles can't read saved searches or the query log", async () => {
  const rows = await sql`SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE grantee IN ('anon', 'authenticated') AND table_name IN ('saved_searches', 'search_query_log')`;
  assert.deepEqual([...rows], []);
  const rls = await sql`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('saved_searches', 'search_query_log') ORDER BY relname`;
  assert.deepEqual(rls.map((r) => [r.relname, r.relrowsecurity]), [["saved_searches", true], ["search_query_log", true]]);
});
