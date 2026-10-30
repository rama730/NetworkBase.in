import assert from "node:assert/strict";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

// Deleting an account checks user_mutes.muted_id; without an index that scans the table.
test("user_mutes.muted_id has a leading index", async () => {
  const rows = await sql`
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = (i.indkey::smallint[])[0]
    WHERE i.indrelid = 'public.user_mutes'::regclass AND a.attname = 'muted_id' AND i.indisvalid AND i.indpred IS NULL`;
  assert.equal(rows.length, 1);
});
