import assert from "node:assert/strict";
import test from "node:test";
import { delayedFlagTimeline } from "../../src/lib/ui/delayed-flag";

test("a quick answer never shows the skeleton; a slow one shows it after 300 ms and keeps it at least 400 ms", () => {
  assert.deepEqual(delayedFlagTimeline(200), { shows: false, showAt: null, hideAt: 200 });
  assert.deepEqual(delayedFlagTimeline(320), { shows: true, showAt: 300, hideAt: 700 });
  assert.deepEqual(delayedFlagTimeline(1500), { shows: true, showAt: 300, hideAt: 1500 });
  assert.deepEqual(delayedFlagTimeline(4000, { delay: 0, minVisible: 0 }), { shows: true, showAt: 0, hideAt: 4000 });
});
