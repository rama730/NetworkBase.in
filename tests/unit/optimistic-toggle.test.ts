import assert from "node:assert/strict";
import test from "node:test";
import { saveOutcome } from "../../src/lib/ui/optimistic";

test("a save fails when it throws or answers success: false, and says why; anything else is a success", async () => {
  assert.equal(await saveOutcome(Promise.resolve(undefined)), null);
  assert.equal(await saveOutcome(Promise.resolve({ success: true })), null);
  assert.equal(await saveOutcome(Promise.resolve({ success: false, error: "You can't change this." })), "You can't change this.");
  assert.equal(await saveOutcome(Promise.resolve({ success: false })), "Couldn’t save that. Check your connection.");
  assert.equal(await saveOutcome(Promise.reject(new Error("Only owners can do that."))), "Only owners can do that.");
});
