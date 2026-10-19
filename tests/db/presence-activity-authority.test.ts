import assert from "node:assert/strict";
import { after, test } from "node:test";

import { presencePrivacy } from "../../src/lib/presence/model";
import { readFileSync } from "node:fs";

import { actAs, actAsOwner, addMember, closeAppDb, createProject, createUser, inRollback, loadAppModule, sql } from "./_helpers";

after(async () => { await sql.end(); await closeAppDb(); });

const visible = async (tx: Parameters<Parameters<typeof inRollback>[0]>[0], viewer: string | null, target: string | null) =>
  (await tx`SELECT app_private.nb_presence_activity_visible(${viewer}::uuid, ${target}::uuid) AS v`)[0]!.v as boolean;

// AUTH-011: the SQL rule and the server projection (presencePrivacy) are the same rule.
test("activity visibility in SQL equals the server projection for every combination", async () => {
  await inRollback(async (tx) => {
    const a = await createUser(tx);
    const b = await createUser(tx);
    for (const viewerShows of [true, false]) for (const targetShows of [true, false]) for (const blocked of [true, false]) {
      await tx`UPDATE profiles SET show_activity = ${viewerShows} WHERE id = ${a}`;
      await tx`UPDATE profiles SET show_activity = ${targetShows} WHERE id = ${b}`;
      await tx`DELETE FROM connections WHERE requester_id = ANY(${[a, b]}::uuid[])`;
      if (blocked) await tx`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${b}, ${a}, 'blocked', ${b}, now())`;
      const expected = presencePrivacy({ self: false, blocked, viewerShowsActivity: viewerShows, targetShowsActivity: targetShows, connected: false, teammate: false, visibility: "everyone" }).activity;
      assert.equal(await visible(tx, a, b), expected, JSON.stringify({ viewerShows, targetShows, blocked }));
    }
    assert.equal(await visible(tx, a, a), true, "you always see your own");
    assert.equal(await visible(tx, null, b), false);
  });
});

test("Realtime observation needs a relationship and the shared rule", async () => {
  await inRollback(async (tx) => {
    const a = await createUser(tx);
    const b = await createUser(tx);
    const stranger = await createUser(tx);
    const projectId = await createProject(tx, a);
    await addMember(tx, projectId, a, "owner");
    await addMember(tx, projectId, b);
    const observe = async (viewer: string, target: string) => {
      await actAs(tx, viewer);
      const [row] = await tx`SELECT app_private.nb_can_observe_user_presence(${target}::uuid) AS v`;
      await actAsOwner(tx);
      return row!.v as boolean;
    };
    assert.equal(await observe(a, a), true);
    assert.equal(await observe(a, b), true, "teammates");
    assert.equal(await observe(a, stranger), false, "no relationship");
    await tx`UPDATE profiles SET show_activity = false WHERE id = ${b}`;
    assert.equal(await observe(a, b), false, "target hid their activity");
    assert.equal(await observe(b, a), false, "a person who hides theirs sees nobody's");
    assert.equal(await observe(b, b), true, "but their own");
    await tx`UPDATE profiles SET show_activity = true WHERE id = ${b}`;
    await tx`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${a}, ${b}, 'blocked', ${a}, now())`;
    assert.equal(await observe(a, b), false, "blocked");
    assert.equal(await observe(b, a), false, "blocked the other way");
  });
});

test("a person who hides their activity cannot publish presence", async () => {
  await inRollback(async (tx) => {
    const a = await createUser(tx);
    const publish = async (userId: string) => {
      await actAs(tx, userId);
      await tx`SELECT set_config('realtime.topic', ${`presence:user:${userId}`}, true)`;
      let allowed = true;
      await tx`SAVEPOINT p`;
      try {
        await tx`INSERT INTO realtime.messages (topic, extension, private) VALUES (${`presence:user:${userId}`}, 'presence', true)`;
      } catch {
        allowed = false;
        await tx`ROLLBACK TO SAVEPOINT p`;
      }
      await actAsOwner(tx);
      return allowed;
    };
    assert.equal(await publish(a), true);
    await tx`UPDATE profiles SET show_activity = false WHERE id = ${a}`;
    assert.equal(await publish(a), false);
  });
});

test("the helper functions are not callable by browser roles, except the publish check", async () => {
  const [row] = await sql`SELECT
    has_function_privilege('authenticated', 'app_private.nb_presence_activity_visible(uuid, uuid)', 'EXECUTE') AS visible_auth,
    has_function_privilege('anon', 'app_private.nb_can_publish_user_presence()', 'EXECUTE') AS publish_anon,
    has_function_privilege('authenticated', 'app_private.nb_can_publish_user_presence()', 'EXECUTE') AS publish_auth`;
  assert.deepEqual({ ...row }, { visible_auth: false, publish_anon: false, publish_auth: true });
});

test("list reads mask last-active through the same rule", async () => {
  const { db } = await loadAppModule(() => import("../../src/lib/db"));
  const { profiles } = await loadAppModule(() => import("../../src/lib/db/schema"));
  const { visibleLastActiveAt } = await loadAppModule(() => import("../../src/lib/presence/sql"));
  const { eq } = await import("drizzle-orm");
  const a = await sql.begin((tx) => createUser(tx));
  const b = await sql.begin((tx) => createUser(tx));
  try {
    await sql`UPDATE profiles SET last_active_at = now() WHERE id = ${b}`;
    const read = async () => (await db.select({ at: visibleLastActiveAt(a) }).from(profiles).where(eq(profiles.id, b)))[0]!.at;
    assert.ok((await read()) instanceof Date, "visible: a real timestamp");
    await sql`UPDATE profiles SET show_activity = false WHERE id = ${b}`;
    assert.equal(await read(), null, "hidden by the target");
    await sql`UPDATE profiles SET show_activity = true WHERE id = ${b}`;
    await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${b}, ${a}, 'blocked', ${b}, now())`;
    assert.equal(await read(), null, "blocked");
  } finally {
    await sql`DELETE FROM connections WHERE requester_id = ANY(${[a, b]}::uuid[])`;
    await sql`DELETE FROM profiles WHERE id = ANY(${[a, b]}::uuid[])`;
  }
});

test("people lists never select the raw last-active column", () => {
  assert.doesNotMatch(readFileSync("src/app/actions/connections.ts", "utf8"), /lastActiveAt:\s*profiles\.lastActiveAt/);
});
