import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSessionDraft, writeSessionDraft } from "../../src/hooks/useSessionDraft";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

const blocked = {
  getItem: (): string | null => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

describe("session draft", () => {
  it("write then read", () => {
    const store = memoryStore();
    writeSessionDraft(store, "draft:task-comment:t1", "half a thought");
    assert.equal(readSessionDraft(store, "draft:task-comment:t1"), "half a thought");
    assert.equal(readSessionDraft(store, "draft:task-comment:t2"), null);
  });

  it("empty removes", () => {
    const store = memoryStore();
    writeSessionDraft(store, "k", "text");
    writeSessionDraft(store, "k", "");
    assert.equal(store.map.has("k"), false);
    assert.equal(readSessionDraft(store, "k"), null);
  });

  it("blocked storage returns null without throwing", () => {
    assert.doesNotThrow(() => writeSessionDraft(blocked, "k", "text"));
    assert.doesNotThrow(() => writeSessionDraft(blocked, "k", ""));
    assert.equal(readSessionDraft(blocked, "k"), null);
  });
});
