import assert from "node:assert/strict";
import test from "node:test";

import { chatPushTopic, createPushSuppressor } from "@/lib/messaging/push-policy";

test("push Topic is the channel uuid without hyphens: 32 URL-safe characters", () => {
  const topic = chatPushTopic("3f2b8c1e-9a7d-4e21-b0c4-5d6e7f8a9b0c");
  assert.equal(topic, "3f2b8c1e9a7d4e21b0c45d6e7f8a9b0c");
  assert.equal(topic.length, 32);
  assert.match(topic, /^[A-Za-z0-9_-]+$/);
});

test("suppresses repeat pushes to the same user and channel for 30 s (L-11)", () => {
  const allow = createPushSuppressor(30_000);
  assert.equal(allow("u1", "c1", 0), true);
  assert.equal(allow("u1", "c1", 10_000), false);
  assert.equal(allow("u2", "c1", 10_000), true, "other users are independent");
  assert.equal(allow("u1", "c2", 10_000), true, "other channels are independent");
  assert.equal(allow("u1", "c1", 30_001), true, "allowed again after the window");
});

test("the suppression map stays bounded", () => {
  const allow = createPushSuppressor(30_000, 100);
  for (let i = 0; i < 500; i += 1) allow(`u${i}`, "c", i);
  assert.equal(allow("u0", "c", 1_000_000), true);
});
