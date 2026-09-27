import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project general settings renders 3 canonical cards and removes redundant overview cards", () => {
  const content = source("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // General tab block extraction
  const generalBlock = content.split('activeSection === "general" && (')[1]?.split('activeSection === "access"')[0] ?? "";
  assert.ok(generalBlock.length > 0, "General settings block must exist");

  // Removed unnecessary overview/disclosure cards
  assert.doesNotMatch(generalBlock, /<SummaryCard/, "SummaryCard (Public identity) must be removed from General settings");
  assert.doesNotMatch(generalBlock, /<AdvancedDisclosure/, "AdvancedDisclosure (Advanced identity notes) must be removed from General settings");

  // 3 Canonical settings cards
  assert.match(generalBlock, /data-testid="project-avatar-settings-card"/, "Must render Project avatar card matching profile summary layout");
  assert.match(generalBlock, /title="Project identity"/, "Must render Project identity card");
  assert.match(generalBlock, /title="Tags and skills"/, "Must render Tags and skills card");

  // Avatar card matches Profile Summary layout:
  // 1. Picture on the left
  assert.match(generalBlock, /relative size-20 sm:size-24 shrink-0 overflow-hidden rounded-lg/, "Project avatar picture must be on the left with rounded-lg frame");
  // 2. Single dropdown button on the right
  assert.match(generalBlock, /<DropdownMenu>/, "Must use DropdownMenu for avatar actions");
  assert.match(generalBlock, /<DropdownMenuTrigger asChild>/, "Must trigger avatar options via DropdownMenuTrigger");
  assert.match(generalBlock, /Avatar options/, "Dropdown button must label avatar options");
  assert.match(generalBlock, /Upload avatar/, "Dropdown menu must offer Upload avatar / Replace avatar");
  assert.match(generalBlock, /Remove avatar/, "Dropdown menu must offer Remove avatar");
  // 3. No separate side-by-side buttons
  assert.doesNotMatch(generalBlock, /\{coverDraft \? "Choose different avatar" : coverImage \? "Replace avatar" : "Upload avatar"\}/, "Must not have legacy separate button bar");

  // Structured divide-y layout in identity and tags/skills cards
  assert.match(generalBlock, /<div className="divide-y divide-border">/, "Must use divide-y divide-border structure inside settings cards");

  // No legacy indigo/blue styling in General
  assert.doesNotMatch(generalBlock, /tone="indigo"/, "Tags chip editor must not use legacy indigo tone");
  assert.doesNotMatch(generalBlock, /border-blue-200/, "Avatar draft cropper must not use blue borders");
  assert.doesNotMatch(generalBlock, /text-blue-700/, "Avatar draft cropper must not use blue text");

  // Form controls & labels
  assert.match(content, /function SettingsCard\(\{[\s\S]*?rounded-lg border bg-card/);
  assert.match(content, /border-b border-border p-6/);
  assert.match(content, /nb-card-title/);
  assert.match(content, /nb-ui-label/);
  assert.match(content, /nb-compact/);
  assert.match(content, /border border-border/);
  assert.match(content, /rounded-md/);
});

test("project general settings removes duplicate header card and renders card-level Save Changes and Cancel buttons", () => {
  const content = source("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // Duplicate header card removed from general tab
  assert.match(content, /activeSection !== "general"/, "SectionHeader must be skipped for General tab to avoid duplicate header");
  assert.doesNotMatch(content, /data-testid="project-settings-dirty-banner"/, "Header dirty banner must be removed in favor of card footers");

  // General tab block extraction
  const generalBlock = content.split('activeSection === "general" && (')[1]?.split('activeSection === "access"')[0] ?? "";
  assert.match(generalBlock, /Save changes/, "General settings cards must provide Save changes button in footer");
  assert.match(generalBlock, /Cancel/, "General settings cards must provide Cancel button in footer");
});

test("project settings sidebar and header follow NetworkBase layout standards", () => {
  const content = source("src/components/projects/tabs/ProjectSettingsTab.tsx");

  assert.match(content, /max-w-\[1320px\]/, "Settings container max width must be 1320px matching Layout Pattern G");
  assert.match(content, /border-border bg-card/, "Sidebar aside must use semantic border and card background");
  assert.match(content, /bg-muted font-medium text-foreground/, "Active nav item must use bg-muted and text-foreground");
  assert.match(content, /text-muted-foreground hover:bg-muted hover:text-foreground/, "Inactive nav item must use muted foreground with hover muted");
});
