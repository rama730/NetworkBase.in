import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// MAINT-005: supported tools read the current chat tables, and legacy discovery is guarded and kind-filtered.
const RETIRED = /\b(message_attachments|conversation_participants|attachment_uploads)\b/;

test("the storage audit reads only current tables", () => {
  assert.doesNotMatch(readFileSync("scripts/db/inspect/audit-storage-migration.ts", "utf8"), RETIRED);
});

test("the e2e seed counts native chat membership and creates the Auth identity first", () => {
  const source = readFileSync("scripts/seed-e2e-fixtures.ts", "utf8");
  assert.doesNotMatch(source, RETIRED);
  assert.ok(source.indexOf("insert into auth.users (id, email)") < source.indexOf("'codex.e2e.peer@example.com',\n                'e2e_peer_user'"));
});

test("legacy asset registration skips tables that no longer exist and filters kinds during discovery", () => {
  const source = readFileSync("scripts/db/repair/migrate-legacy-storage-assets.ts", "utf8");
  assert.match(source, /tableExists\(sql, "attachment_uploads"\)/);
  assert.match(source, /tableExists\(sql, "message_attachments"\)/);
  assert.match(source, /const covers = !\(wants\("project_cover"\)\) \? \[\] : await sql/);
});
