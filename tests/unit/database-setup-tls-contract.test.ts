import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("database setup requires TLS remotely while supporting isolated localhost verification", () => {
  const source = readFileSync("scripts/setup-database.ts", "utf8");

  assert.match(source, /function requiresDatabaseTls/);
  assert.match(source, /hostname !== "localhost"/);
  assert.match(source, /hostname !== "127\.0\.0\.1"/);
  assert.match(source, /hostname !== "::1"/);
  assert.match(source, /requiresDatabaseTls\(DATABASE_URL\) \? "require" : false/);
});
