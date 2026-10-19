import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { databaseSsl } from "../../scripts/lib/disposable-db";

test("database tools require TLS remotely while supporting isolated localhost verification", () => {
  assert.equal(databaseSsl("postgresql://u:p@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"), "require");
  assert.equal(databaseSsl("postgresql://u:p@aws-0-eu.pooler.supabase.com:5432/postgres"), "require");
  assert.equal(databaseSsl("not a url"), "require");
  assert.equal(databaseSsl(undefined), "require");
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(databaseSsl(`postgresql://postgres@${host}:54332/nb_test`), false, host);
  }
  assert.match(readFileSync("scripts/setup-database.ts", "utf8"), /ssl: databaseSsl\(DATABASE_URL\)/);
});
