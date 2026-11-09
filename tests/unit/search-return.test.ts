import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { rememberSearchReturn, takeSearchReturn } from "../../src/lib/navigation/search-return";

function memoryStore() {
  const map = new Map<string, string>();
  return {
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

describe("back to your search results (R2)", () => {
  it("take returns it once", () => {
    const store = memoryStore();
    rememberSearchReturn(store, { entryId: "e1", query: "robot", context: "discover", activeIndex: 2 });
    assert.deepEqual(takeSearchReturn(store, "e1"), { entryId: "e1", query: "robot", context: "discover", activeIndex: 2 });
    assert.equal(takeSearchReturn(store, "e1"), null);
  });

  it("a different entry gets nothing (and leaves it for its own entry)", () => {
    const store = memoryStore();
    rememberSearchReturn(store, { entryId: "e1", query: "robot", activeIndex: 0 });
    assert.equal(takeSearchReturn(store, "e2"), null);
    assert.equal(takeSearchReturn(store, "e1")?.query, "robot");
  });

  it("blocked storage returns null without throwing", () => {
    assert.doesNotThrow(() => rememberSearchReturn(blocked, { entryId: "e1", query: "x", activeIndex: 0 }));
    assert.equal(takeSearchReturn(blocked, "e1"), null);
  });

  it("the palette remembers before opening a result, and the top bar reopens it on back", () => {
    const palette = fs.readFileSync("src/components/layout/header/CommandPalette.tsx", "utf8");
    assert.match(palette, /rememberSearchReturn\(/);
    assert.match(palette, /initialActiveIndex/);
    const nav = fs.readFileSync("src/components/layout/header/TopNav.tsx", "utf8");
    assert.match(nav, /takeSearchReturn\(/);
    assert.match(nav, /arrivedByTraverse\(\)/);
  });
});
