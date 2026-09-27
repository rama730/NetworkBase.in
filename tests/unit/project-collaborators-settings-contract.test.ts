import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project collaborators tab eliminates duplicate headers and renders a single unified canonical SettingsCard", () => {
  const settingsTab = source("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // SectionHeader is suppressed on collaborators tab to avoid duplicate title
  assert.match(settingsTab, /activeSection !== "collaborators"/, "SectionHeader must be suppressed on collaborators tab to avoid duplicate title");

  // Extract collaborators section block
  const collaboratorsBlock = settingsTab.split('activeSection === "collaborators" && (')[1]?.split('activeSection === "roles-applications"')[0] ?? "";
  assert.ok(collaboratorsBlock.length > 0, "Collaborators settings block must exist in ProjectSettingsTab");

  // Redundant SummaryCard, AdvancedDisclosure, and Role summary removed
  assert.doesNotMatch(collaboratorsBlock, /<SummaryCard/, "Redundant SummaryCard must be removed from Project Collaborators tab");
  assert.doesNotMatch(collaboratorsBlock, /<AdvancedDisclosure/, "Redundant AdvancedDisclosure must be removed from Project Collaborators tab");
  assert.doesNotMatch(collaboratorsBlock, /title="Role summary"/, "Redundant Role summary card must be removed from Collaborators tab");

  // Exactly 1 Canonical SettingsCard: "Collaborators"
  assert.match(collaboratorsBlock, /<SettingsCard[\s\S]*?title="Collaborators"/, "Unified Collaborators card must exist");
  const cardMatches = collaboratorsBlock.match(/<SettingsCard/g) || [];
  assert.equal(cardMatches.length, 1, "Collaborators tab must render exactly 1 unified canonical SettingsCard instead of multiple cards");

  // Structured sub-sections inside the single card
  assert.match(collaboratorsBlock, /Project Leadership/, "Must contain Project Leadership sub-section");
  assert.match(collaboratorsBlock, /Team Directory/, "Must contain Team Directory sub-section");
  assert.match(collaboratorsBlock, /No co-leaders assigned/, "Leadership block must have clean empty state for co-leaders");

  // Team search input, role filter pills, and empty state
  assert.match(collaboratorsBlock, /aria-label="Filter collaborators by role"/, "Role filter tablist must exist");
  assert.match(collaboratorsBlock, /aria-label="Search collaborators"/, "Collaborator search input must exist");
  assert.match(collaboratorsBlock, /No collaborators found/, "Team Directory must have empty state when filtered");
});

test("CollaboratorCard adheres to NetworkBase drafting-table design tokens, squared UserAvatar, and single Actions DropdownMenu", () => {
  const settingsTab = source("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // Extract CollaboratorCard definition
  const cardDef = settingsTab.split("function CollaboratorCard({")[1]?.split("function ProjectNotificationPresetButton({")[0] ?? "";
  assert.ok(cardDef.length > 0, "CollaboratorCard definition must exist");

  // Uses squared UserAvatar per NetworkBase drafting-table standards
  assert.match(cardDef, /<UserAvatar[\s\S]*?identity=\{[\s\S]*?size=\{44\}[\s\S]*?roundedClassName="rounded-(?:\[5px\]|md)"/, "CollaboratorCard must use squared UserAvatar with 44px size and squared radius");

  // Uses single Actions DropdownMenu instead of <details>
  assert.doesNotMatch(cardDef, /<details/, "CollaboratorCard must not use unstyled <details> accordion");
  assert.match(cardDef, /<DropdownMenu[\s\S]*?<DropdownMenuTrigger[\s\S]*?Actions[\s\S]*?<ChevronDown/, "CollaboratorCard must render single Actions DropdownMenu");

  // Actions menu contains role changes, transfer, notifications, and remove
  assert.match(cardDef, /Change role to/, "DropdownMenu must include role change options");
  assert.match(cardDef, /Transfer ownership/, "DropdownMenu must include Transfer ownership when permitted");
  assert.match(cardDef, /Notification settings/, "DropdownMenu must include Notification settings");
  assert.match(cardDef, /Remove member/, "DropdownMenu must include Remove member when permitted");

  // Semantic tokens without raw zinc or blue classes
  assert.doesNotMatch(cardDef, /zinc-/, "CollaboratorCard must not use raw zinc classes");
  assert.doesNotMatch(cardDef, /blue-/, "CollaboratorCard must not use raw blue classes");
  assert.match(cardDef, /nb-ui-label/, "DisplayName uses nb-ui-label");
  assert.match(cardDef, /nb-compact/, "Subtitle uses nb-compact");
  assert.match(cardDef, /nb-meta/, "JoinedAt uses nb-meta");
  assert.match(cardDef, /nb-tag/, "Responsibility hints use nb-tag");
  assert.match(cardDef, /h-5 px-\[7px\] rounded-\[3px\] font-mono text-\[11px\]/, "Role badges must use Section 10 rectangular badge contract");
  assert.doesNotMatch(cardDef, /rounded-full/, "CollaboratorCard must not use circular rounded-full badges");
});
