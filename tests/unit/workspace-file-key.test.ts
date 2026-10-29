import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectFileKey,
  isCanonicalProjectFileKey,
  parseProjectFileKey,
  parseProjectIdFromProjectFileKey,
} from "../../src/lib/storage/workspace-file-key";

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("project file key utilities", () => {
  it("builds canonical keys with normalized path separators", () => {
    const key = buildProjectFileKey(PROJECT_ID, "\\src//app\\main.ts");
    assert.equal(key, `${PROJECT_ID}/src/app/main.ts`);
    assert.equal(isCanonicalProjectFileKey(key), true);
  });

  it("parses canonical keys", () => {
    const parsed = parseProjectFileKey(`${PROJECT_ID}/docs/readme.md`);
    assert.deepEqual(parsed, {
      projectId: PROJECT_ID,
      relativePath: "docs/readme.md",
      format: "canonical",
    });
  });

  it("rejects malformed keys", () => {
    assert.equal(parseProjectFileKey("projects/not-a-uuid/file.txt"), null);
    assert.equal(parseProjectFileKey(""), null);
    assert.equal(parseProjectIdFromProjectFileKey("random/path"), null);
  });
});

