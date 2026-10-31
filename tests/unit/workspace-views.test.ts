import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { formatCount, viewCountDisplay } from "../../src/lib/format-count";
import { startVisibleDwell } from "../../src/lib/workspaces/visible-dwell";
import { patchCountsInPages } from "../../src/lib/workspaces/live-counts";
import { isBotUserAgent, recordWorkspaceView, viewerSlotKey, type WorkspaceViewDeps } from "../../src/lib/workspaces/view-record";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ID = "11111111-1111-4111-8111-111111111111";

/** Real rules over an in-memory slot store and counter: the only fakes are Redis and the database. */
function world(overrides: Partial<WorkspaceViewDeps> = {}) {
  const slots = new Set<string>();
  const state = { views: 0, viewerResolved: 0 };
  const deps: WorkspaceViewDeps = {
    secret: "test-secret",
    resolveViewer: async () => { state.viewerResolved += 1; return { id: "reader", isStaff: false }; },
    readAccess: async () => ({ canRead: true, isTeam: false }),
    allowIp: async () => true,
    claimSlot: async (key) => { if (slots.has(key)) return false; slots.add(key); return true; },
    releaseSlot: async (key) => { slots.delete(key); },
    increment: async () => { state.views += 1; return true; },
    ...overrides,
  };
  return { deps, slots, state };
}
const visit = (deps: WorkspaceViewDeps, userAgent: string | null = CHROME, ip: string | null = "203.0.113.9") =>
  recordWorkspaceView({ workspaceId: ID, ip, userAgent }, deps);

describe("who counts", () => {
  it("counts a signed-in person outside the team once", async () => {
    const { deps, state } = world();
    assert.equal(await visit(deps), "counted");
    assert.equal(await visit(deps), "repeat");
    assert.equal(state.views, 1);
  });

  it("counts anonymous visitors, keeping browsers on one IP apart", async () => {
    const { deps, state } = world({ resolveViewer: async () => null });
    assert.equal(await visit(deps, CHROME), "counted");
    assert.equal(await visit(deps, `${CHROME} Edg/130`), "counted");
    assert.equal(await visit(deps, CHROME), "repeat");
    assert.equal(state.views, 2);
  });

  it("skips the team, including inherited org admins, without using a slot", async () => {
    const { deps, slots, state } = world({ readAccess: async () => ({ canRead: true, isTeam: true }) });
    assert.equal(await visit(deps), "team");
    assert.equal(slots.size + state.views, 0);
  });

  it("skips staff reviewing a workspace", async () => {
    const { deps, state } = world({ resolveViewer: async () => ({ id: "mod", isStaff: true }) });
    assert.equal(await visit(deps), "staff");
    assert.equal(state.views, 0);
  });

  it("skips someone who can't read the workspace", async () => {
    const { deps, slots } = world({ readAccess: async () => ({ canRead: false, isTeam: false }) });
    assert.equal(await visit(deps), "no_access");
    assert.equal(slots.size, 0);
  });

  it("stops bots before any auth, limit or database work", async () => {
    const { deps, state } = world({ allowIp: async () => { throw new Error("must not run"); } });
    assert.equal(await visit(deps, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), "bot");
    assert.equal(state.viewerResolved, 0);
  });

  it("stops an IP past its hourly limit", async () => {
    const { deps, state } = world({ allowIp: async () => false });
    assert.equal(await visit(deps), "ip_limit");
    assert.equal(state.views, 0);
  });
});

describe("failures", () => {
  it("frees the slot when the write fails, so a retry can count", async () => {
    let healthy = false;
    const { deps, slots, state } = world({
      increment: async () => { if (!healthy) throw new Error("database down"); state.views += 1; return true; },
    });
    assert.equal(await visit(deps), "write_failed");
    assert.equal(slots.size, 0);
    healthy = true;
    assert.equal(await visit(deps), "counted");
    assert.equal(state.views, 1);
  });

  it("drops the view when Redis is down, and the database is not touched", async () => {
    const { deps, state } = world({ claimSlot: async () => { throw new Error("redis down"); } });
    assert.equal(await visit(deps), "unavailable");
    assert.equal(state.views, 0);
  });

  it("frees the slot when the workspace disappeared mid-request", async () => {
    const { deps, slots } = world({ increment: async () => false });
    assert.equal(await visit(deps), "no_access");
    assert.equal(slots.size, 0);
  });
});

describe("bot detection", () => {
  for (const agent of [null, "", "curl/8.4.0", "python-requests/2.31", "Mozilla/5.0 HeadlessChrome/130.0", "bingbot/2.0", "Mozilla/5.0 (compatible; AhrefsBot/7.0)", "Slackbot-LinkExpanding 1.0"]) {
    it(`treats ${JSON.stringify(agent)} as a bot`, () => assert.equal(isBotUserAgent(agent), true));
  }
  for (const agent of [CHROME, "Mozilla/5.0 (Linux; Android 9; CUBOT KingKong) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36", "Mozilla/5.0 (Linux; Android 12; CUBOT_X50) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36"]) {
    it(`treats ${agent.slice(0, 50)} as a person`, () => assert.equal(isBotUserAgent(agent), false));
  }
});

describe("viewer keys", () => {
  it("never carry a raw IP", () => {
    const key = viewerSlotKey(ID, null, "203.0.113.9", CHROME, "secret");
    assert.doesNotMatch(key, /203\.0\.113\.9/);
    assert.notEqual(key, viewerSlotKey(ID, null, "203.0.113.10", CHROME, "secret"));
  });
  it("follow a signed-in person across devices", () => {
    assert.equal(viewerSlotKey(ID, "user-1", "203.0.113.9", CHROME, "s"), viewerSlotKey(ID, "user-1", "198.51.100.1", "other", "s"));
  });
});

describe("formatCount", () => {
  const cases: Array<[number, string]> = [[0, "0"], [1, "1"], [1234, "1,234"], [9999, "9,999"], [10000, "10K"], [12431, "12.4K"], [1500000, "1.5M"]];
  for (const [value, text] of cases) it(`${value} reads ${text}`, () => assert.equal(formatCount(value), text));
});

describe("viewCountDisplay", () => {
  it("hides zero from the public", () => assert.equal(viewCountDisplay(0, false).visible, false));
  it("tells the team zero is expected", () => {
    const display = viewCountDisplay(0, true);
    assert.equal(display.visible, true);
    assert.equal(display.exact, "0 views yet");
  });
  it("shows a dash, never a false zero, when the read failed", () => {
    for (const count of [null, undefined]) {
      assert.deepEqual(viewCountDisplay(count, false), { visible: true, text: "—", exact: "Views unavailable" });
    }
  });
  it("gives the exact number behind a compact one", () => {
    assert.deepEqual(viewCountDisplay(12431, false), { visible: true, text: "12.4K", exact: "12,431 views" });
  });
  it("uses the singular for one", () => assert.equal(viewCountDisplay(1, false).exact, "1 view"));
});

describe("startVisibleDwell", () => {
  function fakeDocument(state: "visible" | "hidden") {
    const listeners = new Set<() => void>();
    return {
      visibilityState: state as "visible" | "hidden",
      addEventListener: (_: string, listener: () => void) => { listeners.add(listener); },
      removeEventListener: (_: string, listener: () => void) => { listeners.delete(listener); },
      set(next: "visible" | "hidden") { this.visibilityState = next; listeners.forEach((listener) => listener()); },
      listeners,
    };
  }

  it("fires after the visible time has passed", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let done = 0;
    startVisibleDwell(3000, () => { done += 1; }, fakeDocument("visible"));
    mock.timers.tick(2999);
    assert.equal(done, 0);
    mock.timers.tick(1);
    assert.equal(done, 1);
    mock.timers.reset();
  });

  it("waits for a background tab to be looked at", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let done = 0;
    const doc = fakeDocument("hidden");
    startVisibleDwell(3000, () => { done += 1; }, doc);
    mock.timers.tick(60_000);
    assert.equal(done, 0);
    doc.set("visible");
    mock.timers.tick(3000);
    assert.equal(done, 1);
    mock.timers.reset();
  });

  it("adds up visible time across hide and show", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let done = 0;
    const doc = fakeDocument("visible");
    startVisibleDwell(3000, () => { done += 1; }, doc);
    mock.timers.tick(2000);
    doc.set("hidden");
    mock.timers.tick(30_000);
    assert.equal(done, 0);
    doc.set("visible");
    mock.timers.tick(999);
    assert.equal(done, 0);
    mock.timers.tick(1);
    assert.equal(done, 1);
    mock.timers.reset();
  });

  it("never fires after leaving, and removes its listener", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let done = 0;
    const doc = fakeDocument("visible");
    const stop = startVisibleDwell(3000, () => { done += 1; }, doc);
    mock.timers.tick(1000);
    stop();
    mock.timers.tick(10_000);
    assert.equal(done, 0);
    assert.equal(doc.listeners.size, 0);
    mock.timers.reset();
  });
});

describe("patchCountsInPages", () => {
  const data = () => ({ pages: [{ projects: [{ id: "a", viewCount: 5, followersCount: 1 }, { id: "b", viewCount: 9, followersCount: 2 }] }], pageParams: [] });

  it("updates only the named workspace", () => {
    const next = patchCountsInPages(data(), "a", { viewCount: 6, followersCount: 3 });
    assert.deepEqual(next?.pages[0]!.projects, [{ id: "a", viewCount: 6, followersCount: 3 }, { id: "b", viewCount: 9, followersCount: 2 }]);
  });
  it("never moves views down", () => {
    assert.equal(patchCountsInPages(data(), "a", { viewCount: 4 })?.pages[0]!.projects[0]!.viewCount, 5);
  });
  it("returns the same object when nothing changed, so nothing redraws", () => {
    const input = data();
    assert.equal(patchCountsInPages(input, "a", { viewCount: 5, followersCount: 1 }), input);
    assert.equal(patchCountsInPages(input, "missing", { viewCount: 50 }), input);
  });
  it("leaves an empty cache alone", () => assert.equal(patchCountsInPages(undefined, "a", { viewCount: 1 }), undefined));
});

describe("WorkspaceStatsBar", () => {
  const render = async (props: { viewCount?: number | null; isTeam?: boolean }) => {
    const [{ createElement }, { renderToStaticMarkup }, { default: WorkspaceStatsBar }] = await Promise.all([
      import("react"), import("react-dom/server"), import("../../src/components/workspaces/WorkspaceStatsBar"),
    ]);
    return renderToStaticMarkup(createElement(WorkspaceStatsBar, props));
  };

  it("shows the public no views line at zero", async () => {
    assert.doesNotMatch(await render({ viewCount: 0 }), /project-view-count/);
  });
  it("tells the team what zero means", async () => {
    const html = await render({ viewCount: 0, isTeam: true });
    assert.match(html, /0 views yet/);
    assert.match(html, /Counts people outside the team/);
  });
  it("prints the compact number with the exact one behind it", async () => {
    const html = await render({ viewCount: 12431 });
    assert.match(html, />12\.4K</);
    assert.match(html, /aria-label="12,431 views"/);
  });
  it("shows a dash when the count is unknown", async () => {
    assert.match(await render({ viewCount: null }), />—</);
  });
});
