import assert from "node:assert/strict";
import test from "node:test";

import { stageCounts, weakTopics } from "@/lib/organizations/prep";

test("weak topics: most mistakes in 30 days, at least 2 each, up to 3", () => {
  const now = new Date("2027-02-10T00:00:00Z");
  const topics = [{ id: "a", name: "True / False / Not given" }, { id: "b", name: "Matching headings" }, { id: "c", name: "Maps" }];
  const m = (topicId: string | null, at: string) => ({ topicId, at });
  const list = [m("a", "2027-02-01"), m("a", "2027-02-05"), m("a", "2027-02-09"), m("b", "2027-02-02"), m("b", "2027-02-03"), m("c", "2027-02-04"), m("c", "2026-12-01"), m(null, "2027-02-09")];
  assert.deepEqual(weakTopics(list, topics, now), [{ id: "a", name: "True / False / Not given", mistakes: 3 }, { id: "b", name: "Matching headings", mistakes: 2 }]);
  assert.deepEqual(weakTopics([], topics, now), []);
});

test("stage counts per topic, counts only", () => {
  const counts = stageCounts([{ topicId: "a", stage: "learning" }, { topicId: "a", stage: "confident" }, { topicId: "a", stage: "learning" }], ["a", "b"]);
  assert.deepEqual(counts.get("a"), { not_started: 0, learning: 2, revised: 0, confident: 1 });
  assert.deepEqual(counts.get("b"), { not_started: 0, learning: 0, revised: 0, confident: 0 });
});
