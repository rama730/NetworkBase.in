import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

// Real database. The activity list pages by time: "older than the last one shown", only security events.
let audit: typeof import("@/lib/security/audit");
const created: string[] = [];

before(async () => { audit = await loadAppModule(() => import("@/lib/security/audit")); });
afterEach(async () => {
  if (created.length) await sql`DELETE FROM public.profile_audit_events WHERE user_id IN ${sql(created)}`;
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

test("older pages follow the newest, never repeat, and skip entries that are not security events", async () => {
  const userId = await sql.begin((tx) => createUser(tx, {}));
  created.push(userId);
  for (let minute = 0; minute < 5; minute += 1) {
    await sql`INSERT INTO public.profile_audit_events (user_id, event_type, metadata, created_at)
              VALUES (${userId}, 'password_changed', '{}'::jsonb, now() - (${minute} || ' minutes')::interval)`;
  }
  await sql`INSERT INTO public.profile_audit_events (user_id, event_type, metadata) VALUES (${userId}, 'profile_visibility_changed', '{}'::jsonb)`;

  const first = await audit.listSecurityActivity(userId, 2);
  assert.equal(first.length, 2);
  const second = await audit.listSecurityActivity(userId, 2, new Date(first[1]!.createdAt));
  const third = await audit.listSecurityActivity(userId, 2, new Date(second[1]!.createdAt));
  const ids = [...first, ...second, ...third].map((entry) => entry.id);
  assert.equal(ids.length, 5, "all five security events, the privacy one left out");
  assert.equal(new Set(ids).size, 5, "none twice");
  assert.deepEqual(await audit.listSecurityActivity(userId, 2, new Date(third[0]!.createdAt)), []);
});
