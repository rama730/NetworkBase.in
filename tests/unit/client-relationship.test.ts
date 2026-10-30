import assert from "node:assert/strict";
import { test } from "node:test";

import { forClient } from "../../src/lib/privacy/client-relationship";
import { derivePrivacyRelationshipState } from "../../src/lib/privacy/relationship-state";

// Nothing sent to a browser may say that its viewer was blocked (Blocking B31, K28).

const state = (blocks: { byViewer: boolean; byTarget: boolean }, closed = false) =>
  derivePrivacyRelationshipState({
    viewerId: "viewer", targetUserId: "target", blocks,
    profileVisibility: closed ? "private" : "public", messagePrivacy: closed ? "connections" : "everyone", connectionPrivacy: closed ? "nobody" : "everyone",
  });

test("someone who was blocked gets exactly what a closed private account gives them", () => {
  const blocked = forClient(state({ byViewer: false, byTarget: true }));
  const privateAccount = forClient(state({ byViewer: false, byTarget: false }, true));
  for (const key of ["blockedByTarget", "connectionState", "visibilityReason", "canViewProfile", "canSendMessage", "canSendConnectionRequest"] as const) {
    assert.deepEqual(blocked[key], privateAccount[key], key);
  }
  assert.doesNotMatch(JSON.stringify(blocked), /blocked_by_target|"blocked"/);
});

test("your own block stays visible to you, even when it's mutual", () => {
  const mine = forClient(state({ byViewer: true, byTarget: true }));
  assert.equal(mine.blockedByViewer, true);
  assert.equal(mine.blockedByTarget, false);
  assert.equal(mine.connectionState, "blocked_by_viewer");
});

test("a DM across a block closes replies both ways, and only the blocker's side says so (B44)", async () => {
  const { withBlockState } = await import("../../src/lib/messaging/shell-state");
  const person = (id: string) => ({ id, username: id, full_name: id, avatar_url: null });
  const dm = (id: string, other: string) => ({ id, kind: "dm", dm_user: person(other), members_preview: null, member_count: 2, project_id: null, application_id: null }) as never;
  const [mine, theirs, open] = withBlockState([dm("c1", "x"), dm("c2", "y"), dm("c3", "z")], "me", [
    { blocker_id: "me", blocked_id: "x" }, { blocker_id: "y", blocked_id: "me" },
  ]) as Array<{ reply_closed?: boolean; blocked_by_me?: boolean }>;
  assert.deepEqual([mine!.reply_closed, mine!.blocked_by_me], [true, true]);
  assert.deepEqual([theirs!.reply_closed, theirs!.blocked_by_me], [true, false]);
  assert.equal(open!.reply_closed, undefined);
});
