// Property 4 — versions only grow (2026-11-11, replaces "Restore Monotonicity")
//
// A file is an append-only list of versions plus an active pointer. For any sequence of saves and restores:
//   - a save appends one version numbered after the whole history (nextFileRevisionNumber), based on the active one;
//   - a restore only moves the active pointer to an existing version; the history is unchanged;
//   - version numbers are unique and never reused.

import test from "node:test";
import fc from "fast-check";
import assert from "node:assert/strict";

import { nextFileRevisionNumber } from "../../../../src/lib/files/revision-policy";

type File = { history: Array<{ version: number; basedOn: number | null }>; active: number };

const save = (file: File): File => {
  const version = nextFileRevisionNumber(file.active, Math.max(...file.history.map((v) => v.version)));
  return { history: [...file.history, { version, basedOn: file.active }], active: version };
};
const restore = (file: File, pick: number): File => ({ ...file, active: file.history[pick % file.history.length]!.version });

test("Property 4: saves append after the whole history; restores only move the active version", () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(fc.constant(-1), fc.nat(50)), { minLength: 1, maxLength: 40 }), (steps) => {
      let file: File = { history: [{ version: 1, basedOn: null }], active: 1 };
      for (const step of steps) {
        const before = file;
        file = step === -1 ? save(file) : restore(file, step);
        if (step === -1) {
          const added = file.history.at(-1)!;
          assert.equal(added.version, Math.max(...before.history.map((v) => v.version)) + 1);
          assert.equal(added.basedOn, before.active);
          assert.equal(file.active, added.version);
        } else {
          assert.deepEqual(file.history, before.history, "a restore never adds or changes a version");
          assert.ok(file.history.some((v) => v.version === file.active));
        }
        assert.equal(new Set(file.history.map((v) => v.version)).size, file.history.length, "numbers are never reused");
      }
    }),
    { numRuns: 300 },
  );
});

test("Property 4 regression: going back to v1 of v1..v10 then saving makes v11 based on v1", () => {
  const ten: File = { history: Array.from({ length: 10 }, (_, i) => ({ version: i + 1, basedOn: i || null })), active: 10 };
  const next = save(restore(ten, 0));
  assert.deepEqual(next.history.at(-1), { version: 11, basedOn: 1 });
});
