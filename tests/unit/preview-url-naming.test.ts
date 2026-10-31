import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// MAINT-002: these endpoints are ordinary authorized routes, not signed URLs, and carry no expiry.
test("file preview actions are named and shaped for what they do", () => {
  const content = readFileSync("src/app/actions/files/content.ts", "utf8");
  const versions = readFileSync("src/app/actions/files/versions.ts", "utf8");
  assert.match(content, /export async function getFilePreviewUrl\(projectId: string, nodeId: string, download: boolean = false\)/);
  assert.doesNotMatch(versions, /getVersionSignedUrl|expiresAt|clampedTtl/);
  assert.doesNotMatch(content, /expiresAt|clampedTtl/);
  assert.doesNotMatch(content, /getWorkspaceFileSignedUrl/);
});
