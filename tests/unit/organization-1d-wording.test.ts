import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Report §41.3 deploy 1d (wording): each check fails before its fix.

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

test("parity bug 1: the sidebar plus sends the handle, so the owner isn't told they're not a member", () => {
  const sidebar = source("src/components/layout/SidebarWorkspaces.tsx");
  assert.doesNotMatch(sidebar, /workspaces\/new\?org=\$\{encodeURIComponent\(org\.id\)\}/);
  assert.match(sidebar, /workspaces\/new\?org=\$\{encodeURIComponent\(org\.slug \?\? org\.id\)\}/);
});

test("parity bug 10: the sidebar shows a placeholder until both lists arrive, never 'No workspaces yet' early", () => {
  const sidebar = source("src/components/layout/AppSidebar.tsx");
  assert.match(sidebar, /const loadingWorkspaces = projectsQuery\.isPending \|\| workspacesQuery\.isPending/);
  assert.match(sidebar, /!workspaces && !loadingWorkspaces && !projectsQuery\.isError && projects\.length === 0/);
});

test("parity bug 12: a long rail heading cuts off instead of widening the page", () => {
  assert.match(source("src/components/ui/rail-section.tsx"), /truncate/);
});

test("27.2: the review step's card line follows visibility", () => {
  const review = source("src/components/workspaces/create-wizard/phases/Phase5Review.tsx");
  assert.doesNotMatch(review, /This is how your workspace card will appear in Discover/);
  assert.match(review, /This is how it appears on Discover\./);
  assert.match(review, /Only members see this card\./);
});

test("27.3: the ready screen says how people join and how many addresses were skipped", () => {
  const ready = source("src/components/organizations/OrganizationCreatedScreen.tsx");
  assert.match(ready, /Needs your approval/);
  assert.match(ready, /People join right away/);
  assert.match(ready, /looked wrong and \{skipped === 1 \? .was. : .were.\} skipped/);
});

test("27.8, decision 55: names are 3–100 characters and welcome notes 500, everywhere", () => {
  assert.match(source("src/lib/organizations/settings.ts"), /welcome_note: z\.string\(\)\.trim\(\)\.max\(500\)/);
  assert.match(source("src/components/organizations/OrgSettingsSections.tsx"), /id="org-welcome".*maxLength=\{500\}/);
  assert.match(source("src/app/actions/org-lifecycle.ts"), /title: z\.string\(\)\.trim\(\)\.min\(3\)\.max\(100\)/);
});

test("smaller bug 12: Returned, never Returned for changes", () => {
  for (const file of ["src/components/organizations/AssignmentsPanel.tsx", "src/components/organizations/OrgOverviewParts.tsx", "src/components/organizations/OrgSprintParts.tsx", "src/components/messages/cards/MessageCard.tsx"]) {
    assert.doesNotMatch(source(file), /Returned for changes/, file);
  }
});

test("smaller bug 20: organization feeds lose the follower and progress wording; workspaces keep theirs", () => {
  const updates = source("src/components/workspaces/tabs/UpdatesTab.tsx");
  // Step 7 (42.15 design): "Announcements and discussions for CSE 3B"; a workspace inside one says "Updates for your team".
  // Live-fix 29: the page's own flags give the wording before the feed loads.
  assert.match(updates, /orgFeed \? `Announcements and discussions for \$\{org\?\.title \?\? projectName\}\.` : \(org \? org\.kind === "child" : isChild\) \? "Updates for your team\." : "Progress posts for followers and workspace visitors\."/);
  assert.match(updates, /"Post your first announcement\. Everyone gets notified\."/);
  assert.match(updates, /toast\.success\(orgFeed \? "Posted" : "Workspace update posted"\)/);
});

test("parity wording 6 and 13–15: no 'Workspace or workspace', and counts use the right plural", () => {
  assert.doesNotMatch(source("src/components/profile/edit/ContributionEditor.tsx"), /Workspace or workspace/i);
  assert.doesNotMatch(source("src/components/organizations/OrgOverviewParts.tsx"), /\} projects<\/button>/);
  assert.doesNotMatch(source("src/components/organizations/OrgSprintParts.tsx"), /project not linked|projects not linked/);
  assert.match(source("src/components/organizations/AssignmentsPanel.tsx"), /Nobody has it yet\. People get it when they join\./, "17: no bare 0 of 0 done");
});

test("decision 163: 18 and over, said where people join and on the Education card; Report can say someone may be under 18", () => {
  assert.match(source("src/lib/organizations/creation.ts"), /A college or university class/);
  assert.match(source("src/app/(site)/(auth)/join/[code]/page.tsx"), /You must be 18 or older to join/);
  assert.match(source("src/lib/email/org-templates.ts"), /You must be 18 or older to join/);
  assert.match(source("src/lib/copy/terms.ts"), /This person may be under 18/);
});
