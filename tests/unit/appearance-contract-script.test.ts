import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateAppearanceContract } from "../../scripts/check-appearance-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const requiredFiles = [
  "src/components/layout/header/NavLink.tsx",
  "src/components/layout/header/TopNav.tsx",
  "src/components/layout/header/MobileMenu.tsx",
  "src/components/discover/DiscoverHeader.tsx",
  "src/components/messages/ChatLauncher.tsx",
  "src/components/messages/Composer.tsx",
  "src/components/messages/ConversationView.tsx",
  "src/components/settings/AppearanceSettings.tsx",
  "src/components/workspaces/dashboard/WorkspaceLayout.tsx",
  "src/components/workspaces/dashboard/WorkspaceOverviewCard.tsx",
  "src/components/workspaces/v2/TasksTab.tsx",
  "src/components/profile/v2/ProfileHeader.tsx",
];

describe("check-appearance-contract script", () => {
  it("passes when core appearance files use semantic tokens", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-contract-pass-"));
    for (const filePath of requiredFiles) {
      write(path.join(tmp, filePath), `export const ok = "app-selected-surface app-accent-solid text-primary";`);
    }

    const result = validateAppearanceContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when a core file reintroduces gradient-action or hardcoded accent classes", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-contract-fail-"));
    for (const filePath of requiredFiles) {
      write(path.join(tmp, filePath), `export const ok = "app-selected-surface";`);
    }
    write(
      path.join(tmp, "src/components/discover/DiscoverHeader.tsx"),
      `export const bad = "app-accent-gradient-horizontal bg-indigo-600 text-white";`,
    );

    const result = validateAppearanceContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("app-accent-gradient-horizontal")));
    assert.ok(result.errors.some((line) => line.includes("hardcoded blue/indigo/purple utility classes")));
  });
});
