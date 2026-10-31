import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLastUpdateTime, lastUpdateLine, lastUpdateName } from "../../src/lib/workspaces/last-update";

const now = new Date(2026, 9, 31, 14, 0).getTime();
const ago = (ms: number) => new Date(now - ms);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

test("time reads minutes, hours, days, then the date", () => {
  assert.equal(formatLastUpdateTime(ago(30_000), now), "just now");
  assert.equal(formatLastUpdateTime(ago(MIN), now), "1m ago");
  assert.equal(formatLastUpdateTime(ago(25 * MIN), now), "25m ago");
  assert.equal(formatLastUpdateTime(ago(59 * MIN), now), "59m ago");
  assert.equal(formatLastUpdateTime(ago(HOUR), now), "1h ago");
  assert.equal(formatLastUpdateTime(ago(23 * HOUR), now), "23h ago");
  assert.equal(formatLastUpdateTime(ago(DAY), now), "1d ago");
  assert.equal(formatLastUpdateTime(ago(6 * DAY), now), "6d ago");
  assert.equal(formatLastUpdateTime(new Date(2026, 9, 24, 14, 0), now), "24 Oct");
  assert.equal(formatLastUpdateTime(new Date(2025, 11, 3), now), "3 Dec 2025");
});

test("a clock a little ahead of the server still reads just now", () => {
  assert.equal(formatLastUpdateTime(new Date(now + 5_000), now), "just now");
});

test("the line names the person when there is a name", () => {
  assert.equal(lastUpdateLine({ at: ago(2 * HOUR).toISOString(), byName: "Rama" }, now), "Updated by Rama · 2h ago");
  assert.equal(lastUpdateLine({ at: ago(3 * DAY).toISOString(), byName: null }, now), "Updated 3d ago");
});

test("the name follows profile visibility and blocks", () => {
  const person = { fullName: "Rama", username: "rama", visibility: "public", blocked: false };
  assert.equal(lastUpdateName(person, false), "Rama");
  assert.equal(lastUpdateName({ ...person, visibility: "connections" }, false), null);
  assert.equal(lastUpdateName({ ...person, visibility: "private" }, true), "Rama");
  assert.equal(lastUpdateName({ ...person, blocked: true }, true), null);
  assert.equal(lastUpdateName({ ...person, fullName: " " }, true), "rama");
  assert.equal(lastUpdateName({ fullName: null, username: null, visibility: null, blocked: null }, true), null);
});
