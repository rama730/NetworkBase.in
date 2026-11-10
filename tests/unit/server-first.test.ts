import assert from "node:assert/strict";
import test from "node:test";

import { serverFirst } from "../../src/lib/server-first";

test("serverFirst: the started read answers until it settles and is used; later calls load afresh", async () => {
  let resolve!: (value: string) => void;
  const started = new Promise<string>((r) => { resolve = r; });
  let loads = 0;
  const read = serverFirst(started, async () => { loads += 1; return "fresh"; });

  // A second ask while the first is still in flight (React's dev double mount) gets the same read.
  const a = read();
  const b = read();
  resolve("started");
  assert.equal(await a, "started");
  assert.equal(await b, "started");
  assert.equal(loads, 0);

  // After it settled, a refetch loads afresh.
  assert.equal(await read(), "fresh");
  assert.equal(loads, 1);
});

test("serverFirst: a read that settled before the first ask is still used once", async () => {
  const started = Promise.resolve("started");
  await started;
  let loads = 0;
  const read = serverFirst(started, async () => { loads += 1; return "fresh"; });
  assert.equal(await read(), "started");
  assert.equal(await read(), "fresh");
  assert.equal(loads, 1);
});

test("serverFirst: nothing started means every call loads", async () => {
  let loads = 0;
  const read = serverFirst<string>(null, async () => { loads += 1; return "fresh"; });
  await read();
  await read();
  assert.equal(loads, 2);
});

test("serverFirst: React's thenable (its then returns nothing) is still used", async () => {
  let loads = 0;
  const thenable = { then(ok: (v: string) => void) { ok("started"); } } as unknown as PromiseLike<string>;
  const read = serverFirst(thenable, async () => { loads += 1; return "fresh"; });
  assert.equal(await read(), "started");
  assert.equal(loads, 0);
});

test("serverFirst: a started read that failed loads instead", async () => {
  let loads = 0;
  const read = serverFirst(Promise.reject(new Error("down")), async () => { loads += 1; return "fresh"; });
  assert.equal(await read(), "fresh");
  assert.equal(loads, 1);
});
