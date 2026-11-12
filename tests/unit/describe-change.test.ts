import assert from "node:assert/strict";
import { test } from "node:test";

import { describePush } from "../../src/lib/agents/describe-change";

// Report D4 and 0.8 #13 (M4c): the yes prompt names the thing and its size, never "Push 1 file".
test("a README edit names the README and counts the lines, with the diff", () => {
  const d = describePush({ files: [{ path: "/README.md", before: "# App\n\nOld line\n", after: "# App\n\nNew line\nMore\n" }], doc: "README" });
  assert.equal(d.summary, "Change the README (+2 −1 lines)");
  assert.match(d.preview!, /^-Old line$/m);
  assert.match(d.preview!, /^\+New line$/m);
});

test("one file: changed, new, final on a task, and finishing the task", () => {
  assert.equal(describePush({ files: [{ path: "/src/app.ts", before: "a\n", after: "a\nb\n" }] }).summary, "Change /src/app.ts (+1 lines)");
  assert.equal(describePush({ files: [{ path: "/notes.md", before: null, after: "x\ny\n" }] }).summary, "Add /notes.md (2 lines)");
  assert.equal(describePush({ files: [{ path: "/report.pdf", before: null, after: null }], role: "final", taskNumber: 4 }).summary, "Add /report.pdf as the final file on #4");
  assert.equal(describePush({ files: [{ path: "/a.md", before: "a\n", after: "b\n" }], taskNumber: 4, finish: true }).summary, "Change /a.md (+1 −1 lines) and finish #4");
});

test("several files name the first three", () => {
  const files = ["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/e.ts"].map((path) => ({ path, before: null, after: null }));
  assert.equal(describePush({ files }).summary, "Push 5 files: /a.ts, /b.ts, /c.ts and 2 more");
  assert.equal(describePush({ files, role: "final" }).summary, "Push 5 files as final files: /a.ts, /b.ts, /c.ts and 2 more");
});

test("the preview stays short", () => {
  const before = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
  const after = Array.from({ length: 300 }, (_, i) => `row ${i}`).join("\n");
  const d = describePush({ files: [{ path: "/big.txt", before, after }] });
  assert.ok(d.preview!.split("\n").length <= 41);
  assert.match(d.preview!, /… \d+ more lines/);
});
