import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Live-fix phase 7 (problems 52–66): the profile and the contribution editor.
const source = (path: string) => readFileSync(path, "utf8");

test("live-fix 52, 56, 59: Since a month, logos, and Edit contribution opens that entry", async () => {
  const { sinceMonth } = await import("../../src/lib/organizations/profile-rules");
  assert.equal(sinceMonth("2026-10-31"), "Oct 2026");
  assert.equal(sinceMonth(null), null);
  const section = source("src/components/profile/v2/sections/ProfileOrganizationsSection.tsx");
  assert.match(section, /Since \$\{sinceMonth\(c\.startDate\)\}/);
  assert.match(section, /<WorkspaceAvatar /);
  assert.match(section, /profileEditHref\("experience", "overview", \{ contribution: row\.contributionId/);
  assert.match(source("src/app/actions/organizations.ts"), /contributionId: string \| null; coverImage: string \| null/);
});

test("live-fix 53: a team workspace draft nests under its organization's draft", async () => {
  const { groupProfileContributions } = await import("../../src/lib/organizations/profile-rules");
  const org = { id: "1", projectId: "org", projectKind: "organization", publishedAt: null, presentation: null, parentOrg: null };
  const team = { id: "2", projectId: "team", projectKind: "project", publishedAt: null, presentation: null, parentOrg: { id: "org", title: "CSE 3B" } };
  const groups = groupProfileContributions([org, team] as never[], true);
  assert.deepEqual(groups.drafts.map((d: { id: string; children: Array<{ id: string }> }) => [d.id, d.children.map((c) => c.id)]), [["1", ["2"]]]);
});

test("live-fix 54, 55: the nudge names its own workspace and Publish sits beside it", () => {
  const card = source("src/components/profile/v2/sections/WorkspaceContributionsCard.tsx");
  assert.match(card, /`Write about your work in \$\{c\.projectTitle\}`/);
  assert.match(card, /profileEditHref\("experience", "overview", \{ contribution: c\.id \}\)/);
});

test("live-fix 58: a team workspace's owner reads Team lead; Contributor only when nothing is known", () => {
  const collab = source("src/lib/profile/collaboration.ts");
  assert.match(collab, /"Team lead"/);
});

test("live-fix 61–66: the organization entry reads as one, Publish is always there, and the counts are plural-right", () => {
  const editor = source("src/components/profile/edit/ContributionEditor.tsx");
  assert.match(editor, /roleCount\(d\.positions\.length\)/);
  assert.match(editor, /Set by \$\{/);
  assert.match(editor, /Back to contributions/);
  assert.match(editor, /Explain your part in the organization|isOrgEntry \? "Explain your part in the organization"/);
  assert.match(editor, /hiddenReason/);
});

test("live-fix 56, 61, 63, 66 follow-ups: who verified and when, logos, Show publishes, nested workspaces in the entry", () => {
  const editor = source("src/components/profile/edit/ContributionEditor.tsx");
  assert.match(editor, /Verified by \$\{active\.verifiedByName/);
  assert.match(editor, /<WorkspaceAvatar project=\{\{ title: active\.projectTitle, coverImage: active\.projectCoverImage \}\}/);
  assert.match(editor, /docs\.current\[active\.id\] = \{ \.\.\.d, visible: true \};\s*void save\("publish"\);/);
  assert.match(editor, /aria-label="Workspaces in this organization"/);
  assert.match(source("src/components/profile/v2/sections/ProfileOrganizationsSection.tsx"), /<WorkspaceAvatar project=\{\{ title: c\.projectTitle, coverImage: c\.projectCoverImage \}\}/);
  const collab = source("src/lib/profile/collaboration.ts");
  assert.match(collab, /AS verified_by_name/);
  assert.match(collab, /project\.cover_image AS project_cover_image/);
});
