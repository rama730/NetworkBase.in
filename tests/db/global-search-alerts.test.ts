import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Saved-search alerts (round two item 9): daily or weekly, only when something new matches, one notice a day.
let alerts: typeof import("../../src/lib/search/global/alerts");
before(async () => { alerts = await loadAppModule(() => import("../../src/lib/search/global/alerts")); });
const created: string[] = [];
afterEach(async () => {
  if (!created.length) return;
  await sql`DELETE FROM user_notifications WHERE user_id IN ${sql(created)}`.catch(() => undefined);
  await sql`DELETE FROM workspaces WHERE owner_id IN ${sql(created)}`;
  await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

const letters = () => Array.from({ length: 7 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");
async function setup(notify: "daily" | "weekly" | "off", hoursAgo: number) {
  const [viewer, owner] = [await createUser(sql), await createUser(sql)];
  created.push(viewer, owner);
  await sql`UPDATE profiles SET onboarding_status = 'completed' WHERE id IN ${sql([viewer, owner])}`;
  const t = `zq${letters()}`;
  const [row] = await sql`INSERT INTO saved_searches (user_id, query, tab, notify, last_notified_at) VALUES (${viewer}, ${t}, 'discover', ${notify}, now() - ${`${hoursAgo} hours`}::interval) RETURNING id`;
  return { viewer, owner, t, id: row!.id as string };
}
async function newWorkspace(owner: string, title: string) {
  const id = await createProject(sql, owner);
  await sql`UPDATE workspaces SET title = ${title} WHERE id = ${id}`;
}

test("a daily alert is due after 25 hours, not after 23", async () => {
  const late = await setup("daily", 25);
  await newWorkspace(late.owner, `${late.t} fresh`);
  const early = await setup("daily", 23);
  await newWorkspace(early.owner, `${early.t} fresh`);
  const due = await alerts.collectDueAlerts(new Date());
  assert.ok(due.some((item) => item.savedId === late.id && item.count === 1));
  assert.ok(!due.some((item) => item.savedId === early.id));
  const [after] = await sql`SELECT last_notified_at > now() - interval '1 minute' AS moved FROM saved_searches WHERE id = ${late.id}`;
  assert.equal(after!.moved, true);
});

test("weekly waits seven days; off never; nothing new sends nothing", async () => {
  const weekly = await setup("weekly", 24 * 6);
  await newWorkspace(weekly.owner, `${weekly.t} fresh`);
  const off = await setup("off", 24 * 30);
  await newWorkspace(off.owner, `${off.t} fresh`);
  const quiet = await setup("daily", 48);
  const due = await alerts.collectDueAlerts(new Date());
  for (const id of [weekly.id, off.id, quiet.id]) assert.ok(!due.some((item) => item.savedId === id));
});

test("the job sends one notice linking to the results, and clears old searches from the log", async () => {
  const late = await setup("daily", 30);
  await newWorkspace(late.owner, `${late.t} fresh`);
  await sql`INSERT INTO search_query_log (user_id, query, created_at) VALUES (${late.viewer}, 'old words', now() - interval '31 days'), (${late.viewer}, 'new words', now())`;
  const summary = await alerts.runSavedSearchAlerts(new Date());
  assert.ok(summary.sent >= 1);
  const [notice] = await sql`SELECT title, href, kind FROM user_notifications WHERE user_id = ${late.viewer}`;
  assert.equal(notice!.kind, "saved_search_matches");
  assert.equal(notice!.title, `1 new for “${late.t}”`);
  assert.equal(notice!.href, `/search?q=${late.t}`);
  const left = await sql`SELECT query FROM search_query_log WHERE user_id = ${late.viewer}`;
  assert.deepEqual(left.map((r) => r.query), ["new words"]);
});
