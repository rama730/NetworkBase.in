import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planSync } from "../lib/sync/plan.mjs";

// Every row of report A1.6: nothing a person or a teammate wrote is overwritten.
const base = (/** @type {string | null} */ hash, version = 1) => ({ nodeId: "n1", baseVersion: version, baseHash: hash, size: 1, mtimeMs: 1 });
const local = (/** @type {string} */ hash) => ({ remote: "/a.txt", abs: "/x/a.txt", size: 1, mtimeMs: 2, hash });
const remote = (/** @type {string} */ hash, version = 1) => ({ nodeId: "n1", version, hash, size: 1 });

/** @param {{ b?: any, l?: any, r?: any }} sides */
function one({ b, l, r }) {
  const items = planSync({ base: b ? { "/a.txt": b } : {}, local: new Map(l ? [["/a.txt", l]] : []), remote: new Map(r ? [["/a.txt", r]] : []) });
  return items[0] ? [items[0].state, items[0].action] : null;
}

describe("three-way plan (A1.6)", () => {
  it("same everywhere → nothing", () => assert.deepEqual(one({ b: base("h1"), l: local("h1"), r: remote("h1") }), ["unchanged", "none"]));
  it("changed here only → push", () => assert.deepEqual(one({ b: base("h1"), l: local("h2"), r: remote("h1") }), ["modified", "push"]));
  it("changed on the server only → pull", () => assert.deepEqual(one({ b: base("h1"), l: local("h1"), r: remote("h2", 2) }), ["remote-modified", "pull"]));
  it("both changed to the same content → adopt the server's version", () => assert.deepEqual(one({ b: base("h1"), l: local("h2"), r: remote("h2", 2) }), ["same-change", "adopt"]));
  it("both changed differently → conflict", () => assert.deepEqual(one({ b: base("h1"), l: local("h2"), r: remote("h3", 2) }), ["conflict", "conflict"]));
  it("deleted here, unchanged there → asks before deleting on the server", () => assert.deepEqual(one({ b: base("h1"), r: remote("h1") }), ["deleted", "delete-remote"]));
  it("deleted here, changed there → restore", () => assert.deepEqual(one({ b: base("h1"), r: remote("h2", 2) }), ["remote-modified", "restore"]));
  it("deleted there, unchanged here → remove here (kept in trash)", () => assert.deepEqual(one({ b: base("h1"), l: local("h1") }), ["remote-deleted", "remove-local"]));
  it("deleted there, changed here → keep yours as new", () => assert.deepEqual(one({ b: base("h1"), l: local("h2") }), ["added", "keep-local"]));
  it("new here → push", () => assert.deepEqual(one({ l: local("h1") }), ["added", "push"]));
  it("new there → pull", () => assert.deepEqual(one({ r: remote("h1") }), ["remote-added", "pull"]));
  it("new in both, same content → adopt", () => assert.deepEqual(one({ l: local("h1"), r: remote("h1") }), ["unchanged", "adopt"]));
  it("new in both, different → conflict", () => assert.deepEqual(one({ l: local("h1"), r: remote("h2") }), ["conflict", "conflict"]));
  it("a newer server version with the same content isn't a change", () => assert.deepEqual(one({ b: base("h1"), l: local("h1"), r: remote("h1", 3) }), ["unchanged", "adopt"]));
});
