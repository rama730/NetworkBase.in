import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { START_PATHS, backLabel, backTargetFor, shortTitle } from "../../src/lib/navigation/back-routes";

describe("back routes (unified back §6)", () => {
  it("start pages hide the arrow", () => {
    for (const path of START_PATHS) assert.equal(backTargetFor(path).show, false, path);
  });

  it("messages and create workspace hide it", () => {
    for (const path of ["/messages/inbox", "/messages/abc", "/messages/w/1/browse", "/workspaces/new"]) {
      assert.equal(backTargetFor(path).show, false, path);
    }
  });

  it("detail fallbacks match the table", () => {
    assert.deepEqual(backTargetFor("/u/priya"), { show: true, fallback: "/network" });
    assert.deepEqual(backTargetFor("/my-profile/edit"), { show: true, fallback: "/my-profile" });
    assert.deepEqual(backTargetFor("/workspaces/robot"), { show: true, fallback: "/discover" });
    assert.deepEqual(backTargetFor("/org/acme"), { show: true, fallback: "/discover" });
    assert.deepEqual(backTargetFor("/admin/trust/cases/12"), { show: true, fallback: "/admin/trust" });
    assert.deepEqual(backTargetFor("/admin/trust/appeals/3"), { show: true, fallback: "/admin/trust" });
    assert.deepEqual(backTargetFor("/admin/trust/people/priya"), { show: true, fallback: "/admin/trust" });
    assert.deepEqual(backTargetFor("/appeal/9"), { show: true, fallback: "/discover" });
  });

  it("unknown path shows the arrow with /discover", () => {
    assert.deepEqual(backTargetFor("/somewhere/else"), { show: true, fallback: "/discover" });
  });

  it("backLabel names the destination when known", () => {
    assert.equal(backLabel({ title: "Discover" }), "Back to Discover");
    assert.equal(backLabel({ title: "" }), "Back");
    assert.equal(backLabel(null), "Back");
  });

  it("shortTitle keeps the most specific name", () => {
    assert.equal(shortTitle("Tasks · Campus robotics kit · NetworkBase"), "Campus robotics kit");
    assert.equal(shortTitle("Discover · NetworkBase"), "Discover");
    assert.equal(shortTitle("Priya Nair (@priya) · NetworkBase"), "Priya Nair");
    assert.equal(shortTitle("(3) · Messages · NetworkBase"), "Messages");
    assert.equal(shortTitle("NetworkBase"), "");
  });

  it("useBack lives in one shared place and asks leave guards first", () => {
    const src = fs.readFileSync("src/hooks/useBack.ts", "utf8");
    assert.match(src, /confirmAppNavigation/);
    assert.match(src, /canGoBackInApp\(\)/);
    assert.doesNotMatch(src, /history\.length/);
    assert.equal(fs.existsSync("src/components/messages/useBack.ts"), false);
  });
});
