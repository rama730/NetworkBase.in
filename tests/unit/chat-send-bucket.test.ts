import assert from "node:assert/strict";
import test from "node:test";

import { createTokenBucket } from "@/lib/messaging/send-bucket";

test("allows a burst up to capacity, then refills over time", () => {
  const take = createTokenBucket({ capacity: 3, refillPerSecond: 1 });
  assert.equal(take("u1", 0), true);
  assert.equal(take("u1", 0), true);
  assert.equal(take("u1", 0), true);
  assert.equal(take("u1", 0), false);
  assert.equal(take("u1", 1_000), true, "one token back after a second");
  assert.equal(take("u1", 1_000), false);
});

test("keys are independent", () => {
  const take = createTokenBucket({ capacity: 1, refillPerSecond: 1 });
  assert.equal(take("a", 0), true);
  assert.equal(take("b", 0), true);
  assert.equal(take("a", 0), false);
});

test("memory stays bounded", () => {
  const take = createTokenBucket({ capacity: 1, refillPerSecond: 1, maxKeys: 50 });
  for (let i = 0; i < 1_000; i += 1) take(`k${i}`, 0);
  assert.equal(take("k0", 0), true, "evicted keys start fresh");
});
