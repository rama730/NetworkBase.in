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
