import { test } from "node:test";
import assert from "node:assert/strict";

import { deviceDecisionSchema } from "@/lib/extension/device-decision";

// Found approving an agent sign-in on production (2026-11-10): zod 4 refuses two "approve" options in one
// discriminated union, so every approval at /device failed with "Couldn't save your answer".
test("the /device answer parses for deny, a terminal and an agent, and refuses the rest", () => {
  const workspaceId = "0c48a8ba-51c5-4a1e-91bc-e2248c0a11e0";
  assert.deepEqual(deviceDecisionSchema.parse({ decision: "deny" }), { decision: "deny" });
  assert.deepEqual(deviceDecisionSchema.parse({ decision: "approve", type: "device" }), { decision: "approve", type: "device" });
  const agent = { decision: "approve", type: "agent", access: "custom", workspace: workspaceId, expiryDays: 30, extraScopes: ["doc:write"] };
  assert.deepEqual(deviceDecisionSchema.parse(agent), agent);
  assert.equal(deviceDecisionSchema.safeParse({ ...agent, access: "full", workspace: "all" }).success, true, "All my workspaces");

  assert.equal(deviceDecisionSchema.safeParse({ decision: "approve" }).success, false, "approve needs a type");
  assert.equal(deviceDecisionSchema.safeParse({ ...agent, expiryDays: 365 }).success, false, "only 7, 30 or 90 days");
  assert.equal(deviceDecisionSchema.safeParse({ ...agent, workspace: "nope" }).success, false);
  assert.equal(deviceDecisionSchema.safeParse({ ...agent, extraScopes: ["admin"] }).success, false);
  assert.equal(deviceDecisionSchema.safeParse({ decision: "maybe" }).success, false);
});
