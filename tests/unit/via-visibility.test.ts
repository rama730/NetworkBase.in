import assert from "node:assert/strict";
import { test } from "node:test";

import { visibleVia, type LabelScope } from "../../src/lib/agents/via-visibility";

// Report Part B: each setting × each viewer (the person, a teammate, the owner, an organization reviewer).
const row = { via: "agent", agentName: "Claude Code", authorId: "person" };
const scope = (setting: LabelScope["setting"], viewerId: string, extra: Partial<LabelScope> = {}): LabelScope => ({ setting, orgForced: false, viewerId, viewerStaff: false, ...extra });
const sees = (s: LabelScope) => visibleVia(s, row).via === "agent";

test("Everyone: all viewers see it; Only the person: just the person; No one: nobody", () => {
  const viewers = ["person", "teammate", "owner"];
  assert.deepEqual(viewers.map((v) => sees(scope("everyone", v))), [true, true, true]);
  assert.deepEqual(viewers.map((v) => sees(scope("person", v))), [true, false, false]);
  assert.deepEqual(viewers.map((v) => sees(scope("none", v))), [false, false, false]);
});

test("where the class asks, reviewers always see it; the setting still applies to everyone else", () => {
  for (const setting of ["everyone", "person", "none"] as const) {
    assert.equal(sees(scope(setting, "reviewer", { orgForced: true, viewerStaff: true })), true, setting);
    assert.equal(sees(scope(setting, "classmate", { orgForced: true })), setting === "everyone", setting);
  }
  assert.equal(sees(scope("none", "reviewer", { viewerStaff: true })), false, "staff aren't forced where the class allows AI");
});

test("hidden means both fields are empty, and work made in the app has no label", () => {
  assert.deepEqual(visibleVia(scope("none", "teammate"), row), { via: null, agentName: null });
  assert.deepEqual(visibleVia(scope("everyone", "x"), { via: null, agentName: "stale" }), { via: null, agentName: null });
  assert.deepEqual(visibleVia(scope("everyone", "x"), { via: "cli", agentName: "ignored" }), { via: "cli", agentName: null });
});
