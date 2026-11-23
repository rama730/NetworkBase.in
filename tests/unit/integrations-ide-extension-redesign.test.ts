import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("IDE & Editor Extensions Redesign Contract", () => {
  it("uses the shared settings structure with universal editor messaging", () => {
    const filePath = path.resolve(process.cwd(), "src/components/settings/IntegrationsSettings.tsx");
    const content = fs.readFileSync(filePath, "utf-8");

    assert.ok(content.includes('title="CLI, agents and editors"'), "Must use the concise settings section title");

    // Universal copy without mentioning specific IDEs in the general card description
    assert.ok(
      content.includes('description="Devices, AI agents and editors signed in to your account."'),
      "Must state universal editor description",
    );

    assert.ok(content.includes("ExtensionAppCard"), "Must identify the NetworkBase editor extension");
    assert.ok(content.includes("SettingsRow"), "Must use shared settings rows");
    assert.ok(!/(?:bg|text|border)-(?:zinc|amber|emerald|blue|red)-/.test(content), "Must use semantic design tokens");

    // Must NOT mention specific IDEs
    assert.ok(
      !content.includes("Connect VS Code, Cursor, Windsurf, or Antigravity"),
      "Must not mention specific IDEs in card description",
    );
  });

  it("Eliminates 'Unknown platform' and 'vpending' by properly handling pending tokens", () => {
    const filePath = path.resolve(process.cwd(), "src/components/settings/IntegrationsSettings.tsx");
    const content = fs.readFileSync(filePath, "utf-8");

    // 'Unknown platform' must not exist in the code
    assert.ok(!content.includes('"Unknown platform"'), "Must not display 'Unknown platform'");

    // Must display 'Awaiting connection' badge for pending tokens
    assert.ok(content.includes("Awaiting connection"), "Must show 'Awaiting connection' for pending tokens");

    // Must show clear pending explanatory status
    assert.ok(
      content.includes("Awaiting initial connection from your editor"),
      "Must state that token is awaiting connection from editor",
    );

    // Button for pending tokens should say 'Revoke token' instead of 'Disconnect'
    assert.ok(content.includes('"Revoke token"'), "Must provide 'Revoke token' action for pending tokens");
  });

  it("Segregates activeSessions and pendingSessions to prevent false active connection counts", () => {
    const filePath = path.resolve(process.cwd(), "src/components/settings/IntegrationsSettings.tsx");
    const content = fs.readFileSync(filePath, "utf-8");

    // Must define activeSessions and pendingSessions
    assert.ok(content.includes("activeSessions"), "Must compute activeSessions");
    assert.ok(content.includes("pendingSessions"), "Must compute pendingSessions");

    // The compact session summary displays both counts.
    assert.ok(
      content.includes("{activeSessions.length} active · {pendingSessions.length} pending"),
      "Session summary must distinguish active and pending sessions",
    );

    // Removed sections per user requirements
    assert.ok(
      !content.includes('uppercase tracking-wider text-zinc-500">Active Connections'),
      "Redundant Active Connections stat block must be removed",
    );
    assert.ok(
      !content.includes('uppercase tracking-wider text-zinc-500">Latest Activity'),
      "Redundant Latest Activity stat block must be removed",
    );
    assert.ok(!content.includes("<RefreshCw"), "Redundant Refresh button must be removed to avoid dual spinner bug");
  });
});
