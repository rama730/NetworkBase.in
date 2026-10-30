import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

// Live screens run on private broadcasts (0034). A published table would only add load, and could carry whole rows.
test("no table is in the realtime publication", async () => {
  const rows = await sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`;
  assert.deepEqual(rows.map((r) => r.tablename), []);
});

test("no screen listens to postgres_changes", () => {
  const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((file) => /\.tsx?$/.test(file));
  assert.ok(files.length > 100);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(join("src", file), "utf8"), /postgres_changes/, file);
  }
});
