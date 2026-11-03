import assert from "node:assert/strict";
import test from "node:test";

import { addDays, format, formatDistanceToNow, isSameYear, isToday, startOfDay } from "@/lib/utils/date";

test("relative time matches the date-fns shapes callers rely on", () => {
    const now = Date.now();
    assert.equal(formatDistanceToNow(new Date(now - 5 * 60_000), { addSuffix: true }), "5 minutes ago");
    assert.equal(formatDistanceToNow(new Date(now - 3 * 3_600_000)), "3 hours");
    assert.equal(formatDistanceToNow(new Date(now + 2 * 86_400_000), { addSuffix: true }), "in 2 days");
    // Student check 15: a class question posted a moment ago never reads "0 seconds ago".
    assert.equal(formatDistanceToNow(new Date(now), { addSuffix: true }), "just now");
    assert.equal(formatDistanceToNow(new Date(now - 20_000), { addSuffix: true }), "just now");
});

test("fixed patterns format in en-US", () => {
    const date = new Date(2026, 8, 5, 15, 7);
    assert.equal(format(date, "MMM d"), "Sep 5");
    assert.equal(format(date, "MMM d, yyyy"), "Sep 5, 2026");
    assert.equal(format(date, "p"), "3:07 PM");
    assert.equal(format(date, "MMM d, yyyy h:mm a"), "Sep 5, 2026 3:07 PM");
    assert.equal(format(date, "yyyy-MM-dd"), "2026-09-05");
});

test("day arithmetic stays on local calendar days", () => {
    assert.equal(format(addDays(new Date(2026, 1, 28), 1), "yyyy-MM-dd"), "2026-03-01");
    assert.equal(startOfDay(new Date(2026, 8, 5, 23, 59)).getHours(), 0);
    assert.ok(isToday(new Date()));
    assert.ok(isSameYear(new Date(2026, 0, 1), new Date(2026, 11, 31)));
});
