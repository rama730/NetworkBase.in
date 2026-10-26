import assert from "node:assert/strict";
import { test } from "node:test";

import { validateOrgHandle } from "../../src/lib/organizations/handle";

// Report §30.2: 3–40 of a–z 0–9 -, letter or digit at both ends, no "--", reserved names blocked.
test("accepts and normalizes valid handles", () => {
  assert.deepEqual(validateOrgHandle("cse-3a-2026"), { ok: true, handle: "cse-3a-2026" });
  assert.deepEqual(validateOrgHandle("  CSE-3A "), { ok: true, handle: "cse-3a" });
  assert.deepEqual(validateOrgHandle("cse​3a"), { ok: true, handle: "cse3a" });
  assert.equal(validateOrgHandle("a".repeat(40)).ok, true);
});

test("rejects bad shapes", () => {
  for (const raw of ["ab", "a".repeat(41), "-abc", "abc-", "a--b", "a_b", "a b", "ab.c", ""]) {
    assert.equal(validateOrgHandle(raw).ok, false, raw);
  }
});

test("rejects reserved names from every list", () => {
  for (const raw of ["join", "org", "verified", "networkbase", "admin", "onboarding", "discover", "my-profile"]) {
    const result = validateOrgHandle(raw);
    assert.equal(result.ok, false, raw);
    assert.equal(!result.ok && result.reason, "reserved", raw);
  }
});
