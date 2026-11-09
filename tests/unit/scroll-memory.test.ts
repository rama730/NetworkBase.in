import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { chooseAnchors, loadRecord, pickAnchor, saveRecord, type ScrollRecord } from "../../src/lib/navigation/scroll-memory";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

const blocked = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

const rec = (top: number): ScrollRecord => ({ top, anchors: ["p:1"], anchorOffset: 12, opened: null, areas: {} });

describe("scroll memory (§3.1, A4, R10, R11)", () => {
  it("save then load", () => {
    const store = memoryStore();
    saveRecord(store, "e1", rec(840));
    assert.deepEqual(loadRecord(store, "e1"), rec(840));
    assert.equal(loadRecord(store, "nope"), null);
  });

  it("cap keeps the newest 50", () => {
    const store = memoryStore();
    for (let i = 0; i < 55; i += 1) saveRecord(store, `e${i}`, rec(i));
    assert.equal(loadRecord(store, "e0"), null);
    assert.equal(loadRecord(store, "e4"), null);
    assert.deepEqual(loadRecord(store, "e5"), rec(5));
    assert.deepEqual(loadRecord(store, "e54"), rec(54));
    assert.equal([...store.map.keys()].filter((k) => k.startsWith("nb-scroll:e")).length, 50);
  });

  it("saving the same entry again moves it to the newest", () => {
    const store = memoryStore();
    for (let i = 0; i < 50; i += 1) saveRecord(store, `e${i}`, rec(i));
    saveRecord(store, "e0", rec(999));
    saveRecord(store, "e50", rec(50));
    assert.deepEqual(loadRecord(store, "e0"), rec(999), "e0 was refreshed, so e1 went instead");
    assert.equal(loadRecord(store, "e1"), null);
  });

  it("blocked storage: save is a no-op and load returns null", () => {
    assert.doesNotThrow(() => saveRecord(blocked, "e1", rec(1)));
    assert.equal(loadRecord(blocked, "e1"), null);
  });

  it("chooseAnchors picks the first visible card and the next four", () => {
    const items = [
      { id: "a", top: -400, bottom: -100 },
      { id: "b", top: -100, bottom: 40 },
      { id: "c", top: 40, bottom: 300 },
      { id: "d", top: 300, bottom: 600 },
      { id: "e", top: 600, bottom: 900 },
      { id: "f", top: 900, bottom: 1200 },
      { id: "g", top: 1200, bottom: 1500 },
    ];
    assert.deepEqual(chooseAnchors(items, 0), { anchors: ["b", "c", "d", "e", "f"], anchorOffset: -100 });
    assert.deepEqual(chooseAnchors([], 0), { anchors: [], anchorOffset: 0 });
  });

  it("pickAnchor skips cards deleted while you were away", () => {
    assert.equal(pickAnchor(["b", "c", "d"], (id) => id !== "b"), "c");
  });

  it("pickAnchor returns null when none exist (pixel fallback)", () => {
    assert.equal(pickAnchor(["b", "c"], () => false), null);
  });

  it("the layout runs it once; Discover's own copy is gone", () => {
    assert.match(fs.readFileSync("src/components/layout/MainLayout.tsx", "utf8"), /useScrollMemory\(\)/);
    const discover = fs.readFileSync("src/components/discover/DiscoverClient.tsx", "utf8");
    assert.doesNotMatch(discover, /discover-scroll:|cameBackByHistory/);
    assert.match(discover, /data-restore-id=/);
  });
});
