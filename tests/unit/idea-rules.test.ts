import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.13 D4 part 7 (plan A5.3): ideas rules.
test("iceScore: the product of 1–5 scores; missing → null", async () => {
  const { iceScore } = await import("../../src/lib/workflows/ideas");
  assert.equal(iceScore(4, 3, 2), 24);
  assert.equal(iceScore(5, 5, 5), 125);
  assert.equal(iceScore(4, null, 2), null);
  assert.equal(iceScore(undefined, 3, 2), null);
});

test("rankIdeas: score desc; ties by confidence then oldest; unscored last; Dropped left out", async () => {
  const { rankIdeas } = await import("../../src/lib/workflows/ideas");
  const i = (id: string, impact: number | null, ease: number | null, confidence: number | null, createdAt: string, stage = "idea") => ({ id, impact, ease, confidence, createdAt, stage });
  const ranked = rankIdeas([
    i("a", 2, 2, 2, "2027-01-01"), i("b", 4, 3, 2, "2027-01-02"), i("c", 3, 4, 2, "2027-01-01"), i("d", 2, 4, 3, "2027-01-03"),
    i("e", null, null, null, "2026-12-01"), i("f", 5, 5, 5, "2027-01-01", "dropped"),
  ]);
  assert.deepEqual(ranked.map((x) => [x.id, x.score, x.rank]), [["d", 24, 1], ["c", 24, 2], ["b", 24, 3], ["a", 8, 4], ["e", null, null]]);
});

test("launchedFromBuilt: a completed task or project, or a launched roadmap item; canceled stays Building", async () => {
  const { launchedFromBuilt } = await import("../../src/lib/workflows/ideas");
  assert.equal(launchedFromBuilt({ itemType: "task", status: "done", stage: null }), true);
  assert.equal(launchedFromBuilt({ itemType: "project", status: "done", stage: "completed" }), true);
  assert.equal(launchedFromBuilt({ itemType: "project", status: "done", stage: "cancelled" }), false);
  assert.equal(launchedFromBuilt({ itemType: "roadmap_item", status: "done", stage: "launched" }), true);
  assert.equal(launchedFromBuilt({ itemType: "roadmap_item", status: "done", stage: "wont_do" }), false);
  assert.equal(launchedFromBuilt({ itemType: "task", status: "in_progress", stage: null }), false);
});

test("ideasMarkdown and the ranked block; validation steps default", async () => {
  const { ideasMarkdown, validationSteps } = await import("../../src/lib/workflows/ideas");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  assert.deepEqual(parseLiveBlocks(ideasMarkdown()).map((b) => b.kind), ["ideas"]);
  assert.match(ideasMarkdown(), /^# Ideas\n\n_/);
  assert.deepEqual(validationSteps(null), ["Talk to 5 people", "Landing page", "First sign-up"]);
  assert.deepEqual(validationSteps({ steps: ["Survey", " ", "Prototype"] }), ["Survey", "Prototype"]);
});
