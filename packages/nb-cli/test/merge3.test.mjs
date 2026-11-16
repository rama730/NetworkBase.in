import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isMergeableText, merge3 } from "../lib/sync/merge3.mjs";

// Report G9, G22: three-way merge properties, line endings and text detection.
const lines = (/** @type {number} */ n, /** @type {string} */ p = "line") => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`).join("\n") + "\n";

describe("merge3 (G9)", () => {
  it("no change on one side gives the other side", () => {
    const base = lines(20);
    const changed = base.replace("line 7", "line seven");
    assert.deepEqual(merge3(base, base, changed), { ok: true, text: changed });
    assert.deepEqual(merge3(base, changed, base), { ok: true, text: changed });
    assert.deepEqual(merge3(base, changed, changed), { ok: true, text: changed });
  });

  it("changes in different places both land", () => {
    const base = lines(20);
    const theirs = base.replace("line 2\n", "line two\n");
    const mine = base.replace("line 18\n", "line eighteen\n").replace("line 10\n", "line 10\nadded after ten\n");
    const r = merge3(base, theirs, mine);
    assert.equal(r.ok, true);
    assert.equal(/** @type {any} */ (r).text, base.replace("line 2\n", "line two\n").replace("line 18\n", "line eighteen\n").replace("line 10\n", "line 10\nadded after ten\n"));
  });

  it("overlapping or touching edits always conflict (property, 300 random cases)", () => {
    let seed = 7;
    const rand = (/** @type {number} */ n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 300; k++) {
      const base = lines(30).split("\n");
      const at = 1 + rand(25);
      const theirs = [...base]; theirs[at] = `theirs ${k}`;
      const mine = [...base]; mine[at + rand(2)] = `mine ${k}`;
      const r = merge3(base.join("\n"), theirs.join("\n"), mine.join("\n"));
      assert.equal(r.ok, false, `case ${k} at ${at}`);
    }
  });

  it("random edits far apart merge, and the result contains both", () => {
    let seed = 11;
    const rand = (/** @type {number} */ n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 200; k++) {
      const base = lines(60).split("\n");
      const a = 2 + rand(20);
      const b = 35 + rand(20);
      const theirs = [...base]; theirs[a] = `T${k}`;
      const mine = [...base]; mine[b] = `M${k}`;
      const r = /** @type {any} */ (merge3(base.join("\n"), theirs.join("\n"), mine.join("\n")));
      assert.equal(r.ok, true, `case ${k}`);
      assert.ok(r.text.includes(`T${k}`) && r.text.includes(`M${k}`));
    }
  });

  it("line endings follow theirs; a final newline stays as it was", () => {
    const base = "a\nb\nc\nd\n";
    const theirs = "a\r\nB\r\nc\r\nd\r\n";
    const mine = "a\nb\nc\nD\n";
    assert.deepEqual(merge3(base, theirs, mine), { ok: true, text: "a\r\nB\r\nc\r\nD\r\n" });
    assert.deepEqual(merge3("a\nb\nc", "A\nb\nc", "a\nb\nC"), { ok: true, text: "A\nb\nC" });
  });

  it("text detection: zero bytes, invalid UTF-8 and over 1 MB are not mergeable", () => {
    assert.equal(isMergeableText(Buffer.from("hello\n")), true);
    assert.equal(isMergeableText(Buffer.from([0x68, 0x00, 0x69])), false);
    assert.equal(isMergeableText(Buffer.from([0xff, 0xfe, 0xfd])), false);
    assert.equal(isMergeableText(Buffer.alloc(1024 * 1024 + 1, 0x61)), false);
  });
});
