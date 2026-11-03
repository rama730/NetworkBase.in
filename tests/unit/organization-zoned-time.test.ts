import assert from "node:assert/strict";
import { test } from "node:test";

import { isoToZonedInput, zonedInputToIso, zoneName } from "../../src/lib/organizations/zoned-time";

// Report §32.5, decision 74: due dates are entered in the organization's zone and stored as the exact moment.
test("wall time in the organization's zone becomes the exact moment, and back", () => {
  assert.equal(zonedInputToIso("2026-11-08T23:59", "Asia/Kolkata"), "2026-11-08T18:29:00.000Z");
  assert.equal(isoToZonedInput("2026-11-08T18:29:00.000Z", "Asia/Kolkata"), "2026-11-08T23:59");
  // Across a daylight-saving change (New York, 1 Nov 2026 ends DST).
  assert.equal(zonedInputToIso("2026-11-02T09:00", "America/New_York"), "2026-11-02T14:00:00.000Z");
  assert.equal(zonedInputToIso("2026-07-02T09:00", "America/New_York"), "2026-07-02T13:00:00.000Z");
  assert.equal(zoneName("Asia/Kolkata"), "India Standard Time");
});
