import assert from "node:assert/strict";
import test from "node:test";
import {
  setFileContent,
  getFileContent,
  deleteFileContent,
  clearWorkspaceContent,
} from "../../../src/stores/files/contentMap";

test("detached contentMap stores and retrieves file content", () => {
  clearWorkspaceContent("p1");
  setFileContent("p1", "n1", "hello world");
  assert.equal(getFileContent("p1", "n1"), "hello world");
  assert.equal(getFileContent("p1", "unknown"), "");
});

test("detached contentMap handles delete and project clearing", () => {
  setFileContent("p1", "n1", "content 1");
  setFileContent("p1", "n2", "content 2");
  setFileContent("p2", "n3", "content 3");

  deleteFileContent("p1", "n1");
  assert.equal(getFileContent("p1", "n1"), "");
  assert.equal(getFileContent("p1", "n2"), "content 2");
  assert.equal(getFileContent("p2", "n3"), "content 3");

  clearWorkspaceContent("p1");
  assert.equal(getFileContent("p1", "n2"), "");
  assert.equal(getFileContent("p2", "n3"), "content 3");
  clearWorkspaceContent("p2");
});

test("detached contentMap refuses files larger than MAX_CONTENT_MAP_BYTES (25MB)", () => {
  clearWorkspaceContent("p_huge");
  // 13 million characters * 2 bytes = 26MB > 25MB ceiling
  const hugeContent = "x".repeat(13 * 1024 * 1024 + 1);
  setFileContent("p_huge", "n_huge", hugeContent);
  // Must NOT be stored
  assert.equal(getFileContent("p_huge", "n_huge"), "");
});

test("detached contentMap LRU eviction respects MAX_CONTENT_MAP_FILES limit", () => {
  clearWorkspaceContent("p_lru");
  for (let i = 0; i < 55; i++) {
    setFileContent("p_lru", `node_${i}`, `content_${i}`);
  }
  // Max files is 50, so earliest 5 should have been evicted
  assert.equal(getFileContent("p_lru", "node_0"), "");
  assert.equal(getFileContent("p_lru", "node_4"), "");
  assert.equal(getFileContent("p_lru", "node_5"), "content_5");
  assert.equal(getFileContent("p_lru", "node_54"), "content_54");
  clearWorkspaceContent("p_lru");
});
