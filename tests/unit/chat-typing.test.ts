import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_TYPING_THROTTLE_MS, CHAT_TYPING_TTL_MS, channelTopic, typingTopic } from "@/lib/messaging/constants";
import { pruneTypers, shouldSendTyping, typingLabel, withoutTyper } from "@/lib/messaging/typing";

test("typing label follows Slack wording", () => {
  assert.equal(typingLabel([]), null);
  assert.deepEqual(typingLabel(["Ann"]), { names: ["Ann"], text: "is typing" });
  assert.deepEqual(typingLabel(["Ann", "Bo"]), { names: ["Ann", "Bo"], text: "are typing" });
  assert.deepEqual(typingLabel(["Ann", "Bo", "Cy"]), { names: [], text: "Several people are typing" });
});

test("typers expire after the TTL; nothing to expire keeps the same object", () => {
  const now = 100_000;
  const typers = { a: { name: "Ann", at: now - CHAT_TYPING_TTL_MS }, b: { name: "Bo", at: now - 1_000 } };
  assert.deepEqual(Object.keys(pruneTypers(typers, now)), ["b"]);
  const fresh = { b: { name: "Bo", at: now } };
  assert.equal(pruneTypers(fresh, now), fresh);
});

test("a stop or a sent message removes one typer", () => {
  const typers = { a: { name: "Ann", at: 1 }, b: { name: "Bo", at: 1 } };
  assert.deepEqual(Object.keys(withoutTyper(typers, "a")), ["b"]);
  assert.equal(withoutTyper(typers, "zz"), typers);
});

test("typing on is throttled; the first signal goes at once", () => {
  assert.equal(shouldSendTyping(0, 10_000), true);
  assert.equal(shouldSendTyping(10_000, 10_000 + CHAT_TYPING_THROTTLE_MS - 1), false);
  assert.equal(shouldSendTyping(10_000, 10_000 + CHAT_TYPING_THROTTLE_MS), true);
});

test("typing has its own topic, separate from the server-only channel topic", () => {
  assert.equal(typingTopic("c1"), "chat:typing:c1");
  assert.notEqual(typingTopic("c1"), channelTopic("c1"));
});
