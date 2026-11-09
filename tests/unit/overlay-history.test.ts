import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, describe, it } from "node:test";

import { noteTransition, resetInAppHistory, stampEntry, type WinLike } from "../../src/lib/navigation/in-app-history";
import { closeOverlay, isOverlayEntry, openOverlay } from "../../src/lib/navigation/overlay-history";

function makeTab(start: string) {
  const entries: { url: string; state: any }[] = [{ url: start, state: null }];
  let index = 0;
  const win = {
    get location() { const u = new URL(entries[index].url, "https://nb.test"); return { pathname: u.pathname, search: u.search, href: u.href }; },
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      replaceState(state: any, _t: string, url?: string) { entries[index] = { url: url ? new URL(url).pathname + new URL(url).search : entries[index].url, state }; },
    },
  } as WinLike;
  const go = (url: string) => (mode: "push" | "replace") => {
    noteTransition(mode);
    if (mode === "push") { entries.splice(index + 1); entries.push({ url, state: { __NA: true } }); index = entries.length - 1; }
    else entries[index] = { url, state: { __NA: true } };
    stampEntry(win);
  };
  return { win, go, back() { noteTransition("traverse"); index -= 1; stampEntry(win); }, get length() { return entries.length; } };
}

describe("back closes what's open over the page (A3)", () => {
  beforeEach(() => resetInAppHistory());

  it("open pushes a marked entry; close on it goes back", () => {
    const tab = makeTab("/workspaces/robot?tab=tasks");
    stampEntry(tab.win);
    openOverlay("task", tab.go("/workspaces/robot?tab=tasks&drawerType=task&drawerId=1"));
    assert.equal(tab.length, 2);
    assert.equal(isOverlayEntry("task"), true);
    let backed = false;
    closeOverlay("task", () => assert.fail("must go back"), () => { backed = true; tab.back(); });
    assert.equal(backed, true);
    assert.equal(isOverlayEntry("task"), false);
  });

  it("close on a deep-linked overlay replaces", () => {
    const tab = makeTab("/workspaces/robot?tab=tasks&drawerType=task&drawerId=1");
    stampEntry(tab.win);
    let replaced = false;
    closeOverlay("task", () => { replaced = true; }, () => assert.fail("nothing of ours behind"));
    assert.equal(replaced, true);
  });

  it("switching from one item to another replaces, so one back closes", () => {
    const tab = makeTab("/workspaces/robot?tab=tasks");
    stampEntry(tab.win);
    openOverlay("task", tab.go("/workspaces/robot?tab=tasks&drawerId=1"));
    openOverlay("task", tab.go("/workspaces/robot?tab=tasks&drawerId=2"));
    assert.equal(tab.length, 2);
    assert.equal(isOverlayEntry("task"), true);
  });

  it("the task drawer, trust case, My work and the media viewer use it", () => {
    const read = (f: string) => fs.readFileSync(f, "utf8");
    assert.match(read("src/components/workspaces/v2/TasksTab.tsx"), /openOverlay\("task"/);
    assert.match(read("src/components/workspaces/v2/TasksTab.tsx"), /closeOverlay\("task"/);
    assert.match(read("src/components/trust/TrustInbox.tsx"), /openOverlay\(['"]trust-case['"]/);
    assert.match(read("src/components/trust/TrustInbox.tsx"), /closeOverlay\(['"]trust-case['"]/);
  });
});

it("My work, the media viewer and the member drawer follow history", () => {
  const read = (f: string) => fs.readFileSync(f, "utf8");
  assert.match(read("src/components/my-work/MyWorkDrawerHost.tsx"), /useOverlayHistory\("my-work"/);
  assert.match(read("src/components/messages/parts/message-attachments.tsx"), /useOverlayHistory\("media"/);
  assert.match(read("src/components/organizations/OrgMembersTab.tsx"), /useOverlayHistory\('member'/);
});
