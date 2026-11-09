import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

// Unified back §8: a "Back to…" link that only reopened a page is gone (the top-bar arrow does that job);
// jumps to a fixed place stay, as in-app links that never reload the browser.
test("links that duplicated the arrow are removed", () => {
  const members = read("src/components/organizations/OrgMembersTab.tsx");
  assert.doesNotMatch(members, /cameFromWorkspaces/);
  assert.doesNotMatch(members, /<ChevronLeft[^>]*\/>Workspaces/);
  assert.doesNotMatch(read("src/components/organizations/OrgWorkspacesTab.tsx"), /from=workspaces/);
  assert.doesNotMatch(read("src/components/organizations/HandInSection.tsx"), /Back to the assignment/);
});

test("review queue jumps are in-app links named for where they go", () => {
  const src = read("src/components/organizations/ReviewQueueParts.tsx");
  const review = src.slice(src.indexOf("export function CopyReview"));
  assert.doesNotMatch(review, /<a href/);
  assert.match(review, />Review queue</);
  assert.doesNotMatch(review, /Back to queue/);
  assert.match(review, /<Link href=\{data\.next\.href\}/);
});

test("Edit profile closes with a real back, never a reopen and refresh (§9)", () => {
  const src = read("src/components/profile/edit/EditProfileEditor.tsx");
  const onClose = src.slice(src.indexOf("const onClose = () => {"), src.indexOf("};", src.indexOf("const onClose = () => {")));
  assert.match(onClose, /allowLeave\(\);\s*back\(\);/);
  assert.doesNotMatch(onClose, /router\.refresh|router\.replace/);
  assert.match(src, /const back = useBack\(returnHref\)/);
});
