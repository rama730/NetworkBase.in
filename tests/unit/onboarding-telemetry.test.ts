import assert from "node:assert/strict";
import test from "node:test";

import { ONBOARDING_TELEMETRY_BATCH_LIMIT, sanitizeOnboardingTelemetryBatch } from "../../src/lib/onboarding/events";

test("onboarding telemetry accepts valid events and caps a boundary batch", () => {
  const events = Array.from({ length: ONBOARDING_TELEMETRY_BATCH_LIMIT + 5 }, (_, index) => ({
    eventType: "step_view",
    step: (index % 4) + 1,
    metadata: { index },
  }));
  const sanitized = sanitizeOnboardingTelemetryBatch([...events, { eventType: "not-real" }]);
  assert.equal(sanitized.length, ONBOARDING_TELEMETRY_BATCH_LIMIT);
  assert.deepEqual(sanitizeOnboardingTelemetryBatch({}), []);
});

test("the browser cannot report submit outcomes: the server writes those", () => {
  const sent = [{ eventType: "submit_success" }, { eventType: "submit_start" }, { eventType: "submit_error" }, { eventType: "step_skip", step: 2 }];
  assert.deepEqual(sanitizeOnboardingTelemetryBatch(sent), [{ eventType: "step_skip", step: 2 }]);
});
