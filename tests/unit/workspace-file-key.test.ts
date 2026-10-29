import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkspaceFileKey,
  isCanonicalWorkspaceFileKey,
  parseWorkspaceFileKey,
  parseWorkspaceIdFromWorkspaceFileKey,
} from "../../src/lib/storage/workspace-file-key";

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("project file key utilities", () => {
  it("builds canonical keys with normalized path separators", () => {
    const key = buildWorkspaceFileKey(PROJECT_ID, "\\src//app\\main.ts");
    assert.equal(key, `${PROJECT_ID}/src/app/main.ts`);
    assert.equal(isCanonicalWorkspaceFileKey(key), true);
  });

  it("parses canonical keys", () => {
    const parsed = parseWorkspaceFileKey(`${PROJECT_ID}/docs/readme.md`);
    assert.deepEqual(parsed, {
      projectId: PROJECT_ID,
      relativePath: "docs/readme.md",
      format: "canonical",
    });
  });

  it("rejects malformed keys", () => {
    assert.equal(parseWorkspaceFileKey("projects/not-a-uuid/file.txt"), null);
    assert.equal(parseWorkspaceFileKey(""), null);
    assert.equal(parseWorkspaceIdFromWorkspaceFileKey("random/path"), null);
  });
});

