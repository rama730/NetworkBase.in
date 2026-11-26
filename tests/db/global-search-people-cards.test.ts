import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

// The results page's People tab draws Network's own person card (spec §12) from the global search's people.
let cards: typeof import("../../src/lib/search/global/people-cards");
before(async () => { cards = await loadAppModule(() => import("../../src/lib/search/global/people-cards")); });
const created: string[] = [];
afterEach(async () => {
  if (!created.length) return;
  await sql`DELETE FROM connections WHERE requester_id IN ${sql(created)} OR addressee_id IN ${sql(created)}`;
  await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

const letters = () => Array.from({ length: 7 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");

test("people come back in the person card's shape, with the connection state either way", async () => {
  const t = `zq${letters()}`;
  const [viewer, friend, asked, stranger, hidden] = [await createUser(sql), await createUser(sql), await createUser(sql), await createUser(sql), await createUser(sql)];
  created.push(viewer, friend, asked, stranger, hidden);
  for (const [id, name] of [[viewer, "Viewer"], [friend, `${t} Friend`], [asked, `${t} Asked`], [stranger, `${t} Stranger`], [hidden, `${t} Hidden`]] as const) {
    await sql`UPDATE profiles SET onboarding_status = 'completed', full_name = ${name}, headline = 'Developer', skills = ${sql.json(["React"])} WHERE id = ${id}`;
  }
  await sql`UPDATE profiles SET search_visibility = 'connections' WHERE id = ${hidden}`;
  await sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${viewer}, ${friend}, 'accepted'), (${viewer}, ${asked}, 'pending')`;
  const people = await cards.searchPeopleCards(viewer, t);
  const byName = Object.fromEntries(people.map((p) => [p.fullName, p]));
  assert.deepEqual(Object.keys(byName).sort(), [`${t} Asked`, `${t} Friend`, `${t} Stranger`]);
  assert.equal(byName[`${t} Friend`]!.connectionStatus, "connected");
  assert.equal(byName[`${t} Asked`]!.connectionStatus, "pending_sent");
  assert.equal(byName[`${t} Stranger`]!.connectionStatus, "none");
  assert.deepEqual(byName[`${t} Stranger`]!.skills, ["React"]);
  assert.equal(byName[`${t} Stranger`]!.headline, "Developer");
  assert.equal(byName[`${t} Stranger`]!.isLockedProfile, false);
});
