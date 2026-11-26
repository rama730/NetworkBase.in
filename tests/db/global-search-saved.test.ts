import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Saved searches (round two, items 9 and 18): a NEW count since you last looked, at most 20 saved.
let saved: typeof import("../../src/lib/search/global/saved");
before(async () => { saved = await loadAppModule(() => import("../../src/lib/search/global/saved")); });
const created: string[] = [];
afterEach(async () => {
  if (!created.length) return;
  await sql`DELETE FROM workspaces WHERE owner_id IN ${sql(created)}`;
  await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

const letters = () => Array.from({ length: 7 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");
async function people() {
  const [viewer, owner] = [await createUser(sql), await createUser(sql)];
  created.push(viewer, owner);
  await sql`UPDATE profiles SET onboarding_status = 'completed' WHERE id IN ${sql([viewer, owner])}`;
  return { viewer, owner };
}

test("the NEW count is what appeared after you last looked", async () => {
  const { viewer, owner } = await people();
  const t = `zq${letters()}`;
  const old = await createProject(sql, owner);
  await sql`UPDATE workspaces SET title = ${`${t} old`}, created_at = now() - interval '3 days' WHERE id = ${old}`;
  const row = await saved.saveSearch(viewer, { query: t, tab: "discover", filters: {}, notify: "weekly" });
  assert.ok(row.ok);
  await sql`UPDATE saved_searches SET last_seen_at = now() - interval '1 day' WHERE user_id = ${viewer}`;
  const fresh = await createProject(sql, owner);
  await sql`UPDATE workspaces SET title = ${`${t} fresh`} WHERE id = ${fresh}`;
  const list = await saved.listSavedSearches(viewer);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.query, t);
  assert.equal(list[0]!.newCount, 1);
  await saved.markSavedSeen(viewer, list[0]!.id);
  assert.equal((await saved.listSavedSearches(viewer))[0]!.newCount, 0);
});

test("alerts can change; saving twice keeps one; a 21st is refused; delete removes it", async () => {
  const { viewer } = await people();
  const first = await saved.saveSearch(viewer, { query: "react", tab: "people", filters: { loc: ["Hyderabad"] }, notify: "weekly" });
  assert.ok(first.ok);
  const again = await saved.saveSearch(viewer, { query: "React", tab: "people", filters: { loc: ["Hyderabad"] }, notify: "weekly" });
  assert.ok(again.ok);
  assert.equal(again.ok && again.id, first.ok && first.id);
  assert.equal(await saved.setSavedNotify(viewer, first.ok ? first.id : "", "daily"), true);
  assert.equal((await saved.listSavedSearches(viewer))[0]!.notify, "daily");
  for (let i = 0; i < 19; i += 1) assert.ok((await saved.saveSearch(viewer, { query: `q${i}`, tab: "discover", filters: {}, notify: "off" })).ok);
  const over = await saved.saveSearch(viewer, { query: "one more", tab: "discover", filters: {}, notify: "off" });
  assert.deepEqual(over, { ok: false, error: "You can keep 20 saved searches. Remove one to save this." });
  assert.equal(await saved.deleteSavedSearch(viewer, first.ok ? first.id : ""), true);
  assert.equal((await sql`SELECT count(*)::int AS n FROM saved_searches WHERE user_id = ${viewer}`)[0]!.n, 19);
});

test("someone else's saved search can't be changed", async () => {
  const { viewer, owner } = await people();
  const mine = await saved.saveSearch(viewer, { query: "react", tab: "discover", filters: {}, notify: "weekly" });
  assert.equal(await saved.setSavedNotify(owner, mine.ok ? mine.id : "", "off"), false);
  assert.equal(await saved.deleteSavedSearch(owner, mine.ok ? mine.id : ""), false);
});
