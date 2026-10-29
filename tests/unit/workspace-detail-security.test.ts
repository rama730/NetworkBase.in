import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { updateProjectSchema } from "@/lib/validations/workspace";
import { projectActionsSource } from "./_workspace-actions-source";

describe("updateProject input", () => {
  it("accepts the modal and settings payloads", () => {
    assert.equal(updateProjectSchema.safeParse({ title: "Atlas", tags: ["ai"], skills: ["Go"], status: "active" }).success, true);
    assert.equal(updateProjectSchema.safeParse({ memberUpdatesEnabled: false }).success, true);
  });

  it("rejects archive, stage moves, unknown keys, oversized text and non-string tags", () => {
    for (const bad of [
      { status: "archived" },
      { currentStageIndex: 2 },
      { visibility: "public" },
      { title: "x".repeat(101) },
      { shortDescription: "x".repeat(201) },
      { tags: [42] },
      { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
    ]) {
      assert.equal(updateProjectSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
    }
  });
});

describe("project detail security wiring", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("the hydration banner never reads projects directly from the browser", () => {
    const banner = read("src/components/workspaces/HydrationProgressBanner.tsx");
    assert.doesNotMatch(banner, /\.from\("projects"\)/);
    assert.match(banner, /^"use client";/);
    assert.match(banner, /role="progressbar"/);
  });

  it("private projects expire their public shell and metadata at once", () => {
    const actions = projectActionsSource();
    assert.doesNotMatch(actions, /PUBLIC_PROJECT_DETAIL_(SHELL|METADATA)_CACHE_TAG, "max"/);
  });

  it("the tab error boundary never renders a raw error message", () => {
    assert.doesNotMatch(read("src/components/workspaces/TabErrorBoundary.tsx"), /\{this\.state\.error\?\.message/);
  });

  it("the kanban drag gate includes task edit rights", () => {
    assert.match(read("src/components/workspaces/v2/tasks/KanbanBoard.tsx"), /!!canEditTasks &&/);
  });
});
