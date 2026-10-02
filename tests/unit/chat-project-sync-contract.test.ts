import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lifecycle = readFileSync("src/lib/projects/collaborator-lifecycle.ts", "utf8");

test("a full role expires pending project_invitations for it (not only the old message mirror)", () => {
  assert.match(lifecycle, /\.update\(projectInvitations\)[\s\S]{0,200}status: "expired"[\s\S]{0,400}eq\(projectInvitations\.roleId, params\.roleId\)[\s\S]{0,120}eq\(projectInvitations\.status, "pending"\)/);
});

test("project membership changes sync chat membership behind the flag", () => {
  assert.match(lifecycle, /isChatV3Enabled\(\)[\s\S]{0,200}syncProjectChat\(executor, params\.projectId, params\.userId, "add"\)/);
  assert.match(lifecycle, /isChatV3Enabled\(\)[\s\S]{0,200}syncProjectChat\(executor, params\.projectId, params\.targetUserId, "remove"\)/);
  assert.match(lifecycle, /isChatV3Enabled\(\)[\s\S]{0,200}syncProjectChat\(executor, params\.projectId, params\.targetUserId, "role"\)/);
});
