import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project access tab renders one open access section with immediate toggle controls", () => {
  const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // SectionHeader is suppressed on access tab
  assert.match(settingsTab, /id="project-settings-access"/, "SectionHeader must be suppressed on access tab to avoid duplicate title");

  // Access section block extraction
  const accessBlock = settingsTab.split('id="project-settings-access"')[1]?.split('id="project-settings-collaborators"')[0] ?? "";
  assert.ok(accessBlock.length > 0, "Access settings block must exist in ProjectSettingsTab");

  // Redundant SummaryCard, AdvancedDisclosure, and unnecessary cards removed
  assert.doesNotMatch(accessBlock, /<SummaryCard/, "Redundant SummaryCard must be removed from Project Access tab");
  assert.doesNotMatch(accessBlock, /<AdvancedDisclosure/, "Redundant AdvancedDisclosure must be removed from Project Access tab");
  assert.doesNotMatch(accessBlock, /title="Viewer access matrix"/, "Viewer access matrix card must be removed from Access tab");
  assert.doesNotMatch(accessBlock, /title="Access impact"/, "Access impact card must be removed from Access tab");

  // Exactly 1 Canonical SettingsCard: "Workspace access and visibility"
  assert.match(accessBlock, /<SettingsCard[\s\S]*?title="Workspace access and visibility"/, "Canonical Workspace access and visibility card must exist");
  const cardMatches = accessBlock.match(/<SettingsCard/g) || [];
  assert.equal(cardMatches.length, 1, "Access tab must render exactly 1 canonical SettingsCard to eliminate extra cards");

  // Inner divide-y divide-border layout
  assert.match(accessBlock, /divide-y divide-border/, "Access tab must use divide-y divide-border between visibility and public surfaces");

  // Non-owner read-only guidance
  assert.match(accessBlock, /Only the owner can change visibility/, "Non-owners must see clear visibility guidance");

  // Selected state tokens & NO radio dot
  assert.match(accessBlock, /border-primary bg-primary\/5/, "Selected visibility option uses border-primary and bg-primary/5 tint");
  assert.match(accessBlock, /border-border bg-card/, "Unselected visibility option uses semantic tokens");
  assert.doesNotMatch(accessBlock, /<span className="h-2 w-2 rounded-full bg-primary"/, "Must not display dot when visibility option is selected");

  // Immediate toggle apply without bottom Save changes / Cancel buttons
  assert.doesNotMatch(accessBlock, /Save changes/, "Access card must not require Save changes button; toggles apply immediately");
  assert.doesNotMatch(accessBlock, /Cancel/, "Access card must not require Cancel button; toggles apply immediately");
  assert.match(accessBlock, /savingTabId=\{savingPublicTabId\}/, "PublicTabVisibilityEditor must receive savingTabId for immediate feedback");
});

test("project access tab components adhere to NetworkBase drafting-table design tokens and switch controls", () => {
  const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // Public tab visibility editor tokens
  const editorDef = settingsTab.split("function PublicTabVisibilityEditor({")[1]?.split("function FileAccessMembers({")[0] ?? "";
  assert.ok(editorDef.length > 0, "PublicTabVisibilityEditor definition must exist");
  assert.match(editorDef, /divide-y divide-border/, "Editor uses divide-y divide-border");
  assert.match(editorDef, /<SettingsSwitch/, "PublicTabVisibilityEditor must use SettingsSwitch component");
  assert.doesNotMatch(editorDef, /blue-/, "PublicTabVisibilityEditor must not contain raw blue classes");
  assert.doesNotMatch(editorDef, /zinc-/, "PublicTabVisibilityEditor must not contain raw zinc classes");
});
