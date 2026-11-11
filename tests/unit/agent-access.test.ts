import assert from "node:assert/strict";
import { test } from "node:test";

import { describeAgentAccess, presetOf, scopesForPreset } from "../../src/lib/agents/access";

// Report A2 (presets), A6 #5 and A10: one sentence, used by the page, Settings, /me, the MCP card and the CLI.
const NOW = new Date("2026-11-11T00:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

test("each preset maps to its scopes, and back", () => {
  assert.deepEqual(scopesForPreset("full").sort(), ["doc:write", "file:final", "file:read", "file:write", "task:complete", "task:read", "task:write", "workspace:read"]);
  assert.deepEqual(scopesForPreset("small").sort(), ["file:read", "file:write", "task:read", "task:write", "workspace:read"]);
  assert.deepEqual(scopesForPreset("read").sort(), ["file:read", "task:read", "workspace:read"]);
  assert.deepEqual(scopesForPreset("custom", ["doc:write"]).sort(), ["doc:write", "file:read", "file:write", "task:read", "task:write", "workspace:read"]);
  for (const p of ["full", "small", "read"] as const) assert.equal(presetOf(scopesForPreset(p)), p);
  assert.equal(presetOf(scopesForPreset("custom", ["doc:write"])), "custom");
  assert.equal(presetOf([]), "small", "an empty list keeps meaning base (existing tokens)");
});

test("the sentence says who, where, how long, what it does alone and what waits", () => {
  assert.equal(
    describeAgentAccess({ agentName: "Claude Code", workspaceTitle: null, scopes: scopesForPreset("full"), expiresAt: inDays(30), now: NOW }),
    "Claude Code can work in all your workspaces for 30 days. It does small things itself (reading, tasks, comments, drafts) and asks you before finishing tasks, final files, doc edits or deleting.",
  );
  assert.equal(
    describeAgentAccess({ agentName: "Claude Code", workspaceTitle: "Design Lab", scopes: scopesForPreset("read"), expiresAt: inDays(7), now: NOW }),
    "Claude Code can read Design Lab for 7 days. It can't change anything.",
  );
  assert.equal(
    describeAgentAccess({ agentName: "Codex", workspaceTitle: "Design Lab", scopes: scopesForPreset("small"), expiresAt: inDays(30), now: NOW }),
    "Codex can work in Design Lab for 30 days. It does small things itself and can't finish tasks, change final files or edit docs.",
  );
  assert.match(describeAgentAccess({ agentName: "Codex", workspaceTitle: null, scopes: scopesForPreset("full"), expiresAt: inDays(1), now: NOW }), /for 1 day\./);
  assert.equal(
    describeAgentAccess({ agentName: "Codex", workspaceTitle: null, scopes: scopesForPreset("full"), expiresAt: inDays(-1), now: NOW }),
    "Codex's access has ended. Renew it in Settings → Integrations.",
  );
});

test("custom access names exactly what was allowed", () => {
  assert.equal(
    describeAgentAccess({ agentName: "Cursor", workspaceTitle: null, scopes: scopesForPreset("custom", ["file:final"]), expiresAt: inDays(90), now: NOW }),
    "Cursor can work in all your workspaces for 90 days. It does small things itself and asks you before final files or deleting; it can't finish tasks or edit docs.",
  );
});
