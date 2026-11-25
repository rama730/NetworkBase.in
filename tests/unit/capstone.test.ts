import assert from "node:assert/strict";
import test from "node:test";

import { readCapstone, readyBlock, showcasePublic } from "@/lib/workflows/capstone";

test("a capstone reads with empty defaults and caps metrics at 3", () => {
  const c = readCapstone(null);
  assert.deepEqual([c.problem, c.metrics, c.showcase.readyAt, c.showcase.links.demo], ["", [], null, ""]);
  assert.throws(() => readCapstone({ capstone: { metrics: ["a", "b", "c", "d"] } }));
});

test("Ready needs a title and every milestone done", () => {
  const c = readCapstone({ capstone: { showcase: { title: "Bus delay predictor" } } });
  assert.equal(readyBlock(c, [{ done: true }, { done: true }]), null);
  assert.match(readyBlock(c, [{ done: true }, { done: false }]) ?? "", /every milestone/);
  assert.match(readyBlock(c, []) ?? "", /every milestone/);
  assert.match(readyBlock(readCapstone(null), [{ done: true }]) ?? "", /title/);
});

test("public only when every current member agreed", () => {
  assert.equal(showcasePublic({ a: "x", b: "y" }, ["a", "b"]), true);
  assert.equal(showcasePublic({ a: "x" }, ["a", "b"]), false);
  assert.equal(showcasePublic({}, []), false);
});
