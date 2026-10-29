import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

const projectActionsText = projectActionsSource();
const projectActionsBarrelSource = projectActionsSource();
const sprintDataHookSource = fs.readFileSync(
  path.join(process.cwd(), "src/hooks/workspaces/useWorkspaceTasksData.ts"),
  "utf8",
);

describe("sprint member access contract", () => {
  it("resolves server-rendered sprint detail with the current actor", () => {
    assert.match(
      projectActionsText,
      /resolveWorkspaceDetailTarget\(\s*input\.slugOrId,\s*input\.actorUserId\s*\?\?\s*null,?\s*\)/,
      "readWorkspaceSprintDetail must pass actorUserId so project membership is included in the workspace lookup",
    );
  });

  it("exports the authenticated sprint detail action for client refetches", () => {
    assert.match(
      projectActionsText,
      /export async function fetchWorkspaceSprintDetailAction\(input:\s*\{\s*projectId:\s*string;/s,
      "the authenticated project-id action should exist for client sprint detail queries",
    );
    assert.match(
      projectActionsBarrelSource,
      /\bfetchWorkspaceSprintDetailAction\b/,
      "the workspace action barrel must expose fetchWorkspaceSprintDetailAction directly",
    );
    assert.doesNotMatch(
      projectActionsBarrelSource,
      /readWorkspaceSprintDetail\s+as\s+fetchWorkspaceSprintDetailAction/,
      "the client fetch alias must not point at the actorless readWorkspaceSprintDetail path",
    );
  });

  it("requests sprint detail through projectId instead of the slug-based reader", () => {
    assert.match(
      sprintDataHookSource,
      /fetchWorkspaceSprintDetailAction\(\{\s*projectId:\s*normalizedProjectId,/s,
      "client first-page sprint queries should call the authenticated action with projectId",
    );
    assert.doesNotMatch(
      sprintDataHookSource,
      /fetchWorkspaceSprintDetailAction\(\{\s*slugOrId:/s,
      "client sprint detail queries should not use the slug reader through the action barrel",
    );
  });
});
