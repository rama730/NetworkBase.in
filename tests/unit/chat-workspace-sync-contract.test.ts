import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lifecycle = readFileSync("src/lib/workspaces/collaborator-lifecycle.ts", "utf8");

test("a full role expires pending project_invitations for it (not only the old message mirror)", () => {
  assert.match(lifecycle, /\.update\(projectInvitations\)[\s\S]{0,200}status: "expired"[\s\S]{0,400}eq\(projectInvitations\.roleId, params\.roleId\)[\s\S]{0,120}eq\(projectInvitations\.status, "pending"\)/);
});

test("project membership changes always sync chat membership", () => {
  assert.match(lifecycle, /syncWorkspaceChat\(executor, params\.projectId, params\.userId, "add"\)/);
  assert.match(lifecycle, /syncWorkspaceChat\(executor, params\.projectId, params\.targetUserId, "remove"\)/);
  assert.match(lifecycle, /syncWorkspaceChat\(executor, params\.projectId, params\.targetUserId, "role"\)/);
  assert.doesNotMatch(lifecycle, /isChatV3Enabled|conversationParticipants|messageWorkflowItems/);
});
