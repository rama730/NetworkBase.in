import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
moduleStubs.set("@/lib/messaging/publish", { publishUser: () => undefined, publishUsers: () => undefined, publishChannel: () => undefined });

let members: typeof import("../../src/app/actions/chat/members");
before(async () => {
  members = await loadAppModule(() => import("../../src/app/actions/chat/members"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const channelCount = async () => Number((await sql`SELECT count(*)::int AS n FROM chat_channels WHERE kind = 'dm'`)[0]!.n);

// API-016: opening /messages?userId= must not create or reopen a conversation.
test("findDm is read-only; getOrCreateDm is the only creator", async () => {
  const a = await sql.begin((tx) => createUser(tx));
  const b = await sql.begin((tx) => createUser(tx));
  try {
    await sql`UPDATE profiles SET message_privacy = 'everyone' WHERE id = ${b}`;
    viewerId = a;
    const before = await channelCount();
    const none = await members.findDm({ userId: b });
    assert.deepEqual(none.success && { channelId: none.channelId, named: Boolean(none.displayName) }, { channelId: null, named: true });
    assert.equal(await channelCount(), before, "a lookup creates nothing");

    const created = await members.getOrCreateDm({ userId: b });
    assert.equal(created.success, true, JSON.stringify(created));
    const found = await members.findDm({ userId: b });
    assert.equal(found.success && found.channelId, created.success ? created.channelId : null);

    // Closing the DM and looking it up again must not reopen it.
    if (!created.success) return;
    await sql`UPDATE chat_channel_members SET closed_at = now() WHERE channel_id = ${created.channelId} AND user_id = ${a}`.catch(() => undefined);
    const state = async () => (await sql`SELECT * FROM chat_channel_members WHERE channel_id = ${created.channelId} AND user_id = ${a}`)[0];
    const snapshot = JSON.stringify(await state());
    await members.findDm({ userId: b });
    assert.equal(JSON.stringify(await state()), snapshot, "a lookup leaves membership state untouched");

    // Blocked pairs find nothing.
    await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${b}, ${a})`;
    const blocked = await members.findDm({ userId: b });
    assert.equal(blocked.success && blocked.channelId, null);
  } finally {
    await sql`DELETE FROM connections WHERE requester_id = ANY(${[a, b]}::uuid[]) OR addressee_id = ANY(${[a, b]}::uuid[])`;
    await sql`DELETE FROM chat_channels WHERE kind = 'dm' AND created_by = ANY(${[a, b]}::uuid[])`;
  }
});
