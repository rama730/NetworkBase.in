import assert from "node:assert/strict";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

// A plain index that is the first part of a longer one costs every write and serves nothing the longer one doesn't.
test("no index is the leading part of a longer index on the same table", async () => {
  const rows = await sql`
    WITH ix AS (
      SELECT i.indexrelid, i.indrelid, i.indisunique, i.indisprimary, i.indpred, i.indexprs, i.indnkeyatts,
        (i.indkey::int2[])[0:i.indnkeyatts-1] AS k, (i.indclass::oid[])[0:i.indnkeyatts-1] AS c,
        (i.indoption::int2[])[0:i.indnkeyatts-1] AS o, (i.indcollation::oid[])[0:i.indnkeyatts-1] AS co, am.amname
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam JOIN pg_class t ON t.oid = i.indrelid
      WHERE t.relnamespace = 'public'::regnamespace AND NOT t.relispartition AND t.relkind IN ('r', 'p') AND i.indisvalid)
    SELECT DISTINCT s.indexrelid::regclass::text AS name
    FROM ix s JOIN ix l ON l.indrelid = s.indrelid AND l.indexrelid <> s.indexrelid AND l.amname = 'btree' AND s.amname = 'btree'
      AND l.indpred IS NULL AND l.indexprs IS NULL AND l.indnkeyatts > s.indnkeyatts
      AND l.k[1:s.indnkeyatts] = s.k[1:s.indnkeyatts] AND l.c[1:s.indnkeyatts] = s.c[1:s.indnkeyatts]
      AND l.o[1:s.indnkeyatts] = s.o[1:s.indnkeyatts] AND l.co[1:s.indnkeyatts] = s.co[1:s.indnkeyatts]
    WHERE s.indpred IS NULL AND s.indexprs IS NULL AND NOT s.indisunique AND NOT s.indisprimary
    ORDER BY 1`;
  assert.deepEqual(rows.map((r) => r.name), []);
});
