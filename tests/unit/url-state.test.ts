import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { TAB_STATE_PARAMS, patchSearch, writeUrl } from "../../src/lib/navigation/url-state";

describe("page settings live in the address (R3)", () => {
  it("patchSearch adds, replaces and removes", () => {
    assert.equal(patchSearch("?tab=members", { mq: "ana", msort: "joined" }), "?tab=members&mq=ana&msort=joined");
    assert.equal(patchSearch("?tab=members&mq=ana", { mq: "bo" }), "?tab=members&mq=bo");
    assert.equal(patchSearch("?tab=members&mq=ana", { mq: null }), "?tab=members");
    assert.equal(patchSearch("?mq=ana", { mq: null }), "");
  });

  it("patchSearch keeps unrelated params and their order", () => {
    assert.equal(patchSearch("?a=1&b=2&c=3", { b: "9" }), "?a=1&b=9&c=3");
  });

  it("writeUrl keeps our history stamp", () => {
    const calls: { state: any; url?: string }[] = [];
    const win = {
      history: {
        state: { __NA: true, nb: { id: "x", depth: 2, from: null } },
        length: 3,
        replaceState(state: any, _t: string, url?: string) { calls.push({ state, url }); },
        pushState(state: any, _t: string, url?: string) { calls.push({ state, url }); },
      },
      location: { pathname: "/org/acme", search: "?tab=members", href: "https://nb.test/org/acme?tab=members" },
    };
    writeUrl(win, "/org/acme?tab=members&mq=ana", "replace");
    assert.equal(calls[0].url, "/org/acme?tab=members&mq=ana");
    assert.deepEqual(calls[0].state.nb, { id: "x", depth: 2, from: null });
  });

  it("new param names are unique and don't reuse existing ones", () => {
    const all = Object.values(TAB_STATE_PARAMS).flat();
    assert.equal(new Set(all).size, all.length);
    for (const taken of ["tab", "q", "project", "status", "assignment", "review", "rosterTile", "sprint", "filesQuery", "filesView", "search", "taskScope"]) {
      assert.ok(!all.includes(taken), taken);
    }
  });

  it("switching tabs clears each tab's settings", () => {
    const src = fs.readFileSync("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx", "utf8");
    assert.match(src, /for \(const \[tab, keys\] of Object\.entries\(TAB_STATE_PARAMS\)\)/);
  });

  it("each screen mirrors its settings into the address", () => {
    for (const [file, key] of [
      ["src/components/organizations/OrgMembersTab.tsx", "mq"],
      ["src/components/organizations/ReviewQueue.tsx", "rqq"],
      ["src/components/organizations/AssignmentRoster.tsx", "rtq"],
      ["src/components/organizations/OrgFileViews.tsx", "ofq"],
      ["src/components/workspaces/v2/TasksTab.tsx", "team"],
      ["src/components/workspaces/tabs/sprint/SprintTimelineContent.tsx", "tlby"],
    ]) {
      const src = fs.readFileSync(file, "utf8");
      assert.match(src, /useUrlMirror\(/, file);
      assert.match(src, new RegExp(`['"]${key}['"]`), `${file} uses ${key}`);
    }
  });
});
