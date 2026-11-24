import assert from "node:assert/strict";
import test from "node:test";

import { completionDecision, completionLine, completionOpen, completionRule } from "@/lib/organizations/completion";

test("completion rule: approvals and attendance (report 31.2 call 5)", () => {
  assert.deepEqual(completionRule({ required: 3, approved: 3, attendance: 90, minimum: 80 }), { meets: true, reasons: [] });
  assert.deepEqual(completionRule({ required: 0, approved: 0, attendance: null, minimum: null }), { meets: true, reasons: [] });
  assert.deepEqual(completionRule({ required: 3, approved: 2, attendance: null, minimum: null }).reasons, ["1 assignment not approved"]);
  assert.deepEqual(completionRule({ required: 4, approved: 1, attendance: 70, minimum: 80 }).reasons, ["3 assignments not approved", "Attendance 70%, needs 80%"]);
  // No attendance taken yet counts as 0 against a minimum; at the minimum passes.
  assert.equal(completionRule({ required: 0, approved: 0, attendance: null, minimum: 75 }).meets, false);
  assert.equal(completionRule({ required: 0, approved: 0, attendance: 75, minimum: 75 }).meets, true);
});

test("overriding needs a reason; agreeing doesn't", () => {
  assert.deepEqual(completionDecision(true, true, ""), { ok: true, byRule: true, reason: null });
  assert.deepEqual(completionDecision(false, false, "ignored"), { ok: true, byRule: true, reason: null });
  assert.equal(completionDecision(false, true, " ").ok, false);
  assert.equal(completionDecision(true, false, null).ok, false);
  assert.deepEqual(completionDecision(false, true, " Medical leave, work seen in person "), { ok: true, byRule: false, reason: "Medical leave, work seen in person" });
});

test("opens on the end date; the line waits for a record", () => {
  assert.equal(completionOpen("2026-12-01", "2026-11-30"), false);
  assert.equal(completionOpen("2026-12-01", "2026-12-01"), true);
  assert.equal(completionOpen(null, "2026-01-01"), true);
  assert.equal(completionLine(0, 0), null);
  assert.equal(completionLine(24, 28), "Completion 24 of 28");
});
