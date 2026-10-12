import assert from "node:assert/strict";
import { test } from "node:test";

import { extractFoldersFromDataTransfer, FOLDER_DROP_LIMITS } from "../../src/lib/files/folder-drop";

type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, err?: (e: unknown) => void) => void; createReader?: () => unknown };
const file = (name: string, readable = true): Entry => ({
  isFile: true, isDirectory: false, name,
  file: (ok, err) => (readable ? ok(new File(["x"], name)) : err?.(new Error("denied"))),
});
// A directory whose reader hands out `count` generated children in batches, counting what was enumerated.
function dir(name: string, count: number, stats: { listed: number }, make: (i: number) => Entry = (i) => file(`f${i}`), batch = 100): Entry {
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => {
      let index = 0;
      return {
        readEntries: (ok: (entries: Entry[]) => void) => {
          const slice: Entry[] = [];
          while (slice.length < batch && index < count) slice.push(make(index++));
          stats.listed += slice.length;
          ok(slice);
        },
      };
    },
  };
}
const drop = (...entries: Entry[]) => ({ items: entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => null })), files: [] }) as unknown as DataTransfer;

// API-020
test("enumeration stops as soon as the entry ceiling is crossed", async () => {
  const stats = { listed: 0 };
  await assert.rejects(extractFoldersFromDataTransfer(drop(dir("huge", 1_000_000, stats, (i) => file(`f${i}`)))), /more than 25,000 items|limited to 5,000 files/);
  assert.ok(stats.listed < FOLDER_DROP_LIMITS.maxEntries + 500, `listed ${stats.listed}`);
});

test("the budget is shared across every dropped root", async () => {
  const stats = { listed: 0 };
  await assert.rejects(extractFoldersFromDataTransfer(drop(dir("a", 4_000, stats), dir("b", 4_000, stats))), /limited to 5,000 files/);
});

test("an aborted signal stops the walk", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(extractFoldersFromDataTransfer(drop(dir("a", 10, { listed: 0 })), { signal: controller.signal }));
});

// API-022
test("unreadable files are reported, readable ones are kept, empty folders stay", async () => {
  const stats = { listed: 0 };
  const names = ["ok1", "secret", "ok2"];
  const result = await extractFoldersFromDataTransfer(drop(
    dir("proj", 3, stats, (i) => file(names[i]!, names[i] !== "secret")),
    dir("empty", 0, stats),
    file("loose.txt"),
    file("bad.txt", false),
  ));
  assert.deepEqual(result.folders.map((f) => [f.name, f.files.map((x) => x.relativePath)]), [["proj", ["ok1", "ok2"]], ["empty", []]]);
  assert.deepEqual(result.looseFiles.map((f) => f.name), ["loose.txt"]);
  assert.deepEqual(result.unreadable.sort(), ["bad.txt", "secret"]);
});
