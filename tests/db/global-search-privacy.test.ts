import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// "Who can find me in search" (round one item 11, decision 4): Everyone by default, find by email off; saved and audited.
moduleStubs.set("next/headers", { headers: async () => ({ get: () => null }), cookies: async () => ({ getAll: () => [], get: () => undefined }) });
let settings: typeof import("../../src/lib/privacy/settings");
before(async () => { settings = await loadAppModule(() => import("../../src/lib/privacy/settings")); });
const created: string[] = [];
afterEach(async () => { if (created.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`; created.length = 0; });
after(async () => { await sql.end(); await closeAppDb(); });

const request = () => new Request("https://app.test/api/v1/privacy", { method: "PATCH" });

test("defaults to Everyone, email off; both change and are recorded", async () => {
  const id = await createUser(sql);
  created.push(id);
  const before = await settings.getPrivacySettingsPayload(id);
  assert.equal(before.searchVisibility, "everyone");
  assert.equal(before.findableByEmail, false);
  await settings.updatePrivacySetting({ userId: id, request: request(), kind: "searchVisibility", nextValue: "connections" });
  await settings.updatePrivacySetting({ userId: id, request: request(), kind: "findableByEmail", nextValue: "on" });
  const after = await settings.getPrivacySettingsPayload(id);
  assert.equal(after.searchVisibility, "connections");
  assert.equal(after.findableByEmail, true);
  const events = await sql`SELECT event_type FROM profile_audit_events WHERE user_id = ${id} ORDER BY created_at`;
  assert.deepEqual(events.map((e) => e.event_type), ["search_visibility_changed", "find_by_email_changed"]);
});

test("the route takes exactly the three choices, and on/off for email", () => {
  const route = readFileSync("src/app/api/v1/privacy/route.ts", "utf8");
  assert.match(route, /bodyKey: "searchVisibility",[\s\S]*?values: \["everyone", "my_places", "connections"\] as const/);
  assert.match(route, /bodyKey: "findableByEmail",[\s\S]*?values: \["on", "off"\] as const/);
});
