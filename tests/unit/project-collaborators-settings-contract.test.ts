import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project collaborators tab eliminates duplicate headers and renders one unified open section", () => {
  const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // SectionHeader is suppressed on collaborators tab to avoid duplicate title
  assert.match(settingsTab, /id="project-settings-collaborators"/, "SectionHeader must be suppressed on collaborators tab to avoid duplicate title");

  // Extract collaborators section block
  const collaboratorsBlock = settingsTab.split('id="project-settings-collaborators"')[1]?.split('id="project-settings-roles-applications"')[0] ?? "";
  assert.ok(collaboratorsBlock.length > 0, "Collaborators settings block must exist in ProjectSettingsTab");

  // Redundant SummaryCard, AdvancedDisclosure, and Role summary removed
  assert.doesNotMatch(collaboratorsBlock, /<SummaryCard/, "Redundant SummaryCard must be removed from Project Collaborators tab");
  assert.doesNotMatch(collaboratorsBlock, /<AdvancedDisclosure/, "Redundant AdvancedDisclosure must be removed from Project Collaborators tab");
  assert.doesNotMatch(collaboratorsBlock, /title="Role summary"/, "Redundant Role summary card must be removed from Collaborators tab");

  // Exactly 1 Canonical SettingsCard: "Collaborators"
  assert.match(collaboratorsBlock, /<SettingsCard[\s\S]*?title="Members"/, "Unified Collaborators card must exist");
  const cardMatches = collaboratorsBlock.match(/<SettingsCard/g) || [];
  assert.equal(cardMatches.length, 1, "Collaborators tab must render exactly 1 unified canonical SettingsCard instead of multiple cards");

  // Structured sub-sections inside the single card
  assert.match(collaboratorsBlock, /Owner and admins/, "Must contain Owner and admins sub-section");
  assert.match(collaboratorsBlock, /Team directory/, "Must contain Team directory sub-section");
  assert.match(collaboratorsBlock, /No admins yet/, "Leadership block must have clean empty state for co-leaders");

  // Team search input, role filter pills, and empty state
  assert.match(collaboratorsBlock, /aria-label="Filter members by access level"/, "Role filter tablist must exist");
  assert.match(collaboratorsBlock, /<CollaboratorSearchField onCommit=\{setCollaboratorSearch\} \/>/, "Collaborator search input must exist");
  assert.match(source("src/components/projects/settings/CollaboratorSearchField.tsx"), /label = "Search members"/, "Collaborator search input must be labelled");
  assert.match(collaboratorsBlock, /No members found/, "Team directory must have empty state when filtered");
});
