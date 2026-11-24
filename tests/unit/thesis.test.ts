import assert from "node:assert/strict";
import { test } from "node:test";

import { countWords, overTarget, readChapter, readThesisSettings, writingTotals } from "../../src/lib/workflows/thesis";

// Plan B1.8a (report 30.6 W5).
test("words count prose only: no code, comments, link targets, marks or the reference list", () => {
  const md = [
    "# 2. Literature review", "", "Graph **neural** networks [beat](https://example.com/very/long/url) baselines.", "",
    "```python", "print('not counted at all')", "```", "", "<!-- a note to self that is not counted -->", "",
    "- one item", "- `inline code` two", "", "> quoted line here", "", "## References", "", "Smith, J. (2020). A paper title. Journal.",
  ].join("\n");
  assert.equal(countWords(md), 3 + 5 + 2 + 1 + 3);
  assert.equal(countWords(""), 0);
  assert.equal(countWords("Word — word, word."), 3, "a dash alone isn't a word");
});

test("chapters read defensively; totals and the 110% line", () => {
  assert.deepEqual(readChapter({ chapter: { number: 3, target: 10000, status: "drafted" } }), { number: 3, target: 10000, status: "drafted" });
  assert.deepEqual(readChapter({ chapter: { number: -1, target: "x", status: "done" } }), { number: 1, target: 6000, status: "not_started" });
  assert.equal(readChapter({}), null);
  assert.deepEqual(writingTotals([{ words: 3100, target: 4000 }, { words: 8200, target: 8000 }]), { words: 11300, target: 12000 });
  assert.deepEqual([overTarget(8800, 8000), overTarget(8801, 8000)], [false, true]);
  assert.deepEqual(readThesisSettings({ thesis: { questions: [" Can GNNs beat …? ", "", 4], supervisorId: "u1" } }), { questions: ["Can GNNs beat …?"], supervisorId: "u1", coSupervisorId: null });
});
