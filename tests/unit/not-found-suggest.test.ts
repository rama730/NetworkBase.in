import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editDistance, suggestAddress } from "@/lib/errors/suggest";
import { pushRecentPage } from "@/lib/navigation/recent-pages";

const MINE = [
  { slug: "design-studio-101", title: "Design Studio 101", kind: "workspace" as const },
  { slug: "robotics-club", title: "Robotics Club", kind: "organization" as const },
];

describe("404 suggestions", () => {
  it("counts a swap of two letters once", () => {
    assert.equal(editDistance("workspcaes", "workspaces"), 1);
    assert.equal(editDistance("discover", "discover"), 0);
  });

  it("fixes a mistyped section and keeps the rest of the address", () => {
    assert.deepEqual(suggestAddress("/workspcaes/design-studio-101/tasks", []), { kind: "section", from: "workspcaes", to: "workspaces", path: "/workspaces/design-studio-101/tasks" });
    assert.equal(suggestAddress("/dicsover", [])?.path, "/discover");
  });

  it("leaves real sections, short words and far-off words alone", () => {
    assert.equal(suggestAddress("/workspaces/zzz", []), null);
    assert.equal(suggestAddress("/ab", []), null);
    assert.equal(suggestAddress("/wp-admin/setup.php", []), null);
  });

  it("suggests the viewer's own workspace or organization by name, never someone else's", () => {
    assert.deepEqual(suggestAddress("/workspaces/design-studo-101", MINE), { kind: "place", from: "design-studo-101", to: "design-studio-101", path: "/workspaces/design-studio-101", title: "Design Studio 101" });
    assert.equal(suggestAddress("/org/robotcs-club", MINE)?.path, "/org/robotics-club");
    assert.equal(suggestAddress("/workspaces/robotcs-club", MINE), null, "an organization is under /org, not /workspaces");
    assert.equal(suggestAddress("/workspaces/design-studo-101", []), null);
  });
});

describe("recently visited", () => {
  it("keeps the newest first, once each, at most five, and drops sign-in pages", () => {
    let list: { path: string; title: string }[] = [];
    for (const n of [1, 2, 3, 4, 5, 6]) list = pushRecentPage(list, { path: `/w/${n}`, title: `W${n}` });
    assert.deepEqual(list.map((p) => p.path), ["/w/6", "/w/5", "/w/4", "/w/3", "/w/2"]);
    list = pushRecentPage(list, { path: "/w/3", title: "W3" });
    assert.deepEqual(list.map((p) => p.path), ["/w/3", "/w/6", "/w/5", "/w/4", "/w/2"]);
    assert.equal(pushRecentPage(list, { path: "/login", title: "Sign in" }), list);
    assert.equal(pushRecentPage(list, { path: "/w/9", title: "" }), list);
  });
});
