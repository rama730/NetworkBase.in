import assert from "node:assert/strict";
import { test } from "node:test";

import { runInFlightDeduped } from "../../src/lib/utils/inflight-dedupe";

// A shared in-flight promise must never outlive its window: one call that never settles once kept every later
// call with the same key waiting until the server restarted (Discover hung for one account, 2026-10-30).

test("identical calls inside the window share one task", async () => {
  let runs = 0;
  const task = async () => { runs += 1; await new Promise((r) => setTimeout(r, 20)); return runs; };
  const [a, b] = await Promise.all([runInFlightDeduped("same", task), runInFlightDeduped("same", task)]);
  assert.equal(runs, 1);
  assert.equal(a, b);
});

test("a task that never settles stops being shared after the window, so the next call runs fresh", async () => {
  let runs = 0;
  const stuck = () => { runs += 1; return new Promise<string>(() => undefined); };
  void runInFlightDeduped("poisoned", stuck, 30);
  await new Promise((r) => setTimeout(r, 60));
  const fresh = await runInFlightDeduped("poisoned", async () => { runs += 1; return "ok"; }, 30);
  assert.equal(fresh, "ok");
  assert.equal(runs, 2);
});

test("a failed task is not shared with the next call", async () => {
  await assert.rejects(runInFlightDeduped("fails", async () => { throw new Error("boom"); }));
  assert.equal(await runInFlightDeduped("fails", async () => "ok"), "ok");
});
