import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  arrivedByTraverse,
  canGoBackInApp,
  currentEntry,
  noteTransition,
  resetInAppHistory,
  stampEntry,
  type WinLike,
} from "../../src/lib/navigation/in-app-history";

/** A tab's history: entries with state, an index, push/replace/back like the browser (Next's patch keeps our keys). */
function makeTab(start: string, title = "Discover · NetworkBase") {
  const entries: { url: string; state: any }[] = [{ url: start, state: null }];
  let index = 0;
  const doc = { title };
  const loc = () => {
    const u = new URL(entries[index].url, "https://nb.test");
    return { pathname: u.pathname, search: u.search, href: u.href };
  };
  const win: WinLike = {
    document: doc,
    get location() { return loc(); },
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      replaceState(state: any, _t: string, url?: string) { entries[index] = { url: url ? new URL(url).pathname + new URL(url).search : entries[index].url, state }; },
    },
  } as WinLike;
  return {
    win,
    doc,
    /** router.push / Link: Next writes its own state (no nb). */
    push(url: string, viaRouter = true) {
      if (viaRouter) noteTransition("push");
      entries.splice(index + 1);
      entries.push({ url, state: viaRouter ? { __NA: true } : null });
      index = entries.length - 1;
    },
    /** router.replace: Next drops custom keys from the current entry. */
    replace(url: string) {
      noteTransition("replace");
      entries[index] = { url, state: { __NA: true } };
    },
    go(delta: number) {
      noteTransition("traverse");
      index += delta;
    },
  };
}

describe("in-app history entries (A7)", () => {
  beforeEach(() => resetInAppHistory());

  it("fresh load has nothing behind it", () => {
    const tab = makeTab("/workspaces/robot");
    const e = stampEntry(tab.win);
    assert.equal(e.depth, 0);
    assert.equal(e.from, null);
    assert.equal(canGoBackInApp(), false);
  });

  it("push records depth and from", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/workspaces/robot");
    tab.doc.title = "Campus robotics kit · NetworkBase";
    const e = stampEntry(tab.win);
    assert.equal(e.depth, 1);
    assert.equal(e.from?.path, "/discover");
    assert.equal(e.from?.title, "Discover · NetworkBase");
    assert.equal(canGoBackInApp(), true);
    assert.deepEqual(tab.win.history.state.nb, e, "stamp is written into the entry");
  });

  it("traverse back adopts the stored entry", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/workspaces/robot");
    stampEntry(tab.win);
    tab.go(-1);
    assert.equal(stampEntry(tab.win).depth, 0);
    assert.equal(canGoBackInApp(), false);
  });

  it("forward after back adopts depth 1 (forward is not a step back)", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/network");
    const pushed = stampEntry(tab.win);
    tab.go(-1);
    stampEntry(tab.win);
    tab.go(1);
    const e = stampEntry(tab.win);
    assert.equal(e.depth, 1);
    assert.equal(e.id, pushed.id);
  });

  it("replace keeps id and depth", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/workspaces/robot");
    const before = stampEntry(tab.win);
    tab.replace("/workspaces/robot?tab=tasks");
    const after = stampEntry(tab.win);
    assert.equal(after.id, before.id);
    assert.equal(after.depth, 1);
  });

  it("router.replace that drops nb keeps depth, even with no transition note", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/org/acme");
    stampEntry(tab.win);
    // A raw replaceState(null) from page code: no transition, same length.
    tab.win.history.replaceState(null, "", "https://nb.test/org/acme?tab=members");
    assert.equal(stampEntry(tab.win).depth, 1);
  });

  it("raw pushState(null) with a longer history counts as a push", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/discover?updateId=7", false);
    const e = stampEntry(tab.win);
    assert.equal(e.depth, 1);
  });

  it("reload with nb in state adopts it", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/u/priya");
    const e = stampEntry(tab.win);
    resetInAppHistory(); // the page reloaded: module state is gone, history.state survives
    assert.deepEqual(stampEntry(tab.win), e);
    assert.equal(canGoBackInApp(), true);
  });

  it("a repeat stamp of the same entry changes nothing", () => {
    const tab = makeTab("/discover");
    const a = stampEntry(tab.win);
    const b = stampEntry(tab.win);
    assert.deepEqual(a, b);
    assert.equal(currentEntry()?.id, a.id);
  });

  it("arrivedByTraverse is true just after a traverse, false later", () => {
    const tab = makeTab("/discover");
    stampEntry(tab.win);
    tab.push("/network");
    stampEntry(tab.win);
    assert.equal(arrivedByTraverse(), false);
    tab.go(-1);
    stampEntry(tab.win);
    assert.equal(arrivedByTraverse(), true);
    assert.equal(arrivedByTraverse(Date.now() + 2000), false);
  });
});
