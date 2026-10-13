import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

let suggestions: typeof import("../../src/lib/connections/suggestions");
before(async () => {
  suggestions = await loadAppModule(() => import("../../src/lib/connections/suggestions"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// COR-021: overlapping computations for one person never interleave, and a failure keeps the old set.
test("concurrent replacements leave exactly one complete set; a failed replacement changes nothing", async () => {
  const ids: string[] = [];
  const make = async () => { const id = await sql.begin((tx) => createUser(tx)); ids.push(id); return id; };
  try {
    const viewer = await make();
    const candidates = await Promise.all(Array.from({ length: 8 }, make));
    const row = (suggestedUserId: string, score: number) => ({ userId: viewer, suggestedUserId, mutualConnectionsCount: 1, score, reason: "r", updatedAt: new Date() });
    const setA = candidates.slice(0, 4).map((id) => row(id, 10));
    const setB = candidates.slice(4).map((id) => row(id, 20));

    await Promise.all(Array.from({ length: 6 }, (_, i) => suggestions.replaceSuggestions(viewer, i % 2 ? setA : setB)));
    const finalSet = (await sql`SELECT suggested_user_id FROM connection_suggestions WHERE user_id = ${viewer} ORDER BY 1`).map((r) => r.suggested_user_id as string);
    const expected = (rows: typeof setA) => rows.map((r) => r.suggestedUserId).sort();
    assert.ok(
      JSON.stringify(finalSet) === JSON.stringify(expected(setA)) || JSON.stringify(finalSet) === JSON.stringify(expected(setB)),
      `final set is exactly one computation's result, got ${finalSet.length} rows`,
    );

    // A failing insert (unknown candidate) rolls the whole replacement back.
    const before = JSON.stringify(finalSet);
    await assert.rejects(suggestions.replaceSuggestions(viewer, [row(candidates[0]!, 5), row("00000000-0000-4000-8000-000000000000", 5)]));
    const afterSet = (await sql`SELECT suggested_user_id FROM connection_suggestions WHERE user_id = ${viewer} ORDER BY 1`).map((r) => r.suggested_user_id as string);
    assert.equal(JSON.stringify(afterSet), before);

    await suggestions.replaceSuggestions(viewer, []);
    assert.equal((await sql`SELECT count(*)::int AS n FROM connection_suggestions WHERE user_id = ${viewer}`)[0]!.n, 0);
  } finally {
    await sql`DELETE FROM connection_suggestions WHERE user_id = ${ids[0]!}`;
  }
});
