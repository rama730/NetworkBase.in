import assert from "node:assert/strict";
import test from "node:test";

import { describeApplyCard } from "../../src/lib/applications/card-state";

const ready = { load: "ready", projectClosed: false } as const;

test("while loading or after a failed read the card never offers Apply", () => {
  assert.match(describeApplyCard({ status: "none" }, { load: "loading", projectClosed: false }).blockedReason ?? "", /Checking/);
  const failed = describeApplyCard({ status: "none" }, { load: "error", projectClosed: false });
  assert.equal(failed.canRetry, true);
  assert.ok(failed.blockedReason);
  assert.equal(describeApplyCard({ status: "none", loadFailed: true }, ready).canRetry, true);
});

test("pending: Edit only while the window is open, Withdraw always", () => {
  const open = describeApplyCard({ status: "pending", applicationId: "a", editableUntil: new Date() }, ready);
  assert.deepEqual([open.canEdit, open.canWithdraw, open.appliedRowLabel], [true, true, "Pending"]);
  const late = describeApplyCard({ status: "pending", applicationId: "a" }, ready);
  assert.deepEqual([late.canEdit, late.canWithdraw], [false, true]);
});

test("withdrawn and ended membership can apply again", () => {
  const withdrawn = describeApplyCard({ status: "withdrawn" }, ready);
  assert.equal(withdrawn.blockedReason, null);
  assert.equal(withdrawn.applyLabel, "Apply again");
  const ended = describeApplyCard({ status: "accepted", membershipEnded: true }, ready);
  assert.equal(ended.blockedReason, null);
  assert.match(ended.banner?.text ?? "", /were on this project/);
});

test("declined: the reason shows, the cooldown blocks, and it lifts after the wait", () => {
  const cooling = describeApplyCard({ status: "rejected", canReapply: false, waitTime: "23h 5m", decisionReasonText: "Needs a closer stack match." }, ready);
  assert.equal(cooling.appliedRowLabel, "Declined");
  assert.equal(cooling.banner?.detail, "Needs a closer stack match.");
  assert.match(cooling.blockedReason ?? "", /23h 5m/);
  const after = describeApplyCard({ status: "rejected", canReapply: true }, ready);
  assert.equal(after.blockedReason, null);
  assert.equal(after.applyLabel, "Apply again");
});

test("a filled role marks that role only and does not block other roles", () => {
  const filled = describeApplyCard({ status: "rejected", canReapply: true, decisionReason: "role_filled" }, ready);
  assert.equal(filled.appliedRowLabel, "Filled");
  assert.equal(filled.blockedReason, null);
});

test("a closed project takes no applications whatever the history", () => {
  for (const status of [{ status: "none" }, { status: "withdrawn" }, { status: "rejected", canReapply: true }] as const) {
    assert.match(describeApplyCard(status, { load: "ready", projectClosed: true }).blockedReason ?? "", /no longer taking applications/);
  }
});
