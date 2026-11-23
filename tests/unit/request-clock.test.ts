import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.7 part 7 (plan A2.5): working minutes, deadlines, the clock and its warnings.
const H = { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", holidays: [] as string[] };
const IST = "Asia/Kolkata";
// Wall times in Kolkata (UTC+05:30, no daylight saving).
const ist = (s: string) => new Date(`${s}:00+05:30`);

test("workingMinutesBetween: Fri 16:00 → Mon 10:00 is 120; a holiday is skipped; outside hours counts from the next opening", async () => {
  const { workingMinutesBetween } = await import("../../src/lib/workflows/request-clock");
  assert.equal(workingMinutesBetween(ist("2026-11-20T16:00"), ist("2026-11-23T10:00"), H, IST), 120);
  assert.equal(workingMinutesBetween(ist("2026-11-20T16:00"), ist("2026-11-24T10:00"), { ...H, holidays: ["2026-11-23"] }, IST), 120);
  assert.equal(workingMinutesBetween(ist("2026-11-21T12:00"), ist("2026-11-23T10:00"), H, IST), 60);
  assert.equal(workingMinutesBetween(ist("2026-11-23T10:00"), ist("2026-11-23T10:00"), H, IST), 0);
  assert.equal(workingMinutesBetween(ist("2026-11-23T18:00"), ist("2026-11-23T08:00"), H, IST), 0, "end before start");
});

test("workingMinutesBetween across a daylight-saving change counts wall hours", async () => {
  const { workingMinutesBetween } = await import("../../src/lib/workflows/request-clock");
  // New York leaves daylight saving on Sun 1 Nov 2026: Fri 30 Oct 16:00 EDT → Mon 2 Nov 10:00 EST.
  assert.equal(workingMinutesBetween(new Date("2026-10-30T16:00:00-04:00"), new Date("2026-11-02T10:00:00-05:00"), H, "America/New_York"), 120);
});

test("addWorkingMinutes: 240 from Thu 15:00 is Fri 11:00; from Saturday it's Mon 13:00", async () => {
  const { addWorkingMinutes } = await import("../../src/lib/workflows/request-clock");
  assert.equal(addWorkingMinutes(ist("2026-11-19T15:00"), 240, H, IST).toISOString(), ist("2026-11-20T11:00").toISOString());
  assert.equal(addWorkingMinutes(ist("2026-11-21T10:00"), 240, H, IST).toISOString(), ist("2026-11-23T13:00").toISOString());
  assert.equal(addWorkingMinutes(ist("2026-11-20T16:30"), 30, H, IST).toISOString(), ist("2026-11-20T17:00").toISOString(), "ends at closing");
});

test("clockState: off without a budget; 85 % used is soon; past the budget is breached; paused never breaches; stopped keeps its time", async () => {
  const { clockState } = await import("../../src/lib/workflows/request-clock");
  const base = { startedAt: ist("2026-11-23T09:00"), budgetMinutes: 240, pausedMinutes: 0, waitingSince: null, stoppedAt: null, hours: H, tz: IST };
  assert.equal(clockState({ ...base, budgetMinutes: null, now: ist("2026-11-23T10:00") }).state, "off");
  assert.deepEqual(clockState({ ...base, now: ist("2026-11-23T10:00") }), { state: "running", leftMinutes: 180, usedMinutes: 60 });
  assert.equal(clockState({ ...base, now: ist("2026-11-23T12:24") }).state, "soon");
  assert.deepEqual(clockState({ ...base, now: ist("2026-11-23T13:40") }), { state: "breached", leftMinutes: -40, usedMinutes: 280 });
  assert.equal(clockState({ ...base, waitingSince: ist("2026-11-23T10:00"), now: ist("2026-11-25T10:00") }).state, "paused");
  assert.deepEqual(clockState({ ...base, pausedMinutes: 60, now: ist("2026-11-23T13:40") }), { state: "soon", leftMinutes: 20, usedMinutes: 220 }, "paused time doesn't count");
  assert.deepEqual(clockState({ ...base, stoppedAt: ist("2026-11-23T10:10"), now: ist("2026-11-24T10:00") }), { state: "stopped", leftMinutes: 170, usedMinutes: 70 });
});

test("reminderTimes: the 80 % and breach instants; none when off, paused or stopped; a pause shifts both", async () => {
  const { reminderTimes } = await import("../../src/lib/workflows/request-clock");
  const base = { startedAt: ist("2026-11-23T09:00"), budgetMinutes: 240, pausedMinutes: 0, waitingSince: null, stoppedAt: null, hours: H, tz: IST };
  assert.deepEqual(reminderTimes(base), { soonAt: ist("2026-11-23T12:12"), breachAt: ist("2026-11-23T13:00") });
  assert.deepEqual(reminderTimes({ ...base, pausedMinutes: 60 }), { soonAt: ist("2026-11-23T13:12"), breachAt: ist("2026-11-23T14:00") });
  assert.equal(reminderTimes({ ...base, budgetMinutes: null }), null);
  assert.equal(reminderTimes({ ...base, waitingSince: ist("2026-11-23T10:00") }), null);
  assert.equal(reminderTimes({ ...base, stoppedAt: ist("2026-11-23T10:00") }), null);
});

test("clockText: words with the numbers, never colour alone", async () => {
  const { clockText } = await import("../../src/lib/workflows/request-clock");
  assert.equal(clockText({ state: "running", leftMinutes: 130, usedMinutes: 0 }), "2 h 10 m left");
  assert.equal(clockText({ state: "soon", leftMinutes: 45, usedMinutes: 0 }), "45 m left");
  assert.equal(clockText({ state: "running", leftMinutes: 720, usedMinutes: 0 }), "1 d 4 h left");
  assert.equal(clockText({ state: "breached", leftMinutes: -40, usedMinutes: 0 }), "Breached 40 m ago");
  assert.equal(clockText({ state: "paused", leftMinutes: 50, usedMinutes: 0 }), "Paused · 50 m left");
  assert.equal(clockText({ state: "stopped", leftMinutes: 170, usedMinutes: 70 }, "Replied"), "Replied in 1 h 10 m");
  assert.equal(clockText({ state: "off", leftMinutes: 0, usedMinutes: 0 }), "");
});

test("hoursLine: runs of days with a dash, times and the zone, holidays counted", async () => {
  const { hoursLine } = await import("../../src/lib/workflows/request-clock");
  assert.equal(hoursLine(H, IST), "Mon–Fri 09:00–17:00 (Asia/Kolkata)");
  assert.equal(hoursLine({ ...H, days: [1, 2, 4, 6, 7], holidays: ["2026-12-25"] }, "UTC"), "Mon, Tue, Thu, Sat, Sun 09:00–17:00 (UTC) · 1 holiday");
});
