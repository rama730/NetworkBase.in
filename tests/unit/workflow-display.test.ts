import assert from "node:assert/strict";
import { test } from "node:test";

import { rememberedTick, showsIn, stageMenu, typeChip } from "../../src/lib/workflows/display";

// Report 38.2 F1 S4, S5, S7 (plan A0.10): the type chip, Shows in, the Stage menu and the remembered sprint tick.
test("typeChip: Bug · Fixing, Blocked added on the board, nothing for a task", () => {
  assert.equal(typeChip("bug", "fixing", "in_progress"), "Bug · Fixing");
  assert.equal(typeChip("bug", "fixing", "blocked"), "Bug · Fixing · Blocked");
  assert.equal(typeChip(undefined, null, "todo"), null);
  assert.equal(typeChip("task", null, "todo"), null);
});

test("showsIn: Tasks only while on the board, then the own tab with the stage", () => {
  assert.deepEqual(showsIn("bug", "fixing", "in_progress"), [{ tab: "tasks", label: "Tasks · In progress" }, { tab: "bugs", label: "Bugs · Fixing" }]);
  assert.deepEqual(showsIn("bug", "confirmed", "todo"), [{ tab: "bugs", label: "Bugs · Confirmed" }]);
  assert.deepEqual(showsIn(undefined, null, "todo"), []);
});

test("stageMenu: the own tab's stages, then On the board", () => {
  assert.deepEqual(stageMenu("bug").map((g) => [g.label, g.stages.map((s) => s.key)]), [
    ["Bugs", ["new", "confirmed", "wont_fix", "duplicate", "cant_reproduce"]], ["On the board", ["fixing", "fixed", "verified"]],
  ]);
});

test("rememberedTick: ticked by default; a choice lasts 24 hours", () => {
  const now = 1_000_000_000;
  assert.equal(rememberedTick(null, now), true);
  assert.equal(rememberedTick(JSON.stringify({ tick: false, at: now - 1000 }), now), false);
  assert.equal(rememberedTick(JSON.stringify({ tick: false, at: now - 25 * 3600_000 }), now), true);
  assert.equal(rememberedTick("not json", now), true);
});
