import assert from "node:assert/strict";
import test from "node:test";

import {
  activeStatus,
  advanceBadgeSpin,
  initialBadgeSpin,
  availabilityLabel,
  availabilityOf,
  clearAfterToDate,
  isAway,
  isStatusEmoji,
  LOADING_GIVE_UP_MS,
  LOADING_MIN_MS,
  LOADING_SHOW_AFTER_MS,
  loadingSettlePlan,
  projectAvailabilityOf,
  resolveLive,
  ringOrder,
  ringWeight,
  showStatusEmoji,
  spinDelta,
  statusBadgeSize,
  statusLabel,
  statusTimerFraction,
  STATUS_EMOJI_MIN_SIZE,
  validStatusExpiry,
} from "@/lib/presence/model";

const now = new Date(2026, 9, 3, 14, 0, 0);

test("availability: live wins, then today, this week, offline", () => {
  assert.equal(availabilityOf({ live: true, lastActiveAt: null }, now), "now");
  assert.equal(availabilityOf({ live: false, lastActiveAt: new Date(2026, 9, 3, 8, 0) }, now), "today");
  assert.equal(availabilityOf({ live: false, lastActiveAt: new Date(2026, 9, 1, 8, 0) }, now), "week");
  assert.equal(availabilityOf({ live: false, lastActiveAt: new Date(2026, 8, 20) }, now), "offline");
  assert.equal(availabilityOf({ live: false, lastActiveAt: null }, now), "offline");
  assert.equal(availabilityOf({ live: false, lastActiveAt: "not a date" }, now), "offline");
});

test("availability labels say how long ago within the week", () => {
  assert.equal(availabilityLabel("now"), "Active now");
  assert.equal(availabilityLabel("today"), "Active today");
  assert.equal(availabilityLabel("today", new Date(2026, 9, 3, 13, 58), now), "Active just now");
  assert.equal(availabilityLabel("today", new Date(2026, 9, 3, 13, 48), now), "Active 12m ago");
  assert.equal(availabilityLabel("today", new Date(2026, 9, 3, 11, 0), now), "Active 3h ago");
  assert.equal(availabilityLabel("week", new Date(2026, 9, 1, 13, 0), now), "Active 2d ago");
  assert.equal(availabilityLabel("offline"), "Offline");
});

test("realtime answer wins both ways; unknown falls back to the server", () => {
  assert.equal(resolveLive(false, true), false);
  assert.equal(resolveLive(true, false), true);
  assert.equal(resolveLive(undefined, true), true);
  assert.equal(resolveLive(undefined, undefined), false);
});

test("an expired status counts as cleared", () => {
  const expired = { emoji: "📅", expiresAt: new Date(2026, 9, 3, 13, 0).toISOString() };
  const running = { emoji: "📅", expiresAt: new Date(2026, 9, 3, 15, 0).toISOString() };
  assert.equal(activeStatus(expired, now), null);
  assert.equal(activeStatus(running, now), running);
  assert.deepEqual(activeStatus({ emoji: "🏡", expiresAt: null }, now), { emoji: "🏡", expiresAt: null });
});

test("clear-after choices map to end times", () => {
  assert.equal(clearAfterToDate("never", now), null);
  assert.equal(clearAfterToDate("1h", now)!.getTime() - now.getTime(), 60 * 60_000);
  const today = clearAfterToDate("today", now)!;
  assert.equal(today.getDate(), 3);
  assert.equal(today.getHours(), 23);
  const week = clearAfterToDate("week", now)!;
  assert.equal(week.getDay(), 0, "this week ends on Sunday night");
});

test("server accepts only future end times within 90 days", () => {
  assert.equal(validStatusExpiry(null, now), null);
  assert.equal(validStatusExpiry(new Date(2026, 9, 3, 13).toISOString(), now), "invalid");
  assert.equal(validStatusExpiry(new Date(2027, 1, 1).toISOString(), now), "invalid");
  assert.equal(validStatusExpiry("nope", now), "invalid");
  assert.ok(validStatusExpiry(new Date(2026, 9, 10).toISOString(), now) instanceof Date);
});

test("status labels: the text, with when it clears", () => {
  assert.equal(statusLabel({ text: "Working remotely", expiresAt: null }, now), "Working remotely");
  assert.match(statusLabel({ text: "In a meeting", expiresAt: new Date(2026, 9, 3, 15, 0).toISOString() }, now), /^In a meeting · until /);
  assert.match(statusLabel({ text: null, expiresAt: new Date(2026, 9, 9).toISOString() }, now), /^until /, "emoji-only status still says when it clears");
});

test("status emoji: any emoji (flags, skin tones, ZWJ), nothing else", () => {
  for (const emoji of ["📅", "🌴", "👍🏽", "🇮🇳", "👩‍💻", "⏸️"]) assert.equal(isStatusEmoji(emoji), true, emoji);
  for (const bad of ["", "abc", "<b>", "📅 meeting", "x".repeat(20), null]) assert.equal(isStatusEmoji(bad), false, String(bad));
});

test("away = notifications paused", () => {
  assert.equal(isAway({ emoji: "🌴", text: "Vacationing", expiresAt: null, setAt: null, pausesNotifications: true }), true);
  assert.equal(isAway({ emoji: "📅", text: "In a meeting", expiresAt: null, setAt: null, pausesNotifications: false }), false);
  assert.equal(isAway(null), false);
});

test("project activity uses the same steps from the last change", () => {
  assert.equal(projectAvailabilityOf(new Date(now.getTime() - 60_000), now), "now");
  assert.equal(projectAvailabilityOf(new Date(2026, 9, 3, 9), now), "today");
  assert.equal(projectAvailabilityOf(null, now), "offline");
});

test("privacy: blocked sees nothing, hiding is mutual, status follows its audience", async () => {
  const { presencePrivacy } = await import("@/lib/presence/model");
  const base = { self: false, blocked: false, viewerShowsActivity: true, targetShowsActivity: true, connected: false, teammate: false, visibility: "network" as const };
  assert.deepEqual(presencePrivacy({ ...base, blocked: true, visibility: "everyone" }), { activity: false, status: false });
  assert.equal(presencePrivacy({ ...base, targetShowsActivity: false }).activity, false, "a hidden person reads as Offline");
  assert.equal(presencePrivacy({ ...base, viewerShowsActivity: false }).activity, false, "hiding your own activity hides everyone's");
  assert.equal(presencePrivacy(base).status, false, "network status needs a connection or teammate");
  assert.equal(presencePrivacy({ ...base, connected: true }).status, true);
  assert.equal(presencePrivacy({ ...base, visibility: "team", connected: true }).status, false, "team-only ignores plain connections");
  assert.equal(presencePrivacy({ ...base, visibility: "team", teammate: true }).status, true);
  assert.equal(presencePrivacy({ ...base, visibility: "everyone" }).status, true);
  assert.deepEqual(presencePrivacy({ ...base, self: true, blocked: true, targetShowsActivity: false }), { activity: true, status: true }, "you always see yourself");
});

test("spinDelta: a rise in activity turns the rings clockwise, a drop counter-clockwise, no change none", () => {
  assert.equal(spinDelta("week", "now"), 360);
  assert.equal(spinDelta("offline", "today"), 360);
  assert.equal(spinDelta("now", "today"), -360);
  assert.equal(spinDelta("week", "offline"), -360);
  assert.equal(spinDelta("now", "now"), 0);
  assert.equal(spinDelta("offline", "now"), 360);
});

test("showStatusEmoji: the status emoji needs an emoji and a badge of at least 20px", () => {
  assert.equal(STATUS_EMOJI_MIN_SIZE, 20);
  assert.equal(showStatusEmoji(null, 30), false);
  assert.equal(showStatusEmoji(undefined, 30), false);
  assert.equal(showStatusEmoji("  ", 30), false);
  assert.equal(showStatusEmoji("📅", 14), false);
  assert.equal(showStatusEmoji("📅", 19), false);
  assert.equal(showStatusEmoji("📅", 20), true);
  assert.equal(showStatusEmoji("👥", 30), true);
});

test("statusBadgeSize: a status emoji grows the badge to the status size, never shrinks it", () => {
  assert.equal(statusBadgeSize(16, 20, "📅"), 20);
  assert.equal(statusBadgeSize(14, 20, "📅"), 20);
  assert.equal(statusBadgeSize(30, 20, "📅"), 30);
  assert.equal(statusBadgeSize(16, 20, null), 16);
  assert.equal(statusBadgeSize(16, 20, "  "), 16);
  assert.equal(statusBadgeSize(11, undefined, "📅"), 11);
});

test("statusTimerFraction: share of the status time left, clamped, null without a start or end", () => {
  const set = "2026-10-20T10:00:00.000Z";
  const end = "2026-10-20T12:00:00.000Z";
  assert.equal(statusTimerFraction(set, end, Date.parse("2026-10-20T10:00:00.000Z")), 1);
  assert.equal(statusTimerFraction(set, end, Date.parse("2026-10-20T11:00:00.000Z")), 0.5);
  assert.equal(statusTimerFraction(set, end, Date.parse("2026-10-20T13:00:00.000Z")), 0);
  assert.equal(statusTimerFraction(set, end, Date.parse("2026-10-20T09:00:00.000Z")), 1);
  assert.equal(statusTimerFraction(null, end), null);
  assert.equal(statusTimerFraction(set, null), null);
  assert.equal(statusTimerFraction(end, set), null);
  assert.equal(statusTimerFraction("nope", end), null);
});

test("ringOrder: the wave runs inner to outer going up, outer to inner going down", () => {
  assert.deepEqual([0, 1, 2, 3].map((index) => ringOrder(index, 1)), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map((index) => ringOrder(index, -1)), [3, 2, 1, 0]);
});

test("ringWeight: rings get thinner as activity drops", () => {
  assert.deepEqual(["now", "today", "week", "offline"].map((a) => ringWeight(a as "now")), [1, 0.88, 0.74, 0.6]);
});

test("advanceBadgeSpin: spins only for an armed, full change; halo only when it becomes now", () => {
  const start = initialBadgeSpin("week", true);
  assert.deepEqual(start, { availability: "week", from: "week", armed: true, angle: 0, cycle: 0, halo: 0, dir: 1 });
  assert.equal(advanceBadgeSpin(start, "week", true), start);
  const up = advanceBadgeSpin(start, "now", true);
  assert.deepEqual(up, { availability: "now", from: "week", armed: true, angle: 360, cycle: 1, halo: 1, dir: 1 });
  const down = advanceBadgeSpin(up, "today", true);
  assert.deepEqual(down, { availability: "today", from: "now", armed: true, angle: 0, cycle: 2, halo: 1, dir: -1 });
  const again = advanceBadgeSpin(down, "now", true);
  assert.deepEqual(again, { availability: "now", from: "today", armed: true, angle: 360, cycle: 3, halo: 2, dir: 1 });
});

test("advanceBadgeSpin: the first data and a busy list (not full) only record the change", () => {
  const loading = initialBadgeSpin("today", false);
  assert.equal(advanceBadgeSpin(loading, "today", false), loading);
  // Data arriving (animate flips to true) together with a new state is the baseline, not a change.
  assert.deepEqual(advanceBadgeSpin(loading, "now", true), { availability: "now", from: "today", armed: true, angle: 0, cycle: 0, halo: 0, dir: 1 });
  assert.deepEqual(advanceBadgeSpin(loading, "now", false), { availability: "now", from: "today", armed: false, angle: 0, cycle: 0, halo: 0, dir: 1 });
  // Over the animation budget: availability and from move, nothing spins.
  const armed = initialBadgeSpin("week", true);
  assert.deepEqual(advanceBadgeSpin(armed, "now", true, false), { availability: "now", from: "week", armed: true, angle: 0, cycle: 0, halo: 0, dir: 1 });
});

test("loadingSettlePlan: a response before the loader showed only fades; otherwise the loader stays up its minimum time", () => {
  assert.equal(LOADING_SHOW_AFTER_MS, 200);
  assert.equal(LOADING_MIN_MS, 600);
  assert.equal(LOADING_GIVE_UP_MS, 8000);
  assert.deepEqual(loadingSettlePlan(null, 5_000), { mode: "fade", delay: 0 });
  assert.deepEqual(loadingSettlePlan(1_000, 1_100), { mode: "settle", delay: 500 });
  assert.deepEqual(loadingSettlePlan(1_000, 1_600), { mode: "settle", delay: 0 });
  assert.deepEqual(loadingSettlePlan(1_000, 4_000), { mode: "settle", delay: 0 });
});
