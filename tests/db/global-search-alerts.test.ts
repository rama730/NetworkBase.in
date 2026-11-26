import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Phase 3 review 1: a run that starts a little earlier than yesterday's still sends (an hour of slack).
test("a daily alert is due after 23.5 hours, not after 22", async () => {
  const late = await setup("daily", 23.5);
  await newWorkspace(late.owner, `${late.t} fresh`);
  const early = await setup("daily", 22);
  await newWorkspace(early.owner, `${early.t} fresh`);
  const due = await alerts.collectDueAlerts(new Date());
  assert.ok(due.some((item) => item.id === late.id));
  assert.ok(!due.some((item) => item.id === early.id));
  // Phase 3 review 2: collecting moves nothing; a row moves only once its notice is sent.
  const [still] = await sql`SELECT last_notified_at < now() - interval '1 hour' AS old FROM saved_searches WHERE id = ${late.id}`;
  assert.equal(still!.old, true);
});

test("weekly waits about seven days; off never; nothing new sends nothing", async () => {
  const weekly = await setup("weekly", 24 * 6);
  await newWorkspace(weekly.owner, `${weekly.t} fresh`);
  const off = await setup("off", 24 * 30);
  await newWorkspace(off.owner, `${off.t} fresh`);
  const due = await alerts.collectDueAlerts(new Date());
  for (const id of [weekly.id, off.id]) assert.ok(!due.some((item) => item.id === id));
  const quiet = await setup("daily", 48);
  const sent = await alerts.sendAlert(due.find((item) => item.id === quiet.id) ?? (await alerts.collectDueAlerts(new Date())).find((item) => item.id === quiet.id)!, new Date());
  assert.equal(sent, "nothing-new");
  const [moved] = await sql`SELECT last_notified_at > now() - interval '1 minute' AS moved FROM saved_searches WHERE id = ${quiet.id}`;
  assert.equal(moved!.moved, true);
});

// Phase 3 review 3: a saved Discover search counts only organizations, workspaces and posts (no people or messages search).
test("the count for a Discover search reads only the kinds that tab shows", () => {
  const source = readFileSync("src/lib/search/global/saved.ts", "utf8");
  assert.doesNotMatch(source, /runGlobalSearch/);
  assert.match(source, /searchPlaces\(/);
  // Batches of 25 to a step: a slow search can't stall the run, and steps stay few on the Inngest plan.
  assert.match(readFileSync("src/inngest/functions/saved-search-alerts.ts", "utf8"), /step\.run\(`saved-search-alerts-\$\{index\}`/);
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
