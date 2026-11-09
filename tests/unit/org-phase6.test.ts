import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Live-fix phase 6 (problems 38–46, 49–51).
const source = (path: string) => readFileSync(path, "utf8");

test("live-fix 38: workspace rows have an avatar and ⋯ says Detach", () => {
  // The Workspaces tab moved to its own file (workspaces report); the List keeps the avatar, ⋯ keeps Detach.
  const overview = source("src/components/organizations/OrgWorkspacesTab.tsx");
  assert.match(overview, /<WorkspaceAvatar project=\{\{ title: r\.title, coverImage: r\.coverImage \}\}/);
  assert.match(overview, />Detach<\/DropdownMenuItem>/);
  assert.match(overview, /`Detach \$\{first\?\.title\}\?`/);
  assert.doesNotMatch(overview, /Remove from the organization<\/DropdownMenuItem>/);
});

test("live-fix 39–42: roster photos, the only-one-here line, nothing aimed at yourself, a side drawer", () => {
  const members = source("src/components/organizations/OrgMembersTab.tsx");
  assert.match(members, /<UserAvatar identity=\{\{ id: r\.userId/);
  assert.match(members, /You’re the only one here so far/);
  assert.match(members, /isSelf \? null :/);
  assert.match(members, /sm:max-w-\[560px\]/);
});

test("live-fix 43–46: organization wording in Settings, one address control, and members get their own sections", () => {
  assert.match(source("src/components/workspaces/settings/WorkspaceSettingsNavigation.tsx"), /organization \? "Organization settings" : "Workspace settings"/);
  const general = source("src/components/workspaces/settings/GeneralSettingsSection.tsx");
  assert.match(general, /organization \? "Organization image" : "Workspace image"/);
  assert.match(general, /\{organization \? null : <ReadOnlySlugField/);
  assert.match(general, /All details are saved\./);
  const tab = source("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
  assert.match(tab, /if \(!canManageSettings && !organization\) \{/);
  assert.match(tab, /title=\{organization \? "Links" : "Workspace links"\}/);
});

test("live-fix 49–51: Join knows you're in, Discover cards carry the org type, team boxes say Add team", () => {
  const join = source("src/app/(site)/(auth)/join/[code]/page.tsx");
  assert.match(join, /You’re already in/);
  assert.match(join, /`\/org\/\$\{/);
  assert.match(source("src/lib/workspaces/public-feed.ts"), /kind: project\.kind === "organization" \? "organization" : "workspace"/);
  const roles = source("src/components/workspaces/dashboard/OpenRolesCard.tsx");
  assert.match(roles, /Add team/);
  assert.match(roles, /No teams yet\. A workspace works fine without them\./);
});

test("live-fix 40, 50 follow-ups: alone, the invite panel is the larger one; Discover counts only workspaces people can find", () => {
  const panel = source("src/components/organizations/OrgInvitePanel.tsx");
  assert.match(panel, /prominent \? 'p-4' : 'p-3'/);
  assert.match(source("src/components/organizations/OrgMembersTab.tsx"), /<OrgInvitePanel orgId=\{orgId\} orgHandle=\{null\} prominent=\{data\.summary\.members <= 1\}( onChanged=\{load\})? \/>/);
  assert.match(source("src/lib/workspaces/public-feed-service.ts"), /c\.visibility <> 'private'/);
  assert.match(source("src/lib/data/discover.ts"), /ne\(workspaces\.visibility, 'private'\)\)\)\.groupBy\(workspaces\.parentId\)/);
});

test("live-fix 46: a member's Settings are their own sections only, never an admin one", async () => {
  const { orgSettingsSectionIds } = await import("../../src/lib/organizations/settings");
  assert.deepEqual(orgSettingsSectionIds("member"), ["you-membership", "org-allowed", "privacy-policies", "org-management"]);
  assert.deepEqual(orgSettingsSectionIds("viewer"), ["you-membership", "org-allowed", "privacy-policies", "org-management"]);
  for (const admin of ["general", "org-access", "org-people", "org-work", "org-moderation", "links"]) assert.equal(orgSettingsSectionIds("member").includes(admin as never), false, admin);
  // The tab opens a member on My membership: it's their first section.
  assert.equal(orgSettingsSectionIds("member")[0], "you-membership");
});
