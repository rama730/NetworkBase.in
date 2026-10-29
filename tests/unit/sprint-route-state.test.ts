import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorkspaceSprintDetailHref,
} from "@/lib/workspaces/sprint-detail";

describe("sprint canonical routes", () => {
  it("uses a stable human Sprint code instead of a mutable name or UUID", () => {
    assert.equal(
      buildWorkspaceSprintDetailHref("network-for-builders", "sprint-uuid", { sprintCode: "SPR-12" }),
      "/workspaces/network-for-builders?tab=sprints&sprint=SPR-12",
    );
  });

  it("retains a legacy ID fallback while callers migrate to Sprint codes", () => {
    assert.equal(
      buildWorkspaceSprintDetailHref("network-for-builders", "sprint-uuid"),
      "/workspaces/network-for-builders?tab=sprints&sprintId=sprint-uuid",
    );
  });
});
