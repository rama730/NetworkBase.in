import assert from "node:assert/strict";
import test from "node:test";

import { actTargetFromDedupeKey, parseNeedsYouKey } from "../../src/lib/notifications/act-target";

const ID = "3f2b8c1e-0d4a-4c9b-9e1f-2a7b6c5d4e3f";

test("a Needs you key names its source and id; anything else is refused", () => {
  assert.deepEqual(parseNeedsYouKey(`connection:${ID}`), { source: "connection", id: ID });
  assert.deepEqual(parseNeedsYouKey(`agent_question:${ID}`), { source: "agent_question", id: ID });
  assert.deepEqual(parseNeedsYouKey(`agent_access:${ID}`), { source: "agent_access", id: ID });
  assert.equal(parseNeedsYouKey(`review:${ID}`), null, "a review is opened, not acted on");
  assert.equal(parseNeedsYouKey("connection:not-a-uuid"), null);
  assert.equal(parseNeedsYouKey(`connection:${ID}:extra`), null);
});

test("a notification row's dedupe key leads to the same target (push buttons)", () => {
  assert.deepEqual(actTargetFromDedupeKey(`connection:${ID}:received`), { source: "connection", id: ID });
  assert.deepEqual(actTargetFromDedupeKey(`agent-question:${ID}`), { source: "agent_question", id: ID });
  assert.deepEqual(actTargetFromDedupeKey(`agent-access-request:${ID}`), { source: "agent_access", id: ID });
  assert.equal(actTargetFromDedupeKey(`connection:${ID}:accepted`), null, "an accepted request has nothing to answer");
  assert.equal(actTargetFromDedupeKey("burst:key"), null);
});
