import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";

import { requireDisposableDatabaseUrl } from "../../scripts/lib/disposable-db";
import { sql } from "./_helpers";

after(() => sql.end());

const url = requireDisposableDatabaseUrl("test:db");
const setup = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/setup-database.ts"], {
  env: { ...process.env, DATABASE_URL: url },
  encoding: "utf8",
});

// MIG-004: routine setup reports lineage drift and never rewrites history.
for (const [name, column, value] of [
  ["missing checksum", "checksum", null],
  ["changed checksum", "checksum", "0".repeat(64)],
  ["wrong journal index", "journal_index", -1],
] as const) {
  test(`setup refuses a ${name} and leaves it as found`, async () => {
    const [row] = await sql`SELECT tag, checksum, journal_index FROM public.app_migration_journal WHERE tag = '0005_skills' OR journal_index = 100 LIMIT 1`;
    assert.ok(row, "fixture journal row");
    try {
      await sql`UPDATE public.app_migration_journal SET ${sql({ [column]: value })} WHERE tag = ${row.tag}`;
      const result = setup();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, new RegExp(`${row.tag}: (checksum|journal_index)`));
      const [after] = await sql`SELECT checksum, journal_index FROM public.app_migration_journal WHERE tag = ${row.tag}`;
      assert.equal(after![column], value);
    } finally {
      await sql`UPDATE public.app_migration_journal SET checksum = ${row.checksum}, journal_index = ${row.journal_index} WHERE tag = ${row.tag}`;
    }
  });
}

test("setup on a database at the journal head changes nothing", () => {
  const result = setup();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already matches the migration journal/);
});
