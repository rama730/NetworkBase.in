import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("workspace links tab eliminates duplicate headers, summary cards, and leaves one clean SettingsCard", () => {
  const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");

  // SectionHeader is suppressed on links tab
  assert.match(settingsTab, /id="project-settings-links"/, "SectionHeader must be suppressed on links tab to avoid duplicate title");

  // Links section block extraction
  const linksBlock = settingsTab.split('id="project-settings-links"')[1]?.split('id="project-settings-collaborators"')[0] ?? "";
  assert.ok(linksBlock.length > 0, "Links settings block must exist in ProjectSettingsTab");

  // Redundant SummaryCard removed
  assert.doesNotMatch(linksBlock, /<SummaryCard/, "Redundant SummaryCard must be removed from Project Links tab");

  // Single canonical SettingsCard hosting ProjectLinksManager
  assert.match(linksBlock, /<SettingsCard[\s\S]*?title="Workspace links"/, "Canonical SettingsCard must be used");
  assert.match(linksBlock, /<ProjectLinksManager[\s\S]*?mode="inline"/, "ProjectLinksManager must be rendered in inline mode");
  assert.equal((linksBlock.match(/<ProjectLinksManager/g) ?? []).length, 1, "Exactly one ProjectLinksManager in links tab");
});

test("workspace links components adhere to NetworkBase drafting-table design tokens and typography", () => {
  const cardSource = source("src/components/workspaces/dashboard/WorkspaceSocialLinksCard.tsx");

  // Zero legacy zinc, emerald, or blue classes
  assert.doesNotMatch(cardSource, /zinc-/, "ProjectSocialLinksCard must not contain raw zinc utility classes");
  assert.doesNotMatch(cardSource, /emerald-/, "ProjectSocialLinksCard must not contain raw emerald utility classes");
  assert.doesNotMatch(cardSource, /blue-/, "ProjectSocialLinksCard must not contain raw blue utility classes");

  // Managed repository cards use semantic border and card background
  assert.match(cardSource, /border border-border bg-card px-3\.5 py-3/, "Managed repos use border-border bg-card");

  // Sortable list keeps its shared dividers while the bordered card surface is selected by presentation mode.
  assert.match(cardSource, /min-w-0 max-w-full divide-y divide-border/, "SortableLinkList uses semantic dividers");
  assert.match(cardSource, /overflow-hidden rounded-lg border border-border bg-card/, "The default sortable list uses a semantic bordered card surface");

  // Standardized compact icon buttons
  assert.match(cardSource, /nb-icon-button inline-flex (?:h-\[28px\] w-\[28px\]|h-8 w-8) items-center justify-center rounded-(?:\[5px\]|md) border border-border\/70/, "Actions use standardized compact icon buttons");

  // Zero rounded-full badges, adheres to Section 10 badge contract
  assert.doesNotMatch(cardSource, /rounded-full/, "ProjectSocialLinksCard must not use circular rounded-full badges");
  assert.match(cardSource, /h-5 px-\[7px\] rounded-\[3px\] font-mono text-\[11px\]/, "ProjectSocialLinksCard uses Section 10 badge contract");

  // Composer well styling
  assert.match(cardSource, /rounded-lg border border-border bg-muted\/20 p-4 sm:p-5/, "Composer well uses border-border and bg-muted/20");
  assert.match(cardSource, /nb-ui-label block text-foreground/, "Composer uses .nb-ui-label");

  // Inline mode footer
  assert.match(cardSource, /border-t border-border py-4/, "Inline mode uses an unboxed action row separated by a divider");
  assert.match(cardSource, /nb-compact text-muted-foreground/, "Inline counts use .nb-compact");
  assert.match(cardSource, /Save changes/, "Save changes button exists in inline mode");
  assert.match(cardSource, /Cancel/, "Cancel button exists in inline mode alongside Save changes");
});
