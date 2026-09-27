import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project access tab eliminates duplicate headers, extra cards, and renders 1 canonical SettingsCard with immediate toggle controls", () => {
  const settingsTab = source("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // SectionHeader is suppressed on access tab
  assert.match(settingsTab, /activeSection !== "access"/, "SectionHeader must be suppressed on access tab to avoid duplicate title");

  // Access section block extraction
  const accessBlock = settingsTab.split('id="project-settings-access"')[1]?.split('id="project-settings-collaborators"')[0] ?? "";
  assert.ok(accessBlock.length > 0, "Access settings block must exist in ProjectSettingsTab");

  // Redundant SummaryCard, AdvancedDisclosure, and unnecessary cards removed
  assert.doesNotMatch(accessBlock, /<SummaryCard/, "Redundant SummaryCard must be removed from Project Access tab");
  assert.doesNotMatch(accessBlock, /<AdvancedDisclosure/, "Redundant AdvancedDisclosure must be removed from Project Access tab");
  assert.doesNotMatch(accessBlock, /title="Viewer access matrix"/, "Viewer access matrix card must be removed from Access tab");
  assert.doesNotMatch(accessBlock, /title="Access impact"/, "Access impact card must be removed from Access tab");

  // Exactly 1 Canonical SettingsCard: "Project access & visibility"
  assert.match(accessBlock, /<SettingsCard[\s\S]*?title="Project access & visibility"/, "Canonical Project access & visibility card must exist");
  const cardMatches = accessBlock.match(/<SettingsCard/g) || [];
  assert.equal(cardMatches.length, 1, "Access tab must render exactly 1 canonical SettingsCard to eliminate extra cards");

  // Inner divide-y divide-border layout
  assert.match(accessBlock, /divide-y divide-border/, "Access tab must use divide-y divide-border between visibility and public surfaces");

  // Non-owner read-only guidance
  assert.match(accessBlock, /Visibility is managed by the project lead/, "Non-owners must see clear visibility guidance");

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
  const settingsTab = source("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // Access Matrix tokens
  const matrixDef = settingsTab.split("function AccessMatrix({")[1]?.split("function AccessImpactGrid({")[0] ?? "";
  assert.ok(matrixDef.length > 0, "AccessMatrix definition must exist");
  assert.match(matrixDef, /overflow-hidden rounded-lg border border-border bg-card/, "AccessMatrix uses border-border and bg-card");
  assert.match(matrixDef, /bg-muted\/40 text-xs font-semibold uppercase tracking-\[0.14em\] text-muted-foreground/, "AccessMatrix header uses drafting tokens");
  assert.match(matrixDef, /bg-primary\/5 font-medium text-foreground/, "Active column highlighted with bg-primary/5 text-foreground");
  assert.doesNotMatch(matrixDef, /blue-/, "AccessMatrix must not contain raw blue classes");
  assert.doesNotMatch(matrixDef, /zinc-/, "AccessMatrix must not contain raw zinc classes");

  // Public tab visibility editor tokens
  const editorDef = settingsTab.split("function PublicTabVisibilityEditor({")[1]?.split("function FileWorkspaceMembers({")[0] ?? "";
  assert.ok(editorDef.length > 0, "PublicTabVisibilityEditor definition must exist");
  assert.match(editorDef, /divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/, "Editor uses divide-y divide-border");
  assert.match(editorDef, /<SettingsSwitch/, "PublicTabVisibilityEditor must use SettingsSwitch component");
  assert.doesNotMatch(editorDef, /blue-/, "PublicTabVisibilityEditor must not contain raw blue classes");
  assert.doesNotMatch(editorDef, /zinc-/, "PublicTabVisibilityEditor must not contain raw zinc classes");

  // TogglePill uses SettingsSwitch
  const toggleDef = settingsTab.split("function TogglePill({")[1]?.split("function PublicTabVisibilityEditor({")[0] ?? "";
  assert.ok(toggleDef.length > 0, "TogglePill definition must exist");
  assert.match(toggleDef, /<SettingsSwitch/, "TogglePill must wrap SettingsSwitch");

  // Access Impact Grid tokens
  const impactGridDef = settingsTab.split("function AccessImpactGrid({")[1]?.split("const PUBLIC_TAB_ORDER")[0] ?? "";
  assert.ok(impactGridDef.length > 0, "AccessImpactGrid definition must exist");
  assert.match(impactGridDef, /rounded-lg border border-border bg-card p-4 shadow-\[0_1px_2px_rgba\(0,0,0,0.03\)\]/, "Impact grid uses border-border bg-card");
  assert.doesNotMatch(impactGridDef, /blue-/, "AccessImpactGrid must not contain raw blue classes");
  assert.doesNotMatch(impactGridDef, /zinc-/, "AccessImpactGrid must not contain raw zinc classes");
});
